import json
from io import BytesIO
from uuid import uuid4

import pytest
from app import research


def test_respiratory_rate_round_trip_and_assessment(client, crew):
    base = f"crew-members/{crew['id']}"
    reading = {
        "id": str(uuid4()), "kind": "respiratory_rate", "value": 18,
        "recorded_at": "2026-11-15T11:10:00+03:00",
    }
    path = f"{base}/measurements"
    assert client.post(path, json={**reading, "value": -1}).status_code == 422
    assert client.post(path, json={**reading, "diastolic": 12}).status_code == 422
    saved = client.post(path, json=reading)
    assert saved.status_code == 201
    assert saved.json()["unit"] == "breaths/min"
    assert saved.json()["recorded_at"] == "2026-11-15T08:10:00Z"
    retry = client.post(path, json={**reading, "recorded_at": "2026-11-15T08:10:00Z"})
    assert retry.status_code == 200
    assert retry.json() == saved.json()
    assert client.get(f"{path}?kind=respiratory_rate").json() == [saved.json()]

    sleep = {**reading, "id": str(uuid4()), "kind": "sleep_duration", "value": 7.5}
    stored_sleep = client.post(path, json=sleep)
    assert stored_sleep.status_code == 201
    assert stored_sleep.json()["unit"] == "h"

    response = client.post(f"{base}/assessments?evaluate=true", json={
        "id": str(uuid4()), "mission_profile_id": crew["mission_profile_id"],
        "assessed_at": "2026-11-15T08:11:00Z", "measurement_ids": [reading["id"], sleep["id"]],
    })
    assert response.status_code == 201
    result = response.json()["engine_result"]
    assert result["comparisons"]["respiratory_rate"]["observed"] == 18
    assert "sleep_duration" not in result["comparisons"]
    assert result["news2"]["complete"] is False
    assert [c["parameter"] for c in result["news2"]["components"]] == ["respiratory_rate"]


def test_rr6_retains_utc_values_and_missingness(client, monkeypatch):
    earlier = {
        "time": "2017-12-15T00:01:00Z", "temperature_ground": 99,
        "temperature_iss": 24.3, "humidity_iss": None, "co2_iss": 3000,
    }
    later = {**earlier, "time": "2017-12-15T00:06:00Z", "humidity_iss": 36}

    def download(url, timeout):
        assert url == research.RR6_DOWNLOAD
        assert timeout == 4
        return BytesIO(json.dumps([later, earlier]).encode())

    monkeypatch.setattr(research, "urlopen", download)
    response = client.get("research/nasa-rr6-iss")
    assert response.status_code == 200
    record = response.json()
    assert record["dataset_id"] == "RR-6"
    assert record["provenance"] == "NASA_REAL"
    assert record["source"] == research.RR6_SOURCE
    assert record["samples"][0] == {
        "recorded_at": earlier["time"], "temperature_c": 24.3,
        "relative_humidity_pct": None, "carbon_dioxide_ppm": 3000,
    }
    assert record["samples"][1]["relative_humidity_pct"] == 36


@pytest.mark.parametrize("body", [
    b"<html>Unavailable</html>",
    b"[]",
    b'[{"time":"2017-12-15T00:01:00","temperature_iss":24,"humidity_iss":40,"co2_iss":2500}]',
    b'[{"time":"2017-12-15T00:01:00Z","temperature_iss":24,"humidity_iss":40,"co2_iss":"2500"}]',
    b'[{"time":"2017-12-15T00:01:00Z","temperature_iss":NaN,"humidity_iss":40,"co2_iss":2500}]',
])
def test_rr6_rejects_invalid_source_response(client, monkeypatch, body):
    monkeypatch.setattr(research, "urlopen", lambda *args, **kwargs: BytesIO(body))
    assert client.get("research/nasa-rr6-iss").status_code == 502


@pytest.mark.parametrize("instrument, status", [("DosTel1", 200), ("DosTel2", 502)])
def test_dostel_preserves_different_radiation_quantities(client, monkeypatch, instrument, status):
    body = ("timestamp,instrument_id,absorbed_dose_rate,dose_equivalent_rate\n"
            f"2022-04-01T23:00:00,{instrument},9.815504,\n").encode()
    monkeypatch.setattr(research, "urlopen", lambda *args, **kwargs: BytesIO(body))
    response = client.get("research/nasa-dostel1")
    assert response.status_code == status
    if status == 200:
        result = response.json()
        assert result["provenance"] == "SPACE_AGENCY_REAL"
        assert result["samples"] == [{"timestamp": "2022-04-01T23:00:00", "absorbed_dose_rate": 9.815504,
                                      "dose_equivalent_rate": None}]
