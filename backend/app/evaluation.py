import sys
from pathlib import Path

from .models import Assessment, MissionProfile
from .schemas import AssessmentResult

# The backend also runs from backend/, where the sibling demo package is outside sys.path.
repository = str(Path(__file__).resolve().parents[2])
if repository not in sys.path:
    sys.path.append(repository)

from demo.crew_app import rules_for
from demo.health_assessment import evaluate_health_payload


PROFILE_KEYS = {
    "orbital_station": "orbital",
    "lunar_habitat": "lunar",
    "deep_space": "transit",
    "spacecraft": "transit",
}
ASSESSMENT_METRICS = {
    "spo2": ("spo2", "%"),
    "blood_pressure": ("systolic_bp", "mmHg"),
    "body_temperature": ("temperature", "C"),
}
SYMPTOM_ALIASES = {
    "shortness_of_breath": "breathing_difficulty",
    "loss_of_consciousness": "unresponsive",
}
SUMMARY = {
    "urgent": "A reported observation triggered an urgent rule in the demonstration profile.",
    "review": "A reported observation triggered a review rule in the demonstration profile.",
    "insufficient_data": "The available observations were insufficient to complete this assessment.",
    "no_flags": "No configured rule was triggered by the available observations.",
}


def evaluate_assessment(record: Assessment, profile: MissionProfile) -> None:
    """Evaluate attached readings as of capture time and retain the engine evidence."""
    current = {}
    for reading in sorted(record.measurements, key=lambda item: item.recorded_at, reverse=True):
        mapping = ASSESSMENT_METRICS.get(reading.kind)
        if not mapping or reading.recorded_at > record.assessed_at or abs(reading.value) > 1e12:
            continue
        metric, unit = mapping
        timestamp = reading.recorded_at.isoformat()
        if metric not in current:
            current[metric] = {
                "value": reading.value,
                "unit": unit,
                "measured_at": timestamp,
            }
        elif current[metric]["measured_at"] == timestamp and current[metric]["value"] != reading.value:
            current[metric]["quality"] = "suspect"

    symptom_codes = [item["code"].replace("-", "_") for item in record.symptoms]
    inputs = {
        "assessed_at": record.assessed_at.isoformat(),
        "current": current,
        "symptoms": [SYMPTOM_ALIASES.get(code, code) for code in symptom_codes],
    }
    rules = rules_for(PROFILE_KEYS[profile.environment], history_available=False)
    result = evaluate_health_payload(inputs, rules)
    output = AssessmentResult(
        status=result["status"],
        rationale=SUMMARY[result["status"]],
        next_step=result["next_step"],
        protocol_id=result["protocol_id"].lower() if result["protocol_id"] else None,
    )
    for field, value in output.model_dump().items():
        setattr(record, field, value)
    record.engine_snapshot = {"input": inputs, "profile": rules, "result": result}
