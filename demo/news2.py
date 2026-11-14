"""RCP NEWS2 chart arithmetic, with explicit application data-quality checks.

Royal College of Physicians. National Early Warning Score (NEWS) 2:
Standardising the assessment of acute-illness severity in the NHS.
Updated report of a working party. London: RCP, 2017.
"""
from bisect import bisect_left
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StrictBool, model_validator

if __package__:
    from .assessment_models import Measurement, NonEmpty, Schema, UNITS
else:
    from assessment_models import Measurement, NonEmpty, Schema, UNITS

NEWS2_VERSION = "RCP-NEWS2-2017"
NEWS2_SOURCE = "https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/"
NUMERIC_METRICS = ("respiratory_rate", "spo2", "systolic_bp", "pulse_rate", "temperature")
Trigger = Literal["routine", "low", "single_red", "medium", "high"]

# Upper-inclusive limits at the published chart's measurement precision.
SCORING = {
    "respiratory_rate": ((8, 11, 20, 24), (3, 1, 0, 2, 3)),
    "spo2": ((91, 93, 95), (3, 2, 1, 0)),
    "systolic_bp": ((90, 100, 110, 219), (3, 2, 1, 0, 3)),
    "pulse_rate": ((40, 50, 90, 110, 130), (3, 1, 0, 1, 2, 3)),
    "temperature": ((35.0, 36.0, 38.0, 39.0), (3, 1, 0, 1, 2)),
}


class News2Context(Schema):
    measured_at: AwareDatetime
    age_years: Annotated[int, Field(strict=True, ge=0, le=150)] | None = None
    pregnant: StrictBool | None = None
    consciousness: Literal["alert", "new_confusion", "confusion_onset_unknown", "voice", "pain", "unresponsive"] | None = None
    supplemental_oxygen: StrictBool | None = None


class News2Config(Schema):
    max_age_seconds: Annotated[int, Field(strict=True, ge=1, le=86400)]
    max_spread_seconds: Annotated[int, Field(strict=True, ge=0, le=86400)]
    oxygen_scale: Annotated[int, Field(strict=True, ge=1, le=2)] = 1
    scale2_authorization: NonEmpty | None = None
    review_protocol_id: NonEmpty
    urgent_protocol_id: NonEmpty
    emergency_protocol_id: NonEmpty

    @model_validator(mode="after")
    def validate_scale(self):
        if self.oxygen_scale == 2 and self.scale2_authorization is None:
            raise ValueError("Scale 2 requires a documented clinician authorization in the trusted profile.")
        return self


class News2Component(Schema):
    parameter: str
    observed: float | str | bool
    score: int
    measured_at: AwareDatetime
    unit: str | None = None


class News2Issue(Schema):
    code: str
    parameter: str | None = None


class News2Result(Schema):
    rule_version: str = NEWS2_VERSION
    source: str = NEWS2_SOURCE
    oxygen_scale: int
    complete: bool
    total_score: int | None
    partial_score: int
    trigger: Trigger | None
    minimum_trigger: Trigger | None
    components: list[News2Component]
    issues: list[News2Issue]


def score_parameter(parameter: str, value: float, oxygen_scale: int = 1,
                    supplemental_oxygen: bool | None = None) -> int:
    """Score a valid, correctly rounded chart observation. Validate at the entry point."""
    if parameter == "spo2" and oxygen_scale == 2:
        if supplemental_oxygen is None:
            raise ValueError("Scale 2 scoring requires oxygen support status.")
        if value <= 92:
            return (3, 2, 1, 0)[bisect_left((83, 85, 87), value)]
        if supplemental_oxygen:
            return (1, 2, 3)[bisect_left((94, 96), value)]
        return 0
    limits, scores = SCORING[parameter]
    return scores[bisect_left(limits, value)]


def classify_scores(scores: list[int]) -> Trigger:
    total = sum(scores)
    if total >= 7:
        return "high"
    if total >= 5:
        return "medium"
    if 3 in scores:
        return "single_red"
    return "low" if total else "routine"


def observation_issue(parameter: str, reading: Measurement, assessed_at: datetime,
                   config: News2Config) -> str | None:
    if reading.unit != UNITS[parameter]:
        return "news2_unit_required_or_mismatch"
    if reading.quality != "accepted":
        return "news2_suspect_measurement"
    if reading.value < 0 or (parameter == "spo2" and reading.value > 100):
        return "news2_invalid_value"
    precision = Decimal(str(reading.value)) * (10 if parameter == "temperature" else 1)
    if precision != precision.to_integral_value():
        return "news2_invalid_precision"
    age = (assessed_at - reading.measured_at).total_seconds()
    if age < 0:
        return "news2_future_measurement"
    if age > config.max_age_seconds:
        return "news2_stale_measurement"
    return None


def evaluate_news2(current: dict[str, Measurement], context: News2Context | None,
                   assessed_at: datetime, config: News2Config) -> News2Result:
    assessed_at = assessed_at.astimezone(timezone.utc)
    issues: list[News2Issue] = []
    components: list[News2Component] = []
    context_valid = context is not None
    scope_valid = False
    if context is None:
        issues.append(News2Issue(code="news2_missing_context"))
    else:
        context_age = (assessed_at - context.measured_at.astimezone(timezone.utc)).total_seconds()
        if not 0 <= context_age <= config.max_age_seconds:
            issues.append(News2Issue(code="news2_invalid_context_time"))
            context_valid = False
        if context.age_years is None or context.pregnant is None:
            issues.append(News2Issue(code="news2_missing_population_context"))
        elif context.age_years < 16 or context.pregnant:
            issues.append(News2Issue(code="news2_outside_supported_population"))
        else:
            scope_valid = True
        if context_valid:
            for parameter, value in (("consciousness", context.consciousness),
                                     ("supplemental_oxygen", context.supplemental_oxygen)):
                if value is None:
                    issues.append(News2Issue(code="news2_missing_context_value", parameter=parameter))
                    continue
                score = (0 if value == "alert" else 3) if parameter == "consciousness" else (2 if value else 0)
                components.append(News2Component(parameter=parameter, observed=value, score=score,
                                                  measured_at=context.measured_at))

    oxygen = context.supplemental_oxygen if context_valid else None
    for parameter in NUMERIC_METRICS:
        reading = current.get(parameter)
        if reading is None:
            issues.append(News2Issue(code="news2_missing_measurement", parameter=parameter))
            continue
        problem = observation_issue(parameter, reading, assessed_at, config)
        if problem is not None:
            issues.append(News2Issue(code=problem, parameter=parameter))
            continue
        if parameter == "spo2" and config.oxygen_scale == 2 and oxygen is None:
            issues.append(News2Issue(code="news2_missing_oxygen_for_scale2", parameter=parameter))
            continue
        components.append(News2Component(parameter=parameter, observed=reading.value,
            score=score_parameter(parameter, reading.value, config.oxygen_scale, oxygen),
            measured_at=reading.measured_at, unit=reading.unit))

    timestamps = [component.measured_at.astimezone(timezone.utc) for component in components]
    synchronized = not timestamps or (max(timestamps) - min(timestamps)).total_seconds() <= config.max_spread_seconds
    if not synchronized:
        issues.append(News2Issue(code="news2_inconsistent_observation_times"))
    scores = [component.score for component in components]
    complete = not issues and len(components) == 7
    minimum = classify_scores(scores) if scope_valid and synchronized else None
    if scope_valid and not synchronized and 3 in scores:
        minimum = "single_red"
    return News2Result(oxygen_scale=config.oxygen_scale, complete=complete,
        total_score=sum(scores) if complete else None, partial_score=sum(scores),
        trigger=minimum if complete else None, minimum_trigger=minimum,
        components=components, issues=issues)
