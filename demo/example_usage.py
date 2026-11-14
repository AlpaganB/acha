"""Run synthetic integration examples with the same entry point used by FastAPI."""
import copy
import json

from health_assessment import evaluate_health_payload

MISSION_RULES = {
    "profile_version": "acha-demo-0.3",
    "news2": {
        "max_age_seconds": 300,
        "max_spread_seconds": 60,
        "oxygen_scale": 1,
        "review_protocol_id": "DEMO-REVIEW",
        "urgent_protocol_id": "DEMO-URGENT",
        "emergency_protocol_id": "DEMO-EMERGENCY",
    },
}

ASSESSMENT = {
    "assessed_at": "2026-11-14T10:00:00Z",
    "current": {
        "respiratory_rate": {"value": 16, "unit": "breaths/min", "measured_at": "2026-11-14T10:00:00Z"},
        "spo2": {"value": 98, "unit": "%", "measured_at": "2026-11-14T10:00:00Z"},
        "systolic_bp": {"value": 120, "unit": "mmHg", "measured_at": "2026-11-14T10:00:00Z"},
        "pulse_rate": {"value": 70, "unit": "bpm", "measured_at": "2026-11-14T10:00:00Z"},
        "temperature": {"value": 37.0, "unit": "C", "measured_at": "2026-11-14T10:00:00Z"},
    },
    "news2_context": {
        "measured_at": "2026-11-14T10:00:00Z",
        "age_years": 30,
        "pregnant": False,
        "consciousness": "alert",
        "supplemental_oxygen": False,
    },
    "symptoms": [],
}


def run_examples():
    cases = []
    cases.append(("complete_zero_score", copy.deepcopy(ASSESSMENT), "no_flags", 0))
    incomplete = copy.deepcopy(ASSESSMENT)
    incomplete["current"].pop("temperature")
    cases.append(("missing_temperature", incomplete, "insufficient_data", None))
    urgent = copy.deepcopy(incomplete)
    urgent["current"]["respiratory_rate"]["value"] = 25
    cases.append(("single_red_with_missing_temperature", urgent, "urgent", None))
    medium = copy.deepcopy(ASSESSMENT)
    medium["current"]["respiratory_rate"]["value"] = 25
    medium["news2_context"]["supplemental_oxygen"] = True
    cases.append(("aggregate_five", medium, "urgent", 5))
    results = {}
    for name, data, status, score in cases:
        result = evaluate_health_payload(data, MISSION_RULES)
        assert result["status"] == status
        assert result["news2"]["total_score"] == score
        results[name] = result
    return results


if __name__ == "__main__":
    print(json.dumps(run_examples(), indent=2))
