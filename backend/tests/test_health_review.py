import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.device_admin import ClockSettings, DeviceRegistration, configure
from app.health_review_admin import change_policy
from app.health_review_rules import ReviewPolicy
from app.main import create_app
from app.models import HealthReviewAcknowledgment

MEDICAL_KEY = "health-review-medical-test-" * 2
OPS_KEY = "health-review-operations-test-" * 2
MEDICAL = {"Authorization": f"Bearer {MEDICAL_KEY}"}
OPERATIONS = {"Authorization": f"Bearer {OPS_KEY}"}
EVENT = "/crew/crew-a/health-review"
APPROVALS = {
    "flight_medicine": {"authority": "Fixture flight surgeon", "reference": "test-review"},
    "radiation_safety": {"authority": "Fixture dosimetry officer", "reference": "test-dosimetry"},
}


@pytest.fixture
def workspace(monkeypatch, test_database_url):
    mission = "health-" + uuid4().hex[:12]
    monkeypatch.setenv("ACHA_PUBLIC_WORKSPACE", "disabled")
    monkeypatch.setenv("ACHA_OBSERVATION_ACCESS", json.dumps({
        "medic": {"role": "medical", "sha256": sha256(MEDICAL_KEY.encode()).hexdigest(), "missions": [mission],
                  "crew": {mission: ["crew-a"]}},
        "ops": {"role": "operations", "sha256": sha256(OPS_KEY.encode()).hexdigest(), "missions": [mission]},
    }))
    with TestClient(create_app(test_database_url), base_url="http://testserver/api/v1/") as client:
        yield client, "observations/missions/" + mission, mission, datetime.now(UTC).replace(microsecond=0)


def publish(client, mission, *bindings, version="test-v1"):
    policy = ReviewPolicy.model_validate({"version": version, "rules": bindings, **APPROVALS})
    with Session(client.app.state.engine) as session, session.begin():
        change_policy(session, mission, "operator-test", policy)


def put(client, base, parameter, value, when, context, expected=201, **overrides):
    response = client.post(base, headers=MEDICAL, json={
        "id": str(uuid4()), "crew_code": "crew-a", "parameter": parameter, "value": value, "context": context,
        "recorded_at": when.isoformat(), "location": "module-a", "phase": "in_flight", "activity": "rest",
        "quality": "verified", "device": "instrument-a", "calibration": "calibration-a", **overrides,
    })
    assert response.status_code == expected, response.text
    return response.json()


def report(client, base):
    response = client.get(base + EVENT, headers=MEDICAL)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()


def ratio_binding(now, rule_id="aerobic_capacity", body_site=None):
    return {"kind": "ratio", "rule_id": rule_id, "procedure_ref": "test-protocol-followup",
            "max_age_minutes": 30, "protocol": "test-protocol", "protocol_version": "v1", "body_site": body_site,
            "baseline_start": (now - timedelta(days=30)).isoformat(),
            "baseline_end": (now - timedelta(days=1)).isoformat()}


def protocol(body_site=None, version="v1"):
    return {"kind": "protocol", "protocol": "test-protocol", "version": version,
            "body_site": body_site, "source_ref": "test-measurement-report"}


def assessment(now, basis, lower, upper, **overrides):
    return {"kind": "radiation_assessment", "basis": basis, "model": "approved-analysis", "model_version": "2020",
            "source_ref": "test-model-output", "input_manifest_ref": "test-inputs", "review_ref": "test-reviewed",
            "exposure_start": (now - timedelta(days=30, minutes=5)).isoformat(),
            "exposure_end": (now - timedelta(minutes=5)).isoformat(), "lower": lower, "upper": upper,
            "interval_description": "Reported uncertainty interval", "complete_history": True, **overrides}


def radiation_rule(rule_id):
    return {"kind": "radiation", "rule_id": rule_id, "model": "approved-analysis", "model_version": "2020",
            "procedure_ref": "test-dose-review", "max_age_minutes": 30}


def test_sources_are_read_only_without_mission_approval(workspace):
    client, base, _, _ = workspace
    data = report(client, base)
    assert data["policy"] is None and data["decisions"] == [] and len(data["references"]) >= 10
    career = next(row for row in data["references"] if row["rule_id"] == "career_effective_dose")
    assert career["comparator"] == "maximum_exclusive" and career["limit"] == 600
    assert client.get(base + EVENT, headers=OPERATIONS).status_code == 403
    assert client.get(base + EVENT.replace("crew-a", "crew-b"), headers=MEDICAL).status_code == 403
    assert client.post(base + EVENT + "/acknowledgments", headers=MEDICAL,
                       json={"decision_key": "a" * 64, "action": "reviewed"}).status_code == 409
    with pytest.raises(ValueError, match="flight-medicine"):
        ReviewPolicy.model_validate({"version": "v1", "rules": [ratio_binding(datetime.now(UTC))]})


def test_ratio_review_persists_ack_and_rejects_stale_evidence(workspace):
    client, base, mission, now = workspace
    publish(client, mission, ratio_binding(now))
    ground = put(client, base, "vo2_peak", 40, now - timedelta(days=5), protocol(), phase="preflight", uncertainty=0.4)
    put(client, base, "vo2_peak", 38, now - timedelta(minutes=8), protocol(version="different"), uncertainty=0.4)
    current = put(client, base, "vo2_peak", 30, now - timedelta(minutes=5), protocol(), uncertainty=0.4)
    decision = report(client, base)["decisions"][0]
    assert decision["status"] == "review_required"
    assert decision["value"] == 75 and decision["upper"] < 80
    assert decision["observation_ids"] == [current["id"], ground["id"]]
    endpoint = base + EVENT + "/acknowledgments"
    payload = {"decision_key": decision["decision_key"], "action": "recheck_requested"}
    receipt = client.post(endpoint, headers=MEDICAL, json=payload)
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["actor"] == "medic"
    assert client.post(endpoint, headers=MEDICAL, json=payload).json() == receipt.json()
    assert client.post(endpoint, headers=MEDICAL, json=payload | {"action": "reviewed"}).status_code == 409
    saved = report(client, base)
    assert saved["decisions"][0]["acknowledgment"] == receipt.json()
    assert saved["recent_acknowledgments"][0]["policy_version"] == "test-v1"
    with Session(client.app.state.engine) as db:
        assert db.scalar(select(func.count()).select_from(HealthReviewAcknowledgment).where(
            HealthReviewAcknowledgment.mission_code == mission,
        )) == 1

    put(client, base, "vo2_peak", 32, now - timedelta(minutes=4), protocol(), uncertainty=1)
    boundary = report(client, base)["decisions"][0]
    assert boundary["status"] == "boundary_uncertain"
    put(client, base, "vo2_peak", 37, now - timedelta(minutes=3), protocol(), uncertainty=0.1)
    stale = client.post(endpoint, headers=MEDICAL, json=payload | {"decision_key": boundary["decision_key"]})
    assert stale.status_code == 409
    publish(client, mission, ratio_binding(now), version="test-v2")
    replaced = report(client, base)
    assert replaced["policy"]["version"] == "test-v2" and replaced["recent_acknowledgments"][0]["policy_version"] == "test-v1"
    with Session(client.app.state.engine) as db, db.begin():
        change_policy(db, mission, "operator-test", None)
    assert report(client, base)["policy"] is None


def test_bone_comparison_requires_same_site_and_calibration(workspace):
    client, base, mission, now = workspace
    site = "total_hip_left"
    publish(client, mission, ratio_binding(now, "bmd_total_hip", site))
    put(client, base, "bone_mineral_density", 1.2, now - timedelta(days=4), protocol("total_hip_right"),
        phase="preflight", uncertainty=0)
    put(client, base, "bone_mineral_density", 0.95, now - timedelta(minutes=6), protocol(site), uncertainty=0)
    assert report(client, base)["decisions"][0]["status"] == "insufficient_data"
    put(client, base, "bone_mineral_density", 1.0, now - timedelta(days=3), protocol(site), phase="preflight", uncertainty=0)
    decision = report(client, base)["decisions"][0]
    assert decision["status"] == "within_rule" and decision["value"] == 95


def test_career_dose_rejects_generic_msv_and_uses_exclusive_threshold(workspace):
    client, base, mission, now = workspace
    publish(client, mission, radiation_rule("career_effective_dose"))
    put(client, base, "effective_dose_estimate", 750, now - timedelta(minutes=9),
        {"kind": "dose_estimate", "model_version": "generic", "source_ref": "general-test"})
    assert report(client, base)["decisions"][0]["status"] == "insufficient_data"
    career = assessment(now, "nasa_career_effective", 600, 600,
                        includes_mission_projection=True, excludes_medical_exposure=True)
    put(client, base, "nasa_career_effective_dose", 600, now - timedelta(minutes=8),
        career | {"complete_history": False})
    assert report(client, base)["decisions"][0]["status"] == "insufficient_data"
    put(client, base, "nasa_career_effective_dose", 600, now - timedelta(minutes=7), career)
    decision = report(client, base)["decisions"][0]
    assert decision["status"] == "review_required" and decision["maximum_exclusive"] and decision["unit"] == "mSv"


def test_organ_and_cancer_model_context_preserves_distinct_quantities(workspace):
    client, base, mission, now = workspace
    publish(client, mission, radiation_rule("lens_30d"), radiation_rule("hippocampus_30d"))
    lens = assessment(now, "organ_gray_equivalent", 990, 1100, tissue="lens")
    recorded = now - timedelta(minutes=1)
    put(client, base, "organ_gray_equivalent_30d", 1050, recorded, lens)
    put(client, base, "hippocampal_absorbed_30d", 480, recorded,
        assessment(now, "hippocampal_absorbed", 450, 505, tissue="hippocampus"))
    put(client, base, "organ_gray_equivalent_30d", 1050, recorded,
        lens | {"exposure_start": (now - timedelta(days=29)).isoformat()}, expected=422)
    put(client, base, "radiation_reid", 5, recorded, assessment(now, "lifetime_cancer_risk", 2, 101), expected=422)
    result = put(client, base, "radiation_reid", 5, recorded, assessment(now, "lifetime_cancer_risk", 2, 10))
    response = report(client, base)
    assert [(check["unit"], check["status"]) for check in response["decisions"]] == [
        ("mGy-Eq", "boundary_uncertain"), ("mGy", "boundary_uncertain"),
    ]
    [risk] = [item for item in response["model_results"] if item["parameter"] == "radiation_reid"]
    assert risk["id"] == result["id"] and risk["unit"] == "%" and risk["context"]["upper"] == 10


def test_vital_rule_requires_consecutive_context_matched_readings(workspace):
    client, base, mission, now = workspace
    conditions = {"kind": "reading", "posture": "seated", "timing": "resting"}
    publish(client, mission, {
        "kind": "vital", "rule_id": "vital-test", "parameter": "heart_rate", "source_ref": "fixture-mission-limit",
        "procedure_ref": "fixture-repeat-check", "upper": 100, "max_age_minutes": 5, "consecutive": 2,
        "maximum_gap_seconds": 90, "conditions": conditions, "device": "instrument-a", "calibration": "calibration-a",
        "activity": "rest", "location": "module-a",
    })
    put(client, base, "heart_rate", 130, now - timedelta(minutes=4), conditions, uncertainty=1)
    put(client, base, "heart_rate", 125, now - timedelta(minutes=3), conditions | {"timing": "after_exercise"}, uncertainty=1)
    put(client, base, "heart_rate", 120, now - timedelta(minutes=2), conditions, uncertainty=1)
    assert report(client, base)["decisions"][0]["status"] == "insufficient_data"
    put(client, base, "heart_rate", 121, now - timedelta(minutes=1), conditions, uncertainty=1)
    outcome = report(client, base)["decisions"][0]
    assert outcome["status"] == "review_required" and len(outcome["observation_ids"]) == 2
    put(client, base, "heart_rate", 110, now - timedelta(seconds=20), conditions, uncertainty=None)
    assert report(client, base)["decisions"][0]["status"] == "insufficient_data"


def test_device_gap_and_rejected_latest_sample_suppress_review(workspace):
    client, base, mission, now = workspace
    conditions = {"kind": "reading", "posture": "seated", "timing": "resting"}
    epoch = now - timedelta(seconds=30)
    token = "heart-rate-health-test-" + mission
    with Session(client.app.state.engine) as db, db.begin():
        configure(db, "set-clock", mission, None, "operator-test", ClockSettings(epoch=epoch))
        configure(db, "register", mission, "pulse-a", "operator-test", DeviceRegistration.model_validate({
            "credential_sha256": sha256(token.encode()).hexdigest(),
            "configuration": {
                "parameter": "heart_rate", "unit": "bpm", "hardware": "pulse-monitor", "firmware": "v1",
                "calibration": "cal-a", "operating_limits_ref": "manual-a", "location": "module-a",
                "location_ref": "diagram-a", "crew_code": "crew-a", "phase": "in_flight",
                "sample_interval_ms": 1000, "clock_tolerance_ms": 15, "minimum": 1, "maximum": 300,
                "context": conditions,
            },
        }))
    publish(client, mission, {
        "kind": "vital", "rule_id": "vital-device", "parameter": "heart_rate", "source_ref": "fixture-mission-rule",
        "procedure_ref": "fixture-device-review", "upper": 100, "max_age_minutes": 5, "consecutive": 2,
        "maximum_gap_seconds": 5, "conditions": conditions, "device": "pulse-a", "calibration": "cal-a",
        "activity": "rest", "location": "module-a",
    })

    def sample(index, quality="ok"):
        response = client.post(base + "/devices/pulse-a/samples", headers={"Authorization": f"Bearer {token}"}, json={
            "sequence": index, "recorded_at": (epoch + timedelta(seconds=index)).isoformat(),
            "mission_elapsed_ms": index * 1000, "clock_error_ms": 0, "firmware": "v1",
            "quality": quality, "value": 125, "uncertainty": 1, "activity": "rest",
        })
        assert response.status_code == 201, response.text

    sample(0)
    sample(2)
    assert "sequence" in report(client, base)["decisions"][0]["explanation"]
    sample(1)
    assert report(client, base)["decisions"][0]["status"] == "review_required"
    sample(3, "saturated")
    decision = report(client, base)["decisions"][0]
    assert decision["status"] == "insufficient_data" and "rejected" in decision["explanation"]
