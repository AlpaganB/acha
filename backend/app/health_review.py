from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from json import dumps
from math import isclose
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .crew_monitoring import scoped
from .database import DbSession
from .health_review_rules import (
    NASA_STANDARD, NASA_STANDARD_SOURCE, REFERENCES, Binding, Comparator, RadiationBinding, RatioBinding,
    ReviewPolicy, VitalBinding,
)
from .models import DeviceReceipt, HealthReviewAcknowledgment, HealthReviewPolicy, MissionObservation, ObservationAudit
from .observation_access import ObservationAccess
from .observation_context import ORGAN_GRAY_EQ_TISSUES, RadiationAssessment
from .observation_registry import PARAMETERS
from .observations import Observation, authorize, authorize_crew
from .schemas import ApiModel, Code, Timestamp

router = APIRouter(prefix="/api/v1/observations", tags=["Mission health review"])
EXTERNAL_RESULTS = (
    ("radiation_reid", None), ("radiation_reic", None), ("nasa_career_effective_dose", None),
    ("hippocampal_absorbed_30d", "hippocampus"),
    *(("organ_gray_equivalent_30d", tissue) for tissue in sorted(ORGAN_GRAY_EQ_TISSUES)),
)
Outcome = Literal["insufficient_data", "boundary_uncertain", "within_rule", "review_required"]
Action = Literal["reviewed", "recheck_requested", "referred_to_flight_team"]


class Acknowledgment(ApiModel):
    decision_key: str
    actor: Code
    action: Action
    recorded_at: Timestamp


class AcknowledgeInput(ApiModel):
    decision_key: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    action: Action


class PastAcknowledgment(Acknowledgment):
    policy_version: Code
    title: str


class Decision(ApiModel):
    rule_id: Code
    title: str
    status: Outcome = "insufficient_data"
    explanation: str = ""
    unit: str
    minimum: float | None = None
    maximum: float | None = None
    maximum_exclusive: bool = False
    value: float | None = None
    lower: float | None = None
    upper: float | None = None
    observed_at: Timestamp | None = None
    observation_ids: list[UUID] = Field(default_factory=list)
    procedure_ref: str
    evidence: str
    source_url: str | None = None
    decision_key: str | None = None
    acknowledgment: Acknowledgment | None = None


class DecisionReport(ApiModel):
    evaluated_at: Timestamp
    policy: ReviewPolicy | None
    decisions: list[Decision]
    references: list[dict]
    model_results: list[Observation]
    recent_acknowledgments: list[PastAcknowledgment]


def active_policy(session: Session, mission: str, *, lock: bool = False) -> HealthReviewPolicy | None:
    query = select(HealthReviewPolicy).where(HealthReviewPolicy.mission_code == mission, HealthReviewPolicy.retired_at.is_(None))
    if lock:
        query = query.with_for_update()
    return session.scalar(query)


def context_matches(**fields):
    point = MissionObservation.context
    return [point[key].astext == value for key, value in fields.items()]


def latest_readings(session: Session, conditions, count: int = 1) -> tuple[list[MissionObservation], str | None]:
    point = MissionObservation
    times = (select(point.recorded_at).where(*conditions).distinct()
             .order_by(point.recorded_at.desc()).limit(count))
    rows = session.scalars(select(point).where(*conditions, point.recorded_at.in_(times))
                          .order_by(point.recorded_at.desc(), point.id))
    by_time = {}
    for row in rows:
        previous = by_time.setdefault(row.recorded_at, row)
        if previous is not row and any(getattr(previous, field) != getattr(row, field) for field in (
            "value", "uncertainty", "quality", "device", "calibration", "provenance", "method", "context",
        )):
            return [], "The latest eligible timestamp contains conflicting reports."
    return list(by_time.values()), None


def measure_bounds(point: MissionObservation) -> tuple[float, float] | None:
    if point.quality != "verified" or point.value is None or point.uncertainty is None:
        return None
    minimum = PARAMETERS[point.parameter].minimum
    maximum = PARAMETERS[point.parameter].maximum
    lower, upper = point.value - point.uncertainty, point.value + point.uncertainty
    return max(lower, minimum) if minimum is not None else lower, min(upper, maximum) if maximum is not None else upper


def strictly_below(value: float, boundary: float) -> bool:
    return value < boundary and not isclose(value, boundary, rel_tol=1e-12)


def boundary_state(lower: float, upper: float, limit: float, comparator: Comparator) -> Outcome:
    if comparator == "minimum_inclusive":
        if not strictly_below(lower, limit):
            return "within_rule"
        if strictly_below(upper, limit):
            return "review_required"
    elif comparator == "maximum_exclusive":
        if strictly_below(upper, limit):
            return "within_rule"
        if not strictly_below(lower, limit):
            return "review_required"
    else:
        if not strictly_below(limit, upper):
            return "within_rule"
        if strictly_below(limit, lower):
            return "review_required"
    return "boundary_uncertain"


def make_decision(binding: Binding) -> Decision:
    if isinstance(binding, VitalBinding):
        definition = PARAMETERS[binding.parameter]
        return Decision(rule_id=binding.rule_id, title=definition.label, unit=definition.unit,
                        minimum=binding.lower, maximum=binding.upper, procedure_ref=binding.procedure_ref,
                        evidence=binding.source_ref)
    reference = REFERENCES[binding.rule_id]
    return Decision(rule_id=binding.rule_id, title=reference.title, unit=reference.unit,
                    minimum=reference.limit if reference.comparator == "minimum_inclusive" else None,
                    maximum=reference.limit if reference.comparator != "minimum_inclusive" else None,
                    maximum_exclusive=reference.comparator == "maximum_exclusive", procedure_ref=binding.procedure_ref,
                    evidence=f"{NASA_STANDARD} · {reference.requirement}", source_url=NASA_STANDARD_SOURCE)


def measured(result: Decision, mode: Outcome, value: float, lower: float, upper: float, samples: list[MissionObservation]):
    explanations = {
        "within_rule": "The documented uncertainty range is within the selected rule.",
        "review_required": "The documented uncertainty range is outside the selected rule.",
        "boundary_uncertain": "The documented uncertainty range overlaps a rule boundary.",
    }
    result.status = mode
    result.value, result.lower, result.upper = value, lower, upper
    result.observed_at = samples[0].recorded_at
    result.observation_ids = [sample.id for sample in samples]
    result.explanation = explanations[mode]


def ratio_decision(session: Session, scope, binding: RatioBinding, result: Decision, now: datetime):
    point = MissionObservation
    definition = REFERENCES[binding.rule_id]
    matching = (*scope, point.parameter == definition.parameter, *context_matches(
        kind="protocol", protocol=binding.protocol, version=binding.protocol_version, body_site=binding.body_site,
    ))
    latest, conflict = latest_readings(session, (*matching, point.phase == "in_flight", point.recorded_at <= now))
    if conflict or not latest:
        result.explanation = conflict or "A matching in-flight assessment is missing."
        return
    current = latest[0]
    if current.recorded_at < now - timedelta(minutes=binding.max_age_minutes):
        result.explanation = "The matching in-flight assessment is outside the approved age window."
        return
    current_bounds = measure_bounds(current)
    if current_bounds is None or not current.device or not current.calibration:
        result.explanation = "The current assessment needs verified quality, a device, calibration and uncertainty."
        return
    baseline, conflict = latest_readings(session, (
        *matching, point.phase == "preflight", point.recorded_at >= binding.baseline_start,
        point.recorded_at < min(binding.baseline_end, current.recorded_at), point.device == current.device,
        point.calibration == current.calibration, point.method == current.method, point.activity == current.activity,
        point.provenance == current.provenance,
    ))
    if conflict or not baseline:
        result.explanation = conflict or "The approved period has no comparable preflight assessment."
        return
    prior = baseline[0]
    prior_bounds = measure_bounds(prior)
    if prior_bounds is None or prior_bounds[0] <= 0:
        result.explanation = "The preflight assessment needs verified quality and a positive uncertainty range."
        return
    lower, upper = 100 * current_bounds[0] / prior_bounds[1], 100 * current_bounds[1] / prior_bounds[0]
    measured(result, boundary_state(lower, upper, definition.limit, definition.comparator),
             100 * current.value / prior.value, lower, upper, [current, prior])


def radiation_decision(session: Session, scope, binding: RadiationBinding, result: Decision, now: datetime):
    point = MissionObservation
    definition = REFERENCES[binding.rule_id]
    age_limit = now - timedelta(minutes=binding.max_age_minutes)
    latest, conflict = latest_readings(session, (
        *scope, point.parameter == definition.parameter, point.recorded_at <= now, *context_matches(
            kind="radiation_assessment", tissue=definition.tissue, model=binding.model, model_version=binding.model_version,
        ),
    ))
    if conflict or not latest:
        result.explanation = conflict or "The matching externally reviewed dosimetry report is missing."
        return
    current = latest[0]
    if current.recorded_at < age_limit:
        result.explanation = "The dosimetry report is outside the approved age window."
        return
    context = RadiationAssessment.model_validate(current.context)
    if current.quality != "verified" or not context.complete_history:
        result.explanation = "The dosimetry report requires verification and a complete exposure window."
        return
    if binding.rule_id == "career_effective_dose":
        if not context.includes_mission_projection or not context.excludes_medical_exposure:
            result.explanation = "The career report must include the upcoming mission and exclude medical exposures."
            return
    elif context.exposure_end < age_limit:
        result.explanation = "The 30-day organ window ends outside the approved age window."
        return
    measured(result, boundary_state(context.lower, context.upper, definition.limit, definition.comparator),
             current.value, context.lower, context.upper, [current])


def vital_state(bounds, binding: VitalBinding) -> tuple[Outcome, str | None]:
    lower, upper = bounds
    if binding.lower is not None and strictly_below(upper, binding.lower):
        return "review_required", "below"
    if binding.upper is not None and strictly_below(binding.upper, lower):
        return "review_required", "above"
    if ((binding.lower is not None and strictly_below(lower, binding.lower))
            or (binding.upper is not None and strictly_below(binding.upper, upper))):
        return "boundary_uncertain", None
    return "within_rule", None


def vital_decision(session: Session, scope, binding: VitalBinding, result: Decision, now: datetime):
    point = MissionObservation
    age_limit = now - timedelta(minutes=binding.max_age_minutes)
    samples, conflict = latest_readings(session, (
        *scope, point.parameter == binding.parameter, point.phase == "in_flight", point.location == binding.location,
        point.activity == binding.activity, point.device == binding.device, point.calibration == binding.calibration,
        point.recorded_at.between(age_limit, now), *context_matches(**binding.conditions.model_dump()),
    ), binding.consecutive)
    if conflict or not samples:
        result.explanation = conflict or "No current reading matches the approved measurement conditions."
        return
    current = samples[0]
    if current.provenance == "DEVICE_REPORTED":
        receipt = session.scalar(select(DeviceReceipt).where(
            DeviceReceipt.mission_code == current.mission_code, DeviceReceipt.channel_code == binding.device,
            DeviceReceipt.recorded_at <= now,
        ).order_by(DeviceReceipt.sequence.desc()).limit(1))
        if receipt is None or receipt.observation_id != current.id or receipt.status != "accepted":
            result.explanation = "The channel has a newer rejected or context-mismatched intake."
            return
    bounds = measure_bounds(current)
    if bounds is None:
        result.explanation = "The latest reading needs verified quality and measurement uncertainty."
        return
    mode, side = vital_state(bounds, binding)
    if mode != "review_required":
        measured(result, mode, current.value, *bounds, [current])
        return

    previous = current
    for sample in samples[1:]:
        other = measure_bounds(sample)
        if (other is None or sample.provenance != current.provenance
                or (previous.recorded_at - sample.recorded_at).total_seconds() > binding.maximum_gap_seconds
                or vital_state(other, binding) != ("review_required", side)):
            break
        previous = sample
    if len(samples) < binding.consecutive or previous is not samples[-1]:
        result.explanation = "Waiting for the approved number of consecutive readings on the same side of the boundary."
        return
    if current.provenance == "DEVICE_REPORTED":
        sequences = list(session.scalars(select(DeviceReceipt.sequence).where(
            DeviceReceipt.mission_code == current.mission_code, DeviceReceipt.channel_code == binding.device,
            DeviceReceipt.observation_id.in_([sample.id for sample in samples]),
        ).order_by(DeviceReceipt.sequence.desc())))
        if sequences != list(range(receipt.sequence, receipt.sequence - len(samples), -1)):
            result.explanation = "A missing or rejected device sequence interrupts the confirmation readings."
            return
    measured(result, mode, current.value, *bounds, samples)


def evaluate(session: Session, mission: str, crew: str, policy: ReviewPolicy, now: datetime) -> list[Decision]:
    scope = scoped(mission, crew)
    handlers = {"ratio": ratio_decision, "radiation": radiation_decision, "vital": vital_decision}
    result = []
    for binding in policy.rules:
        decision = make_decision(binding)
        handlers[binding.kind](session, scope, binding, decision, now)
        if decision.status in {"review_required", "boundary_uncertain"}:
            fingerprint = [policy.version, policy.reference_version, decision.rule_id, decision.status,
                           *map(str, decision.observation_ids)]
            decision.decision_key = sha256(dumps(fingerprint, separators=(",", ":")).encode()).hexdigest()
        result.append(decision)
    return result


def latest_model_outputs(session: Session, mission: str, crew: str, through: datetime) -> list[Observation]:
    point = MissionObservation
    outputs = []
    for quantity, tissue in EXTERNAL_RESULTS:
        rows, conflict = latest_readings(session, (
            *scoped(mission, crew), point.parameter == quantity, point.recorded_at <= through,
            *context_matches(tissue=tissue),
        ))
        if not conflict and rows and rows[0].quality == "verified":
            outputs.append(Observation.model_validate(rows[0]))
    return outputs


@router.get("/missions/{mission_code}/crew/{crew_code}/health-review")
def health_review(mission_code: Code, crew_code: Code, access: ObservationAccess, session: DbSession) -> DecisionReport:
    authorize(access, mission_code, "crew")
    authorize_crew(access, mission_code, crew_code)
    now = datetime.now(UTC)
    active = active_policy(session, mission_code)
    policy = ReviewPolicy.model_validate(active.configuration) if active else None
    decisions = evaluate(session, mission_code, crew_code, policy, now) if policy else []
    keys = [item.decision_key for item in decisions if item.decision_key]
    receipts = session.scalars(select(HealthReviewAcknowledgment).where(
        HealthReviewAcknowledgment.mission_code == mission_code, HealthReviewAcknowledgment.crew_code == crew_code,
        HealthReviewAcknowledgment.decision_key.in_(keys),
    )) if keys else ()
    verified = {item.decision_key: Acknowledgment.model_validate(item) for item in receipts}
    for decision in decisions:
        decision.acknowledgment = verified.get(decision.decision_key)
    recent = session.scalars(select(HealthReviewAcknowledgment).where(
        HealthReviewAcknowledgment.mission_code == mission_code, HealthReviewAcknowledgment.crew_code == crew_code,
    ).order_by(HealthReviewAcknowledgment.recorded_at.desc(), HealthReviewAcknowledgment.decision_key).limit(20))
    report = DecisionReport(evaluated_at=now, policy=policy, decisions=decisions,
                            references=[{"rule_id": key, **asdict(rule), "source_url": NASA_STANDARD_SOURCE,
                                         "standard": NASA_STANDARD} for key, rule in REFERENCES.items()],
                            model_results=latest_model_outputs(session, mission_code, crew_code, now),
                            recent_acknowledgments=[
                                PastAcknowledgment(**Acknowledgment.model_validate(row).model_dump(),
                                                   policy_version=row.policy_version, title=row.snapshot["title"])
                                for row in recent
                            ])
    session.add(ObservationAudit(actor=access.actor, action="health_review", mission_code=mission_code,
                                 scope="crew", crew_code=crew_code))
    session.commit()
    return report


@router.post("/missions/{mission_code}/crew/{crew_code}/health-review/acknowledgments")
def acknowledge(mission_code: Code, crew_code: Code, payload: AcknowledgeInput, access: ObservationAccess,
                session: DbSession) -> Acknowledgment:
    authorize(access, mission_code, "crew", write=True)
    authorize_crew(access, mission_code, crew_code)
    identity = (mission_code, crew_code, payload.decision_key)
    existing = session.get(HealthReviewAcknowledgment, identity)
    if existing is not None:
        if existing.action != payload.action:
            raise HTTPException(409, "This finding already has a recorded acknowledgment.")
        return Acknowledgment.model_validate(existing)

    active = active_policy(session, mission_code, lock=True)
    if active is None:
        raise HTTPException(409, "There is no active review policy for this mission.")
    now = datetime.now(UTC)
    policy = ReviewPolicy.model_validate(active.configuration)
    decision = next((row for row in evaluate(session, mission_code, crew_code, policy, now)
                     if row.decision_key == payload.decision_key), None)
    if decision is None:
        raise HTTPException(409, "The rule or evidence changed. Refresh before acknowledging this finding.")
    snapshot = decision.model_dump(mode="json", exclude={"acknowledgment"}) | {"policy_reference_version": policy.reference_version}
    record = session.scalar(insert(HealthReviewAcknowledgment).values(
        mission_code=mission_code, crew_code=crew_code, decision_key=payload.decision_key,
        action=payload.action, actor=access.actor, policy_version=active.version, recorded_at=now, snapshot=snapshot,
    ).on_conflict_do_nothing().returning(HealthReviewAcknowledgment))
    if record is None:
        record = session.get(HealthReviewAcknowledgment, identity)
        if record.action != payload.action:
            raise HTTPException(409, "This finding already has a recorded acknowledgment.")
    else:
        session.add(ObservationAudit(actor=access.actor, action="health_ack", mission_code=mission_code,
                                     scope="crew", crew_code=crew_code))
    response = Acknowledgment.model_validate(record)
    session.commit()
    return response
