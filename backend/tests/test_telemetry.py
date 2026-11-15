import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from urllib.error import URLError
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.device_admin import ClockSettings, DeviceRegistration, KeySettings, configure
from app.main import create_app
from app.models import DeviceReceipt, MissionObservation
from app.telemetry import DeviceSample
from app.telemetry_queue import DeviceUploadQueue

EPOCH = datetime(2025, 1, 1, tzinfo=UTC)
OPERATIONS_KEY = "operations-key-" * 3
MEDICAL_KEY = "medical-key-" * 3
DEVICE_KEY = "dosimeter-key-" * 3
NEW_KEY = "replaced-key-" * 3


def digest(token):
    return sha256(token.encode()).hexdigest()


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def telemetry(test_database_url, monkeypatch):
    mission = "device-" + uuid4().hex[:12]
    monkeypatch.setenv("ACHA_PUBLIC_WORKSPACE", "disabled")
    monkeypatch.setenv("ACHA_OBSERVATION_ACCESS", json.dumps({
        "ops": {"role": "operations", "sha256": digest(OPERATIONS_KEY), "missions": [mission]},
        "medic": {"role": "medical", "sha256": digest(MEDICAL_KEY), "missions": [mission],
                  "crew": {mission: ["crew-a"]}},
    }))
    with TestClient(create_app(test_database_url), base_url="http://testserver/api/v1/") as client:
        with Session(client.app.state.engine) as session, session.begin():
            configure(session, "set-clock", mission, None, "installer", ClockSettings(epoch=EPOCH))
            configure(session, "register", mission, "dosimeter-a", "installer", DeviceRegistration.model_validate({
                "credential_sha256": digest(DEVICE_KEY),
                "configuration": {
                    "parameter": "personal_dose_equivalent_rate", "unit": "µSv/h", "hardware": "unit-a",
                    "firmware": "v1", "calibration": "calibration-a", "operating_limits_ref": "manual-a",
                    "location": "habitat-a", "location_ref": "layout-section-a", "crew_code": "crew-a",
                    "phase": "in_flight", "sample_interval_ms": 1000, "clock_tolerance_ms": 15,
                    "minimum": 0, "maximum": 100,
                    "context": {"kind": "radiation", "source_ref": "report-a", "geometry_ref": "geometry-a",
                                "shielding_ref": "shielding-a", "particle_class": "reported mixed field"},
                },
            }))
        try:
            yield client, f"observations/missions/{mission}", mission
        finally:
            with Session(client.app.state.engine) as session, session.begin():
                configure(session, "revoke-key", mission, "dosimeter-a", "installer", None)


def sample(sequence=0, **overrides):
    return {
        "sequence": sequence,
        "recorded_at": (EPOCH + timedelta(seconds=sequence)).isoformat(),
        "mission_elapsed_ms": sequence * 1000, "clock_error_ms": 0, "firmware": "v1",
        "quality": "ok", "value": 12.0, "uncertainty": 0.5, **overrides,
    }


def submit(client, base, body, token=DEVICE_KEY):
    return client.post(base + "/devices/dosimeter-a/samples", json=body, headers=headers(token))


def channels(client, base, crew="crew-a", token=MEDICAL_KEY):
    return client.get(base + "/devices", params={"scope": "crew", "location": "habitat-a", "crew_code": crew},
                      headers=headers(token))


def test_concurrent_device_retry_writes_one_observation(telemetry):
    client, base, mission = telemetry
    assert submit(client, base, sample(), OPERATIONS_KEY).status_code == 401
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: submit(client, base, sample()), range(2)))
    assert sorted(response.status_code for response in replies) == [200, 201]
    assert replies[0].json() == replies[1].json()
    assert submit(client, base, sample(value=13.0)).status_code == 409
    assert channels(client, base, crew="crew-b").status_code == 403
    assert channels(client, base, token=OPERATIONS_KEY).status_code == 403
    assert client.get(base, params={"scope": "crew", "crew_code": "crew-b"}, headers=headers(MEDICAL_KEY)).status_code == 403
    result = client.get(base, params={"scope": "crew", "crew_code": "crew-a"}, headers=headers(MEDICAL_KEY))
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "private, no-store"
    [reading] = result.json()
    assert reading["provenance"] == "DEVICE_REPORTED"
    assert reading["device"] == "dosimeter-a"
    assert reading["calibration"] == "calibration-a"
    assert reading["context"]["shielding_ref"] == "shielding-a"
    with Session(client.app.state.engine) as session:
        assert len(session.scalars(select(MissionObservation).where(MissionObservation.mission_code == mission)).all()) == 1
        assert len(session.scalars(select(DeviceReceipt).where(DeviceReceipt.mission_code == mission)).all()) == 1


def test_clock_firmware_saturation_and_late_arrival(telemetry):
    client, base, _ = telemetry
    assert submit(client, base, sample(firmware="changed")).status_code == 422
    assert submit(client, base, sample(mission_elapsed_ms=1_000)).status_code == 422
    assert submit(client, base, sample(4, clock_error_ms=16)).status_code == 422
    assert submit(client, base, sample(0)).status_code == 201
    assert submit(client, base, sample(2, quality="saturated")).json()["status"] == "saturated"
    assert channels(client, base).json()[0]["missing_sequences"] == 1
    assert submit(client, base, sample(1, recorded_at=(EPOCH + timedelta(milliseconds=1200)).isoformat(),
                                       mission_elapsed_ms=1200)).status_code == 422
    assert submit(client, base, sample(1, quality="detached", value=None, uncertainty=None)).json()["status"] == "detached"
    assert submit(client, base, sample(3, value=150.0)).json()["status"] == "out_of_range"
    assert submit(client, base, sample(4, quality="artefact")).json()["observation_id"] is None
    quality = channels(client, base).json()[0]
    assert quality["missing_sequences"] == 0
    assert quality["counts"] == dict(accepted=1, saturated=1, detached=1, out_of_range=1, artefact=1)


def test_device_key_rotation_revokes_previous_key(telemetry):
    client, base, mission = telemetry
    with Session(client.app.state.engine) as session, session.begin():
        configure(session, "rotate-key", mission, "dosimeter-a", "installer", KeySettings(credential_sha256=digest(NEW_KEY)))
    assert submit(client, base, sample()).status_code == 401
    assert submit(client, base, sample(), NEW_KEY).status_code == 201
    with Session(client.app.state.engine) as session, session.begin():
        configure(session, "revoke-key", mission, "dosimeter-a", "installer", None)
    assert submit(client, base, sample(1), NEW_KEY).status_code == 401


def test_radiation_review_requires_coverage_and_known_uncertainty(telemetry):
    client, base, _ = telemetry
    review = {"channel": "dosimeter-a", "end": (EPOCH + timedelta(seconds=3)).isoformat(), "boundary": 10.0,
              "window_seconds": 3, "maximum_gap_seconds": 1, "minimum_coverage": 1.0,
              "minimum_exceedance_seconds": 2, "uncertainty_margin": 1.0}
    url = base + "/radiation/review"
    for index in (0, 2, 3):
        assert submit(client, base, sample(index)).status_code == 201
    assert client.post(url, json=review, headers=headers(OPERATIONS_KEY)).status_code == 403
    result = client.post(url, json=review, headers=headers(MEDICAL_KEY)).json()
    assert result["result"] == "insufficient_data" and result["coverage"] == pytest.approx(1 / 3)
    assert submit(client, base, sample(1)).status_code == 201
    result = client.post(url, json=review, headers=headers(MEDICAL_KEY)).json()
    assert result["result"] == "boundary_exceeded" and result["unit"] == "µSv/h"
    assert result["longest_exceedance_seconds"] == 3
    assert client.post(url, json=review | {"uncertainty_margin": 3.0},
                       headers=headers(MEDICAL_KEY)).json()["result"] == "boundary_not_observed"
    assert submit(client, base, sample(4, uncertainty=None)).status_code == 201
    expanded = review | {"end": (EPOCH + timedelta(seconds=4)).isoformat(), "window_seconds": 4}
    result = client.post(url, json=expanded, headers=headers(MEDICAL_KEY)).json()
    assert result["result"] == "insufficient_data" and result["coverage"] == 0.75


def test_personal_mission_dose_integrates_registered_receipts_and_exposes_coverage(telemetry):
    client, base, _ = telemetry
    for index in (0, 2, 3):
        assert submit(client, base, sample(index)).status_code == 201
    end = (EPOCH + timedelta(seconds=3)).isoformat()
    route = base + "/crew/crew-a/radiation"
    response = client.get(route, params={"mode": "mission", "end": end}, headers=headers(MEDICAL_KEY))
    assert response.status_code == 200, response.text
    report = response.json()
    [dose] = report["channels"]
    assert report["start_source"] == "mission_clock"
    assert dose["coverage"] == pytest.approx(1 / 3)
    assert dose["dose"] == pytest.approx(12 / 3_600_000)
    assert dose["rad"] is None and dose["unit"] == "mSv" and dose["context"]["shielding_ref"] == "shielding-a"
    assert client.get(route, headers=headers(OPERATIONS_KEY)).status_code == 403


def test_offline_upload_queue_retries_identical_sample_after_lost_receipt(telemetry, monkeypatch):
    client, base, mission = telemetry
    queue = DeviceUploadQueue("https://mission.example/api/v1", mission, "dosimeter-a", DEVICE_KEY, capacity=2)
    statuses = []

    class FakeReceiptResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self, size):
            return self.content[:size]

    def transport(request, timeout):
        assert request.get_header("Authorization") == f"Bearer {DEVICE_KEY}"
        response = client.post(base + "/devices/dosimeter-a/samples",
                               headers=headers(DEVICE_KEY) | {"Content-Type": request.get_header("Content-type")},
                               content=request.data)
        statuses.append(response.status_code)
        if len(statuses) == 1:
            raise URLError("connection closed after commit")
        receipt = FakeReceiptResponse()
        receipt.status = response.status_code
        receipt.content = response.content
        return receipt

    monkeypatch.setattr(queue._opener, "open", transport)
    queue.enqueue(DeviceSample.model_validate(sample()))
    queue.enqueue(DeviceSample.model_validate(sample(1)))
    with pytest.raises(BufferError):
        queue.enqueue(DeviceSample.model_validate(sample(2)))
    assert queue.flush() == [] and queue.pending == 2
    assert [receipt.sequence for receipt in queue.flush()] == [0, 1]
    assert statuses == [201, 200, 201] and queue.pending == 0
