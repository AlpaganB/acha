from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.seed import seed_demo_data


def measurement(**changes):
    return {
        "id": str(uuid4()),
        "kind": "heart_rate",
        "value": 72,
        "recorded_at": "2026-11-14T10:00:00Z",
        **changes,
    }


def assessment(crew, **changes):
    return {
        "id": str(uuid4()),
        "mission_profile_id": crew["mission_profile_id"],
        "assessed_at": "2026-11-14T10:05:00Z",
        "symptoms": [{"code": "fatigue", "severity": 2}],
        **changes,
    }


def test_mission_profile_assignment(client, crew):
    profile = client.post(
        "mission-profiles",
        json={
            "name": " Lunar Test ",
            "environment": "lunar_habitat",
            "equipment": ["Thermometer"],
            "measurement_schedules": [{"kind": "body_temperature", "interval_minutes": 720}],
            "guidance_protocol_ids": ["demo-reference"],
        },
    )
    assert profile.status_code == 201
    profile = profile.json()
    assert profile["name"] == "Lunar Test"
    assert client.get(f"mission-profiles/{profile['id']}").json() == profile
    assert profile in client.get("mission-profiles").json()

    path = f"crew-members/{crew['id']}"
    assert (
        client.patch(f"{path}/mission-profile", json={"mission_profile_id": str(uuid4())}).status_code == 404
    )
    updated = client.patch(f"{path}/mission-profile", json={"mission_profile_id": profile["id"]})
    assert updated.status_code == 200
    assert updated.json()["mission_profile_id"] == profile["id"]
    assert client.get(path).json() == updated.json()
    assert updated.json() in client.get("crew-members").json()


def test_mission_profile_and_crew_validation(client):
    schedule = {"kind": "spo2", "interval_minutes": 60}
    profile = {"name": "Test", "environment": "spacecraft", "measurement_schedules": [schedule, schedule]}
    assert client.post("mission-profiles", json=profile).status_code == 422
    assert client.post("mission-profiles", json={"name": "Test", "environment": "invalid"}).status_code == 422
    assert (
        client.post("mission-profiles", json={"name": "Test\0", "environment": "spacecraft"}).status_code
        == 422
    )
    assert (
        client.post(
            "crew-members", json={"display_name": "Missing", "mission_profile_id": str(uuid4())}
        ).status_code
        == 404
    )


def test_measurement_history_and_retry(client, crew):
    path = f"crew-members/{crew['id']}/measurements"
    earlier = measurement(recorded_at="2026-11-14T09:00:00Z", value=70)
    later = measurement(recorded_at="2026-11-14T13:00:00+03:00")
    oxygen = measurement(kind="spo2", value=98)
    for entry in [later, oxygen, earlier]:
        assert client.post(path, json=entry).status_code == 201

    replay = client.post(path, json={**later, "recorded_at": "2026-11-14T10:00:00Z"})
    assert replay.status_code == 200
    assert replay.json()["recorded_at"] == "2026-11-14T10:00:00Z"
    assert replay.json()["unit"] == "bpm"
    assert client.post(path, json={**later, "value": 80}).status_code == 409
    assert client.get(f"{path}/{later['id']}").json() == replay.json()
    assert len(client.get(path).json()) == 3
    assert [row["id"] for row in client.get(path, params={"kind": "heart_rate"}).json()] == [
        later["id"],
        earlier["id"],
    ]
    assert (
        client.get(path, params={"kind": "heart_rate", "offset": 1, "limit": 1}).json()[0]["id"]
        == earlier["id"]
    )
    before = client.get(path, params={"since": "2026-11-14T09:00:00Z", "until": "2026-11-14T10:00:00Z"})
    assert [row["id"] for row in before.json()] == [earlier["id"]]
    invalid = client.get(path, params={"since": "2026-11-15T00:00:00Z", "until": "2026-11-14T00:00:00Z"})
    assert invalid.status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"value": 0},
        {"value": True},
        {"value": "72"},
        {"diastolic": 60},
        {"kind": "spo2", "value": 101},
        {"kind": "blood_pressure", "value": 120},
        {"kind": "blood_pressure", "value": 80, "diastolic": 90},
        {"kind": "body_temperature", "value": -274},
        {"recorded_at": "2026-11-14T10:00:00"},
    ],
)
def test_invalid_measurements_return_422(client, crew, changes):
    response = client.post(f"crew-members/{crew['id']}/measurements", json=measurement(**changes))
    assert response.status_code == 422
    assert all("input" not in item for item in response.json()["detail"])


def test_concurrent_measurement_replay(client, crew):
    path = f"crew-members/{crew['id']}/measurements"
    payload = measurement(kind="blood_pressure", value=120, diastolic=75)
    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(lambda _: client.post(path, json=payload), range(4)))
    assert sorted(response.status_code for response in responses) == [200, 200, 200, 201]
    assert client.get(path).json() == [responses[0].json()]


def test_assessment_result_and_retry(client, crew):
    base = f"crew-members/{crew['id']}"
    readings = [measurement(), measurement(kind="spo2", value=98)]
    for reading in readings:
        assert client.post(f"{base}/measurements", json=reading).status_code == 201
    payload = assessment(crew, measurement_ids=[reading["id"] for reading in readings])
    created = client.post(f"{base}/assessments", json=payload)
    assert created.status_code == 201
    assert created.json()["status"] == "pending"
    assert created.json()["rationale"] is None
    assert created.json()["measurement_ids"] == sorted(payload["measurement_ids"])

    path = f"{base}/assessments/{payload['id']}"
    result = {
        "status": "reviewed",
        "rationale": "Synthetic test result",
        "next_step": "Open history",
        "protocol_id": "demo-reference",
    }
    assert client.put(f"{path}/result", json={**result, "status": "pending"}).status_code == 422
    stored = client.put(f"{path}/result", json=result)
    assert stored.status_code == 200
    assert all(stored.json()[key] == value for key, value in result.items())
    assert client.put(f"{path}/result", json=result).json() == stored.json()
    assert client.put(f"{path}/result", json={**result, "protocol_id": None}).status_code == 409

    new_profile = client.post(
        "mission-profiles", json={"name": "Deep Space Test", "environment": "deep_space"}
    ).json()
    changed = client.patch(f"{base}/mission-profile", json={"mission_profile_id": new_profile["id"]})
    assert changed.status_code == 200
    replay = client.post(
        f"{base}/assessments", json={**payload, "measurement_ids": list(reversed(payload["measurement_ids"]))}
    )
    assert replay.status_code == 200
    assert replay.json() == stored.json()
    assert client.post(f"{base}/assessments", json={**payload, "notes": "Changed input"}).status_code == 409
    assert client.get(path).json() == stored.json()
    assert client.get(f"{base}/assessments").json() == [stored.json()]


def test_assessment_rejects_cross_crew_and_missing_inputs(client, crew):
    second = client.post(
        "crew-members", json={"display_name": "Other Crew", "mission_profile_id": crew["mission_profile_id"]}
    ).json()
    entry = measurement()
    first_path = f"crew-members/{crew['id']}/measurements"
    second_path = f"crew-members/{second['id']}/measurements"
    assert client.post(first_path, json=entry).status_code == 201
    assert client.get(f"{second_path}/{entry['id']}").status_code == 404
    assert client.post(second_path, json=entry).status_code == 409

    url = f"crew-members/{second['id']}/assessments"
    assert client.post(url, json=assessment(second, symptoms=[])).status_code == 422
    assert client.post(url, json=assessment(second, measurement_ids=[entry["id"]])).status_code == 422
    assert client.post(url, json=assessment(second, measurement_ids=[str(uuid4())])).status_code == 422
    assert client.get(url).json() == []


def test_onboard_engine_evaluates_and_replays_the_same_record(client, crew):
    base = f"crew-members/{crew['id']}"
    payload = assessment(crew, symptoms=[{"code": "shortness_of_breath", "severity": 5}])
    path = f"{base}/assessments?evaluate=true"
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.post(path, json=payload), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 201]
    result = responses[0].json()
    assert responses[1].json() == result
    assert result["status"] == "urgent"
    assert result["protocol_id"] == "demo-breathing"
    assert result["engine_result"]["news2"]["total_score"] is None
    assert any(
        finding["code"] == "reported_symptom" and finding["symptom"] == "breathing_difficulty"
        for finding in result["engine_result"]["rationale"]
    )
    saved = f"{base}/assessments/{payload['id']}"
    assert client.get(saved).json() == result
    assert client.post(f"{saved}/evaluate").json() == result


def test_onboard_engine_handles_a_pending_record_with_incomplete_readings(client, crew):
    base = f"crew-members/{crew['id']}"
    reading = measurement(kind="spo2", value=98)
    assert client.post(f"{base}/measurements", json=reading).status_code == 201
    payload = assessment(crew, measurement_ids=[reading["id"]], symptoms=[])
    assert client.post(f"{base}/assessments", json=payload).json()["status"] == "pending"
    path = f"{base}/assessments/{payload['id']}"
    response = client.post(f"{path}/evaluate")
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "insufficient_data"
    assert result["engine_result"]["news2"]["complete"] is False
    assert result["protocol_id"] is None
    assert client.get(path).json() == result


def test_concurrent_assessment_result_preserves_first_write(client, crew):
    base = f"crew-members/{crew['id']}/assessments"
    payload = assessment(crew)
    assert client.post(base, json=payload).status_code == 201
    path = f"{base}/{payload['id']}"
    results = [
        {"status": "reviewed", "rationale": "Synthetic result", "next_step": f"Open demo screen {number}"}
        for number in (1, 2)
    ]
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda result: client.put(f"{path}/result", json=result), results))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response for response in responses if response.status_code == 200)
    assert client.get(path).json() == winner.json()


def test_database_health_and_demo_data(client, test_database_url):
    assert client.get("health").json() == {"status": "ok"}
    for _ in range(2):
        seed_demo_data(test_database_url)
    expected = {"Alpagan", "Emirhan", "Asım"}
    members = [row for row in client.get("crew-members").json() if row["display_name"] in expected]
    assert len(members) == len(expected)
    for member in members:
        base = f"crew-members/{member['id']}"
        assert client.get(f"{base}/measurements").json() == []
        assert client.get(f"{base}/assessments").json() == []


def test_assessment_uses_earlier_readings_for_the_same_crew(client, crew):
    base = f"crew-members/{crew['id']}"
    for index, value in enumerate((64, 72, 68, 66, 70)):
        reading = measurement(value=value, recorded_at=f"2026-11-{index + 6:02}T10:00:00Z")
        assert client.post(f"{base}/measurements", json=reading).status_code == 201
    observed = measurement(value=82)
    assert client.post(f"{base}/measurements", json=observed).status_code == 201
    later = measurement(value=160, recorded_at="2026-11-15T10:00:00Z")
    assert client.post(f"{base}/measurements", json=later).status_code == 201
    payload = assessment(crew, symptoms=[], measurement_ids=[observed["id"]])
    result = client.post(f"{base}/assessments?evaluate=true", json=payload).json()["engine_result"]
    assert result["comparisons"]["heart_rate"] == {
        "observed": 82, "unit": "bpm", "samples": 5, "reference": 68,
        "difference": 14, "median_absolute_deviation": 2, "usable": True,
    }
    assert result["news2"]["total_score"] is None


def test_research_api_reads_attributed_observations(client):
    response = client.get("research/bidmc-01")
    assert response.status_code == 200
    record = response.json()
    assert len(record["samples"]) == 481
    assert record["samples"][0] == {
        "seconds": 0, "heart_rate": 94, "pulse_rate": 93, "respiratory_rate": 25, "spo2": 97,
    }
    assert record["source"] == "https://physionet.org/content/bidmc/1.0.0/"
