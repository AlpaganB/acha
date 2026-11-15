from datetime import UTC, datetime, timedelta
from hashlib import sha256
from types import SimpleNamespace
from uuid import uuid4
import json

import pytest
from fastapi.testclient import TestClient

from app.crew_radiation import integrate
from app.main import create_app

ANCHOR = datetime(2025, 1, 10, 12, tzinfo=UTC)
WINDOW = {"through": ANCHOR.isoformat()}
KEY = "medical-monitoring-key" * 3
AUTH = {"Authorization": f"Bearer {KEY}"}
POSITION = {"kind": "reading", "posture": "seated", "timing": "resting"}


def test_demo_reference_uses_only_selected_people_and_distinct_utc_days(client, crew):
    url = f"crew-members/{crew['id']}"
    for days, values in [(6, [66, 66, 66]), (5, [68]), (4, [70]), (3, [72]), (2, [74]), (0, [90])]:
        for offset, value in enumerate(values):
            saved = client.post(url + "/measurements", json={
                "id": str(uuid4()), "kind": "heart_rate", "value": value,
                "recorded_at": (ANCHOR - timedelta(days=days, minutes=offset)).isoformat(),
            })
            assert saved.status_code == 201, saved.text
    report = client.get(url + "/monitoring", params=WINDOW)
    assert report.status_code == 200, report.text
    assert report.headers["cache-control"] == "no-store"
    [heart] = report.json()["indicators"]
    assert heart["value"] == 90 and heart["reference"]["median"] == 70
    assert heart["reference"]["days"] == 5 and heart["reference"]["status"] == "above"
    other = client.post("crew-members", json={"display_name": "Different crew", "mission_profile_id": crew["mission_profile_id"]})
    assert client.get(f"crew-members/{other.json()['id']}/monitoring", params=WINDOW).json()["indicators"] == []


@pytest.fixture
def workspace(test_database_url, monkeypatch):
    mission = "check-" + uuid4().hex[:12]
    monkeypatch.setenv("ACHA_PUBLIC_WORKSPACE", "disabled")
    monkeypatch.setenv("ACHA_OBSERVATION_ACCESS", json.dumps({"medic": {
        "sha256": sha256(KEY.encode()).hexdigest(), "role": "medical", "missions": [mission], "crew": {mission: ["crew-a"]},
    }}))
    with TestClient(create_app(test_database_url), base_url="http://testserver/api/v1/") as client:
        yield client, f"observations/missions/{mission}"


def record(client, base, parameter, when, **fields):
    payload = {"id": str(uuid4()), "crew_code": "crew-a", "location": "habitat-a", "phase": "in_flight",
               "activity": "rest", "parameter": parameter, "recorded_at": when.isoformat(),
               "quality": "verified", "device": "unit-a", "calibration": "cal-a", **fields}
    response = client.post(base, headers=AUTH, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_crew_reference_pins_history_and_keeps_measurement_conditions(workspace):
    client, base = workspace
    for day, value in zip(range(6, 1, -1), [66, 68, 70, 72, 74], strict=True):
        record(client, base, "heart_rate", ANCHOR - timedelta(days=day), value=value, context=POSITION)
    record(client, base, "heart_rate", ANCHOR - timedelta(days=1), value=130,
           context=POSITION | {"timing": "after_exercise"})
    record(client, base, "heart_rate", ANCHOR - timedelta(hours=3), value=110, context=POSITION, device="unit-b")
    record(client, base, "heart_rate", ANCHOR, value=90, context=POSITION)
    roster = client.get(base + "/crew", headers=AUTH)
    assert roster.status_code == 200, roster.text
    assert [item["crew_code"] for item in roster.json()] == ["crew-a"]
    assert client.get(base + "/crew/crew-b/monitoring", headers=AUTH).status_code == 403

    report = client.get(base + "/crew/crew-a/monitoring", headers=AUTH, params=WINDOW | {
        "reference_start": (ANCHOR - timedelta(days=7)).isoformat(),
        "reference_end": (ANCHOR - timedelta(hours=1)).isoformat(),
    })
    assert report.status_code == 200, report.text
    [heart] = report.json()["indicators"]
    assert heart["reference"]["days"] == 5 and heart["reference"]["change"] == 20
    assert heart["reference"]["status"] == "above"
    record(client, base, "heart_rate", ANCHOR, value=95, context=POSITION)
    conflict = client.get(base + "/crew/crew-a/monitoring", headers=AUTH, params=WINDOW).json()["indicators"][0]["reference"]
    assert conflict["status"] == "conflict" and conflict["change"] is None


def test_timed_logs_preserve_missingness_and_cross_phase_uses_matched_protocol(workspace):
    client, base = workspace
    def timed(parameter, kind, start, end, details):
        return record(client, base, parameter, end, context={
            "kind": kind, "start": start.isoformat(), "end": end.isoformat(), **details,
        })

    midnight = ANCHOR.replace(hour=0)
    session = {"mode": "resistance", "intensity": "moderate"}
    for _ in range(2):
        timed("exercise_minutes", "exercise_interval", midnight - timedelta(minutes=30), midnight + timedelta(minutes=30), session)
    timed("exercise_minutes", "exercise_interval", midnight, midnight + timedelta(minutes=15),
          {"mode": "aerobic", "intensity": "moderate"})
    for _ in range(2):
        record(client, base, "fluid_intake", ANCHOR, value=250)
    record(client, base, "energy_intake", ANCHOR, value=0)

    for _ in range(2):
        timed("gravity_exposure_minutes", "gravity_interval", midnight, midnight + timedelta(hours=3),
              {"regime": "microgravity", "source_ref": "log-a"})
    timed("gravity_exposure_minutes", "gravity_interval", midnight + timedelta(hours=2), midnight + timedelta(hours=4),
          {"regime": "partial_gravity", "source_ref": "log-b"})

    protocol = {"kind": "protocol", "protocol": "grip", "version": "v1", "body_site": "right-hand", "source_ref": "strength-a"}
    record(client, base, "grip_strength", ANCHOR - timedelta(days=10), value=300, context=protocol, phase="preflight", location="ground")
    record(client, base, "grip_strength", ANCHOR - timedelta(days=9), value=500, context=protocol | {"body_site": "left-hand"},
           phase="preflight", location="ground")
    record(client, base, "grip_strength", ANCHOR, value=270, context=protocol)

    report = client.get(base + "/crew/crew-a/monitoring", headers=AUTH, params=WINDOW)
    assert report.status_code == 200, report.text
    data = report.json()
    yesterday, today = data["daily_context"][-2:]
    assert yesterday["exercise_minutes"] == 30
    assert today["exercise_minutes"] == today["exercise_conflict_minutes"] == 15
    assert today["intake"] == {"energy_intake": 0, "protein_intake": None, "fluid_intake": 250, "sodium_intake": None}
    assert data["gravity"]["hours"] == {"microgravity": 2, "partial_gravity": 1}
    assert data["gravity"]["conflict_hours"] == 1
    [strength] = data["adaptation"]
    assert strength["preflight"] == 300 and strength["percentage_change"] == -10


def test_counter_conversion_retains_separate_msv_and_detects_resets(workspace):
    client, base = workspace
    context = {"kind": "radiation", "source_ref": "instrument-spec", "geometry_ref": "surface", "shielding_ref": "wall-a",
               "particle_class": "mixed"}
    for index, value in enumerate([2, 3, 1]):
        record(client, base, "personal_absorbed_dose_total", ANCHOR - timedelta(hours=3-index), value=value, context=context)
    for index, value in enumerate([1, 1.5]):
        record(client, base, "personal_equivalent_dose_total", ANCHOR - timedelta(hours=2-index), value=value, context=context)
    data = client.get(base + "/crew/crew-a/radiation", params={"end": ANCHOR.isoformat()}, headers=AUTH)
    assert data.status_code == 200, data.text
    counters = {item["observation"]["unit"]: item for item in data.json()["counters"]}
    assert counters["mGy"]["reset"] and counters["mGy"]["change"] is None and counters["mGy"]["rad"] == 0.1
    assert counters["mSv"]["rad"] is None and counters["mSv"]["change"] == 0.5


def test_integral_never_bridges_a_gap_and_splits_at_utc_midnight():
    begin = ANCHOR.replace(hour=0) - timedelta(hours=1)
    end = begin + timedelta(hours=4)
    make = lambda sequence, hour, amount, error=100: SimpleNamespace(
        sequence=sequence, recorded_at=begin + timedelta(hours=hour), value=amount, uncertainty=error,
    )
    data = integrate([make(0, 0, 200), make(1, 2, 400), make(3, 3, 700), make(4, 4, None)], 7200, begin, end)
    assert data["dose"] == pytest.approx(0.6)
    assert data["lower"] == pytest.approx(0.4)
    assert data["upper"] == pytest.approx(0.8)
    assert data["coverage"] == 0.5 and data["gap_intervals"] == 2
    assert [day.dose for day in data["daily"]] == pytest.approx([0.25, 0.35])
    assert integrate([make(0, 0, 200), make(1, 1, 200, None)], 3600, begin, end)["upper"] is None
