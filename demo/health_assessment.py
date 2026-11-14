import hashlib
import json
from datetime import timedelta, timezone
from statistics import median
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, FiniteFloat, StrictBool, model_validator

if __package__:
    from .assessment_models import Code, Measurement, MeasurementFailure, Metric, Minutes, NonEmpty, Reading, Schema, Status, UNITS
    from .news2 import NUMERIC_METRICS, News2Config, News2Context, News2Result, evaluate_news2, observation_issue
else:
    from assessment_models import Code, Measurement, MeasurementFailure, Metric, Minutes, NonEmpty, Reading, Schema, Status, UNITS
    from news2 import NUMERIC_METRICS, News2Config, News2Context, News2Result, evaluate_news2, observation_issue

ENGINE_VERSION = "0.3.0"


class AssessmentInput(Schema):
    assessed_at: AwareDatetime
    current: dict[Metric, Measurement] = Field(default_factory=dict)
    baselines: dict[Metric, Reading] = Field(default_factory=dict)
    history: dict[Metric, list[Measurement]] = Field(default_factory=dict)
    symptoms: list[Code] | None = None
    news2_context: News2Context | None = None
    measurement_failures: dict[Metric, MeasurementFailure] = Field(default_factory=dict)


class Action(Schema):
    status: Literal["urgent", "review"]
    next_step: NonEmpty
    protocol_id: NonEmpty | None = None

    @model_validator(mode="after")
    def require_urgent_protocol(self):
        if self.status == "urgent" and self.protocol_id is None:
            raise ValueError("An urgent action requires a protocol_id.")
        return self


class Limit(Schema):
    value: Reading
    action: Action
    inclusive: StrictBool = False
    rule_id: NonEmpty | None = None
    source: NonEmpty | None = None


class Bounds(Schema):
    lower: Limit | None = None
    upper: Limit | None = None

    @model_validator(mode="after")
    def check_limits(self):
        if self.lower is None and self.upper is None:
            raise ValueError("Provide at least one limit.")
        if self.lower and self.upper and self.lower.value >= self.upper.value:
            raise ValueError("The lower limit must be less than the upper limit.")
        return self

    def match(self, value: float) -> tuple[Literal["below", "above"], Limit] | None:
        if self.lower and (value < self.lower.value or (self.lower.inclusive and value == self.lower.value)):
            return "below", self.lower
        if self.upper and (value > self.upper.value or (self.upper.inclusive and value == self.upper.value)):
            return "above", self.upper
        return None


class TrendRule(Schema):
    window_minutes: Minutes
    min_samples_per_window: Annotated[int, Field(strict=True, ge=2)] = 2
    delta: Bounds


class MetricRules(Schema):
    max_age_minutes: Minutes
    absolute: Bounds | None = None
    baseline_delta: Bounds | None = None
    trend: TrendRule | None = None
    valid_min: Reading | None = None
    valid_max: Reading | None = None
    additional_absolute: list[Bounds] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_metric_rule(self):
        if self.valid_min is not None and self.valid_max is not None and self.valid_min >= self.valid_max:
            raise ValueError("valid_min must be below valid_max.")
        if self.absolute is None and self.baseline_delta is None and self.trend is None and not self.additional_absolute:
            raise ValueError("Provide at least one rule for each configured metric.")
        return self


class MissionProfile(Schema):
    metrics: dict[Metric, MetricRules] = Field(default_factory=dict)
    symptoms: dict[Code, Action | None] = Field(default_factory=dict)
    profile_version: NonEmpty = "unversioned"
    news2: News2Config | None = None

    @model_validator(mode="after")
    def require_rules(self):
        if self.news2 is None and not self.metrics and all(action is None for action in self.symptoms.values()):
            raise ValueError("Provide at least one measurement or symptom rule.")
        return self


class Finding(Schema):
    code: str
    status: Literal["urgent", "review", "insufficient_data"]
    metric: Metric | None = None
    symptom: Code | None = None
    unit: str | None = None
    direction: Literal["below", "above"] | None = None
    observed: FiniteFloat | None = None
    reference: FiniteFloat | None = None
    compared_value: FiniteFloat | None = None
    threshold: Reading | None = None
    next_step: str | None = None
    protocol_id: str | None = None
    rule_id: str | None = None
    source: str | None = None
    observed_at: AwareDatetime | None = None
    threshold_inclusive: bool | None = None


class AssessmentResult(Schema):
    status: Status
    rationale: list[Finding]
    next_step: str
    protocol_id: str | None
    news2: News2Result | None = None
    engine_version: str = ENGINE_VERSION
    profile_version: str
    profile_hash: str
    assessed_at: AwareDatetime


def _trend_comparison(
    samples: list[Measurement], current: Measurement, rule: TrendRule,
    metric: Metric | None = None, metric_rules: MetricRules | None = None,
) -> tuple[float, float] | str:
    anchor = current.measured_at
    window = timedelta(minutes=rule.window_minutes)
    full_window = 2 * window
    zero = timedelta(0)
    previous: dict[timedelta, float] = {}
    recent: dict[timedelta, float] = {timedelta(0): current.value}
    invalid_history = False
    conflicting_history = False
    for sample in samples:
        age = anchor - sample.measured_at
        if age < zero or age >= full_window:
            continue
        if metric is not None and metric_rules is not None and _measurement_issue(sample, metric, metric_rules):
            invalid_history = True
            continue
        bucket = recent if age < window else previous
        if age in bucket and bucket[age] != sample.value:
            conflicting_history = True
        bucket[age] = sample.value

    if invalid_history:
        return "invalid_trend_history"
    if conflicting_history:
        return "conflicting_trend_history"
    if min(len(recent), len(previous)) < rule.min_samples_per_window:
        return "missing_trend_history"
    return median(recent.values()), median(previous.values())


def _value_invalid(value: float, metric: Metric, rules: MetricRules) -> bool:
    if metric == "spo2" and not 0 <= value <= 100:
        return True
    if metric in {"heart_rate", "pulse_rate", "respiratory_rate", "systolic_bp", "diastolic_bp"} and value < 0:
        return True
    return ((rules.valid_min is not None and value < rules.valid_min)
            or (rules.valid_max is not None and value > rules.valid_max))


def _measurement_issue(measurement: Measurement, metric: Metric, rules: MetricRules) -> str | None:
    if measurement.unit is not None and measurement.unit != UNITS[metric]:
        return "unit_mismatch"
    if measurement.quality == "suspect":
        return "suspect_measurement"
    if _value_invalid(measurement.value, metric, rules):
        return "invalid_measurement"
    return None


def _record_comparison(
    findings: list[Finding],
    *,
    code: str,
    metric: Metric,
    bounds: Bounds,
    observed: float,
    reference: float | None = None,
    observed_at: AwareDatetime | None = None,
) -> None:
    compared_value = observed if reference is None else observed - reference
    match = bounds.match(compared_value)
    if match is None:
        return
    direction, limit = match
    findings.append(Finding(
        code=code,
        status=limit.action.status,
        metric=metric,
        unit=UNITS[metric],
        direction=direction,
        observed=observed,
        reference=reference,
        compared_value=compared_value,
        threshold=limit.value,
        next_step=limit.action.next_step,
        protocol_id=limit.action.protocol_id,
        rule_id=limit.rule_id, source=limit.source, observed_at=observed_at,
        threshold_inclusive=limit.inclusive,
    ))


def evaluate_health(data: AssessmentInput, profile: MissionProfile) -> AssessmentResult:
    """Evaluate one crew member against the rules supplied by the caller."""
    findings: list[Finding] = []
    assessed_at = data.assessed_at.astimezone(timezone.utc)
    configured = set(profile.metrics)
    news2_result = None
    if profile.news2 is not None:
        configured.update(NUMERIC_METRICS)
    effective_current = dict(data.current)
    for metric, failure in sorted(data.measurement_failures.items()):
        if metric not in configured:
            findings.append(Finding(code="unconfigured_measurement_failure", status="insufficient_data", metric=metric))
            continue
        uses_news2 = profile.news2 is not None and metric in NUMERIC_METRICS
        max_age = profile.news2.max_age_seconds if uses_news2 else profile.metrics[metric].max_age_minutes * 60
        reading = effective_current.get(metric)
        if reading is not None and reading.measured_at > failure.measured_at:
            reading_age = (assessed_at - reading.measured_at).total_seconds()
            problem = _measurement_issue(reading, metric, profile.metrics[metric]) if metric in profile.metrics else None
            if uses_news2:
                problem = problem or observation_issue(metric, reading, assessed_at, profile.news2)
            if problem is None and 0 <= reading_age <= max_age:
                continue
        failure_age = (assessed_at - failure.measured_at.astimezone(timezone.utc)).total_seconds()
        if not 0 <= failure_age <= max_age:
            findings.append(Finding(code="invalid_failure_time", status="insufficient_data", metric=metric))
            continue
        effective_current.pop(metric, None)
        findings.append(Finding(code="measurement_unavailable", status="insufficient_data", metric=metric,
                                observed_at=failure.measured_at))
        if uses_news2 and failure.reason == "unable_to_obtain":
            findings.append(Finding(code="news2_unobtainable_measurement", status="urgent", metric=metric,
                observed_at=failure.measured_at, protocol_id=profile.news2.emergency_protocol_id,
                next_step="Obtain immediate clinical assessment through the configured mission protocol.",
                rule_id="RCP-NEWS2-additional-guidance-2020",
                source="https://www.rcp.ac.uk/resources/news2-additional-implementation-guidance/"))
    if profile.news2 is not None:
        news2_current = {metric: reading for metric, reading in effective_current.items()
                         if metric not in profile.metrics
                         or _measurement_issue(reading, metric, profile.metrics[metric]) is None}
        news2_result = evaluate_news2(news2_current, data.news2_context, assessed_at, profile.news2)
        for issue in news2_result.issues:
            findings.append(Finding(code=issue.code, status="insufficient_data",
                metric=issue.parameter if issue.parameter in NUMERIC_METRICS else None,
                rule_id=news2_result.rule_version, source=news2_result.source))
        trigger = news2_result.minimum_trigger
        if trigger in {"low", "single_red", "medium", "high"}:
            protocol = profile.news2.review_protocol_id
            status = "review"
            if trigger in {"single_red", "medium", "high"}:
                status = "urgent"
                protocol = profile.news2.urgent_protocol_id
            if trigger == "high":
                protocol = profile.news2.emergency_protocol_id
            findings.append(Finding(code="news2_" + trigger, status=status,
                observed=news2_result.total_score,
                next_step="Follow the configured mission escalation protocol and obtain clinical review.",
                protocol_id=protocol, rule_id=news2_result.rule_version, source=news2_result.source))
    for metric in sorted(data.current.keys() - configured):
        findings.append(Finding(code="unconfigured_metric", status="insufficient_data", metric=metric))
    if data.symptoms is None and profile.symptoms:
        findings.append(Finding(code="missing_symptom_answers", status="insufficient_data"))
    for symptom in sorted(set(data.symptoms or [])):
        if symptom not in profile.symptoms:
            findings.append(Finding(code="unknown_symptom", status="insufficient_data", symptom=symptom))
            continue
        action = profile.symptoms[symptom]
        if action is not None:
            findings.append(Finding(
                code="reported_symptom", status=action.status, symptom=symptom,
                next_step=action.next_step, protocol_id=action.protocol_id,
            ))

    for metric, rules in sorted(profile.metrics.items()):
        measurement = effective_current.get(metric)
        if measurement is None:
            findings.append(Finding(code="missing_measurement", status="insufficient_data", metric=metric))
            continue
        issue = _measurement_issue(measurement, metric, rules)
        if issue is not None:
            findings.append(Finding(code=issue, status="insufficient_data", metric=metric))
            continue
        age = assessed_at - measurement.measured_at
        if not timedelta(0) <= age <= timedelta(minutes=rules.max_age_minutes):
            code = "future_measurement" if age < timedelta(0) else "stale_measurement"
            findings.append(Finding(code=code, status="insufficient_data", metric=metric))
            continue

        if rules.absolute is not None:
            _record_comparison(findings, code="absolute_limit", metric=metric,
                               bounds=rules.absolute, observed=measurement.value, observed_at=measurement.measured_at)
        for bounds in rules.additional_absolute:
            _record_comparison(findings, code="absolute_limit", metric=metric,
                               bounds=bounds, observed=measurement.value, observed_at=measurement.measured_at)

        if rules.baseline_delta is not None:
            baseline = data.baselines.get(metric)
            if baseline is None:
                findings.append(Finding(code="missing_baseline", status="insufficient_data", metric=metric))
            elif _value_invalid(baseline, metric, rules):
                findings.append(Finding(code="invalid_baseline", status="insufficient_data", metric=metric))
            else:
                _record_comparison(findings, code="baseline_delta", metric=metric,
                                   bounds=rules.baseline_delta, observed=measurement.value,
                                   reference=baseline, observed_at=measurement.measured_at)

        if rules.trend is not None:
            comparison = _trend_comparison(data.history.get(metric, []), measurement, rules.trend, metric, rules)
            if isinstance(comparison, str):
                findings.append(Finding(code=comparison, status="insufficient_data", metric=metric))
            else:
                recent, previous = comparison
                _record_comparison(findings, code="trend_delta", metric=metric,
                                   bounds=rules.trend.delta, observed=recent, reference=previous,
                                   observed_at=measurement.measured_at)

    priority = {"urgent": 0, "review": 1, "insufficient_data": 2}
    findings.sort(key=lambda finding: (priority[finding.status], finding.protocol_id is None))
    canonical_profile = json.dumps(profile.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    metadata = dict(news2=news2_result, profile_version=profile.profile_version,
                    profile_hash=hashlib.sha256(canonical_profile.encode()).hexdigest(), assessed_at=assessed_at)
    if not findings:
        return AssessmentResult(status="no_flags", rationale=[], protocol_id=None,
                                next_step="No configured rule was triggered.", **metadata)

    primary = findings[0]
    return AssessmentResult(
        status=primary.status, rationale=findings, protocol_id=primary.protocol_id,
        next_step=primary.next_step or "Complete the missing or invalid assessment data.",
        **metadata,
    )


def evaluate_health_payload(payload: dict, mission_rules: dict) -> dict:
    """Validate JSON-compatible input and return a JSON-compatible assessment."""
    data = AssessmentInput.model_validate(payload)
    profile = MissionProfile.model_validate(mission_rules)
    return evaluate_health(data, profile).model_dump(mode="json")
