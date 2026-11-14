import sys
from datetime import timedelta
from pathlib import Path
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Assessment, Measurement, MissionProfile
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
    "heart_rate": ("heart_rate", "bpm", 1, 300),
    "spo2": ("spo2", "%", 0, 100),
    "blood_pressure": ("systolic_bp", "mmHg", 1, 300),
    "body_temperature": ("temperature", "C", 20, 50),
}
HISTORY_DAYS = 30
MIN_BASELINE_SAMPLES = 5
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


def evaluate_assessment(session: Session, record: Assessment, profile: MissionProfile) -> None:
    """Evaluate attached readings as of capture time and retain the engine evidence."""
    current = {}
    evidence = {}
    for reading in sorted(record.measurements, key=lambda item: item.recorded_at, reverse=True):
        if reading.recorded_at > record.assessed_at or abs(reading.value) > 1e12:
            continue
        metric, unit, _, _ = ASSESSMENT_METRICS[reading.kind]
        timestamp = reading.recorded_at.isoformat()
        if metric not in current:
            current[metric] = {
                "value": reading.value,
                "unit": unit,
                "measured_at": timestamp,
            }
            evidence[metric] = reading
        elif current[metric]["measured_at"] == timestamp and current[metric]["value"] != reading.value:
            current[metric]["quality"] = "suspect"

    symptom_codes = [item["code"].replace("-", "_") for item in record.symptoms]
    inputs = {
        "assessed_at": record.assessed_at.isoformat(),
        "current": current,
        "symptoms": [SYMPTOM_ALIASES.get(code, code) for code in symptom_codes],
    }
    rules = rules_for(PROFILE_KEYS[profile.environment], history_available=False)
    # A heart-rate measurement is distinct from the pulse required by NEWS2.
    rules["metrics"] = {}
    rules["profile_version"] += "+crew-history.1"
    comparisons = {}
    for metric, reading in evidence.items():
        _, unit, minimum, maximum = ASSESSMENT_METRICS[reading.kind]
        history = session.execute(
            select(Measurement.recorded_at, Measurement.value)
            .where(
                Measurement.crew_member_id == record.crew_member_id,
                Measurement.kind == reading.kind,
                Measurement.recorded_at >= reading.recorded_at - timedelta(days=HISTORY_DAYS),
                Measurement.recorded_at < reading.recorded_at,
            )
            .order_by(Measurement.recorded_at.desc(), Measurement.id)
            .limit(500)
        ).all()
        by_time = {}
        conflicts = set()
        for timestamp, value in history:
            if by_time.setdefault(timestamp, value) != value:
                conflicts.add(timestamp)
        samples = [value for timestamp, value in by_time.items()
                   if timestamp not in conflicts and minimum <= value <= maximum]
        valid = minimum <= reading.value <= maximum and current[metric].get("quality") != "suspect"
        if not valid:
            current[metric]["quality"] = "suspect"
        reference = median(samples) if len(samples) >= MIN_BASELINE_SAMPLES else None
        comparisons[metric] = {
            "observed": reading.value,
            "unit": unit,
            "samples": len(samples),
            "reference": reference,
            "difference": round(reading.value - reference, 2) if valid and reference is not None else None,
            "median_absolute_deviation": round(median(abs(value - reference) for value in samples), 2)
            if reference is not None else None,
            "usable": valid,
        }
    engine_current = {metric: reading for metric, reading in current.items() if metric != "heart_rate"}
    result = evaluate_health_payload({**inputs, "current": engine_current}, rules)
    result["comparisons"] = comparisons
    result["comparison_window_days"] = HISTORY_DAYS
    result["comparison_min_samples"] = MIN_BASELINE_SAMPLES
    output = AssessmentResult(
        status=result["status"],
        rationale=SUMMARY[result["status"]],
        next_step=result["next_step"],
        protocol_id=result["protocol_id"].lower() if result["protocol_id"] else None,
    )
    for field, value in output.model_dump().items():
        setattr(record, field, value)
    record.engine_snapshot = {"input": inputs, "profile": rules, "result": result}
