import json
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from uuid import uuid4

import pytest
from app.main import create_app
from app.models import ObservationAudit
from app.observation_registry import PARAMETERS
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

MISSION = "observations/missions/test-mission"
OPERATIONS = {"Authorization": f"Bearer {'operations-test-' * 3}"}
MEDICAL = {"Authorization": f"Bearer {'medical-test-' * 3}"}


@pytest.fixture
def restricted(test_database_url, monkeypatch):
    def digest(headers):
        return sha256(headers["Authorization"].removeprefix("Bearer ").encode()).hexdigest()

    monkeypatch.setenv("ACHA_OBSERVATION_ACCESS", json.dumps({
        "test-operations": {"sha256": digest(OPERATIONS), "role": "operations", "missions": ["test-mission"]},
        "test-medical": {"sha256": digest(MEDICAL), "role": "medical", "missions": ["test-mission"]},
    }))
    with TestClient(create_app(test_database_url), base_url="http://testserver/api/v1/") as client:
        yield client


def observation(**overrides):
    return {"id": str(uuid4()), "location": "habitat-a", "phase": "in_flight", "parameter": "cabin_pressure",
            "recorded_at": "2026-11-15T10:00:00+03:00", "value": 101.3, **overrides}


def test_registry_metadata_and_no_default_authorization(client):
    response = client.get("observations/parameters")
    assert response.status_code == 200
    assert len(response.json()) == len(PARAMETERS) >= 40
    denied = client.get(f"{MISSION}?scope=environment", headers=MEDICAL)
    assert denied.status_code == 401
    assert denied.headers["cache-control"] == "private, no-store"
    assert denied.headers["www-authenticate"] == "Bearer"


def test_roles_and_missions_are_enforced(restricted):
    assert restricted.get("observations/access", headers=MEDICAL).json()["role"] == "medical"
    assert restricted.get("observations/missions/other?scope=environment", headers=MEDICAL).status_code == 403
    assert restricted.get(f"{MISSION}?scope=crew&crew_code=crew-a", headers=OPERATIONS).status_code == 403
    assert restricted.post(MISSION, headers=MEDICAL, json=observation()).status_code == 403
    assert restricted.post(MISSION, headers=OPERATIONS, json=observation(
        parameter="reported_mood", crew_code="crew-a", value=6,
    )).status_code == 403
    assert restricted.get(f"{MISSION}?scope=crew", headers=MEDICAL).status_code == 422


def test_mission_observation_provenance_idempotency_and_auditing(restricted):
    payload = observation(location="airlock", quality="verified", device="sensor-03", calibration="cal-014", uncertainty=0.2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = list(executor.map(lambda _: restricted.post(MISSION, headers=OPERATIONS, json=payload), range(2)))
    assert sorted(response.status_code for response in requests) == [200, 201]
    saved = requests[0].json()
    assert requests[1].json() == saved
    assert saved["unit"] == "kPa"
    assert saved["method"] == "instrument_transcribed"
    assert saved["provenance"] == "MANUAL_OBSERVATION"
    assert saved["recorded_at"] == "2026-11-15T07:00:00Z"
    assert saved["uncertainty"] == 0.2
    assert saved["calibration"] == "cal-014"
    assert restricted.post(MISSION, headers=OPERATIONS, json={**payload, "value": 98}).status_code == 409
    result = restricted.get(f"{MISSION}?scope=environment&location=airlock&parameter=cabin_pressure", headers=MEDICAL)
    assert result.json() == [saved]
    assert result.headers["cache-control"] == "private, no-store"
    with Session(restricted.app.state.engine) as session:
        writes = session.scalars(select(ObservationAudit).where(ObservationAudit.observation_id == payload["id"])).all()
        assert [(audit.actor, audit.action) for audit in writes] == [("test-operations", "write")]
        assert session.scalar(select(ObservationAudit).where(ObservationAudit.actor == "test-medical",
                                                               ObservationAudit.action == "read"))


def test_observation_filters_and_input_contract(restricted):
    a = observation(parameter="sleep_minutes", value=440, crew_code="crew-a", location="sleep-station", quality="verified")
    b = observation(parameter="sleep_minutes", value=480, crew_code="crew-b", location="sleep-station")
    for item in (a, b):
        response = restricted.post(MISSION, headers=MEDICAL, json=item)
        assert response.status_code == 201
        assert response.json()["provenance"] == "USER_REPORTED"
    result = restricted.get(f"{MISSION}?scope=crew&crew_code=crew-a&location=sleep-station&phase=in_flight", headers=MEDICAL)
    assert [row["id"] for row in result.json()] == [a["id"]]
    assert restricted.get(f"{MISSION}?scope=crew&crew_code=crew-a&location=airlock", headers=MEDICAL).json() == []
    assert restricted.get(f"{MISSION}?scope=crew&crew_code=crew-a&until=2026-11-15T07:00:00Z", headers=MEDICAL).json() == []
    for changes in ({"value": 1500}, {"crew_code": None}, {"recorded_at": "2026-11-15T07:00:00"},
                    {"provenance": "NASA_REAL"}, {"location": "unknown location"}, {"uncertainty": -1}):
        assert restricted.post(MISSION, headers=MEDICAL, json={**a, **changes}).status_code == 422
    assert restricted.post(MISSION, headers=OPERATIONS, json=observation(quality="verified")).status_code == 422


def test_medication_event_is_restricted_and_keeps_event_metadata(restricted):
    item = observation(parameter="medication_record", value=None, crew_code="crew-a", event_text="Training event note")
    assert restricted.post(MISSION, headers=OPERATIONS, json=item).status_code == 403
    assert restricted.post(MISSION, headers=MEDICAL, json={**item, "value": 12}).status_code == 422
    assert restricted.post(MISSION, headers=MEDICAL, json={**item, "uncertainty": 0}).status_code == 422
    response = restricted.post(MISSION, headers=MEDICAL, json=item)
    assert response.status_code == 201
    saved = response.json()
    assert saved["provenance"] == "CLINICAL_RECORD"
    assert saved["event_text"] == "Training event note" and saved["value"] is None
    operational = restricted.get(f"{MISSION}?scope=environment", headers=OPERATIONS)
    assert all(record["id"] != item["id"] for record in operational.json())


def test_invalid_and_duplicate_credential_configuration_fails_startup(monkeypatch, test_database_url):
    entry = {"sha256": "a" * 64, "role": "operations", "missions": ["training"]}
    monkeypatch.setenv("ACHA_OBSERVATION_ACCESS", json.dumps({"a": entry, "b": entry}))
    with pytest.raises(RuntimeError, match="Invalid ACHA_OBSERVATION_ACCESS"), TestClient(create_app(test_database_url)):
        pytest.fail("Invalid credentials should stop startup")


def test_public_workspace_can_be_disabled_without_disabling_catalog(monkeypatch, test_database_url):
    monkeypatch.setenv("ACHA_PUBLIC_WORKSPACE", "disabled")
    with TestClient(create_app(test_database_url), base_url="http://testserver/api/v1/") as app:
        assert app.get("crew-members").status_code == 404
        assert app.post("mission-profiles", json={"name": "Test", "environment": "spacecraft"}).status_code == 404
        assert app.get("observations/parameters").status_code == 200
        assert app.get("health").status_code == 200
