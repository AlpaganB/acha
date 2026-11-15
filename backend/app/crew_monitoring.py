from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from .database import DbSession
from .models import DeviceChannel, MissionObservation, ObservationAudit
from .monitoring_baseline import (
    ADAPTATION_INDICATORS, INDICATORS, Indicator, IndicatorReport, MonitoringWindow, calculate_reference, daily_readings, reference_bounds,
)
from .observation_access import ObservationAccess
from .observation_context import ExerciseInterval, GravityInterval
from .observation_registry import PARAMETERS
from .observations import authorize, authorize_crew
from .schemas import ApiModel, Code, Timestamp

router = APIRouter(prefix="/api/v1/observations", tags=["Crew monitoring"])
INTAKE = ("energy_intake", "protein_intake", "fluid_intake", "sodium_intake")
CONTEXT_KEYS = {
    "reading": ("posture", "timing"),
    "sleep_episode": ("method", "shift", "utc_offset_minutes"),
    "performance": ("protocol", "version", "trials", "shift", "utc_offset_minutes", "illuminance_lux", "workload"),
    "protocol": ("protocol", "version", "body_site"),
}


class CrewIdentity(ApiModel):
    crew_code: Code
    last_observation: Timestamp | None = None


class AdaptationReading(ApiModel):
    parameter: str
    label: str
    unit: str
    phase: str
    value: float
    recorded_at: Timestamp
    preflight: float | None
    change: float | None
    percentage_change: float | None
    days: int


class DailyContext(ApiModel):
    date: str
    intake: dict[str, float | None]
    exercise_minutes: float | None
    exercise_by_mode: dict[str, float]
    exercise_conflict_minutes: float
    untimed_exercise_minutes: float | None


class GravityReport(ApiModel):
    since: Timestamp
    through: Timestamp
    hours: dict[str, float]
    conflict_hours: float
    unlogged_hours: float


class CrewReport(IndicatorReport):
    adaptation: list[AdaptationReading]
    daily_context: list[DailyContext]
    gravity: GravityReport | None


@router.get("/missions/{mission_code}/crew")
def mission_crew(mission_code: Code, access: ObservationAccess, session: DbSession) -> list[CrewIdentity]:
    authorize(access, mission_code, "crew")
    permitted = access.crew.get(mission_code, []) if access.crew is not None else None
    latest = select(MissionObservation.crew_code, func.max(MissionObservation.recorded_at)).where(
        MissionObservation.mission_code == mission_code, MissionObservation.scope == "crew",
    ).group_by(MissionObservation.crew_code)
    devices = select(DeviceChannel.crew_code).where(DeviceChannel.mission_code == mission_code,
                                                    DeviceChannel.crew_code.is_not(None)).distinct()
    if permitted is not None:
        latest = latest.where(MissionObservation.crew_code.in_(permitted))
        devices = devices.where(DeviceChannel.crew_code.in_(permitted))
    identities = dict(session.execute(latest).all())
    for crew in [*(permitted or []), *session.scalars(devices)]:
        identities.setdefault(crew, None)
    session.add(ObservationAudit(actor=access.actor, action="crew_roster", mission_code=mission_code, scope="crew"))
    session.commit()
    return [CrewIdentity(crew_code=crew, last_observation=identities[crew]) for crew in sorted(identities)]


def scoped(mission: str, crew: str):
    return (MissionObservation.mission_code == mission, MissionObservation.crew_code == crew,
            MissionObservation.scope == "crew")


def comparable(record: MissionObservation):
    fields = ("parameter", "unit", "method", "provenance", "device", "calibration", "activity")
    criteria = [getattr(MissionObservation, field) == getattr(record, field) for field in fields]
    context = record.context
    if context is None:
        return criteria + [MissionObservation.context.is_(None)]
    kind = context["kind"]
    criteria.append(MissionObservation.context["kind"].astext == kind)
    for key in CONTEXT_KEYS.get(kind, ()):
        value = context.get(key)
        criteria.append(MissionObservation.context[key].astext == (str(value) if value is not None else None))
    return criteria


def latest_points(session: DbSession, conditions, parameters: tuple[str, ...]):
    points = session.scalars(
        select(MissionObservation).where(*conditions, MissionObservation.parameter.in_(parameters),
                                         MissionObservation.value.is_not(None))
        .order_by(MissionObservation.parameter, MissionObservation.recorded_at.desc(), MissionObservation.id.desc())
        .distinct(MissionObservation.parameter)
    )
    return {point.parameter: point for point in points}


def make_indicator(session: DbSession, conditions, current: MissionObservation, window: MonitoringWindow) -> Indicator:
    point = MissionObservation
    comparison = (*conditions, *comparable(current), point.phase == current.phase, point.location == current.location,
                  point.quality == "verified", point.value.is_not(None))
    start, end = reference_bounds(current.recorded_at, window.reference_start, window.reference_end)
    history = daily_readings(session, select(point.recorded_at, point.value, point.uncertainty).where(
        *comparison, point.recorded_at >= start, point.recorded_at < end,
    ))
    conflict = session.scalar(select(point.id).where(
        *comparison, point.recorded_at == current.recorded_at, point.value != current.value,
    ).limit(1))
    blocked = "quality" if current.quality != "verified" else "conflict" if conflict is not None else None
    context = current.context or {}
    return Indicator(parameter=current.parameter, label=PARAMETERS[current.parameter].label, unit=current.unit,
                     value=current.value, recorded_at=current.recorded_at, phase=current.phase, activity=current.activity,
                     device=current.device, quality=current.quality, posture=context.get("posture"), timing=context.get("timing"),
                     reference=calculate_reference(current.value, current.uncertainty, history, start, end, blocked=blocked))


def adaptation_report(session: DbSession, conditions, window: MonitoringWindow) -> list[AdaptationReading]:
    point = MissionObservation
    latest = latest_points(session, (*conditions, point.phase != "preflight"), ADAPTATION_INDICATORS)
    result = []
    for parameter in ADAPTATION_INDICATORS:
        current = latest.get(parameter)
        if current is None:
            continue
        start = window.reference_start or current.recorded_at - timedelta(days=366)
        end = min(window.reference_end or current.recorded_at, current.recorded_at)
        matching = (*conditions, *comparable(current), point.quality == "verified", point.value.is_not(None))
        candidates = daily_readings(session, select(point.recorded_at, point.value, point.uncertainty).where(
            *matching, point.phase == "preflight", point.recorded_at >= start, point.recorded_at < end,
        )) if current.context is not None else []
        conflict = session.scalar(select(point.id).where(*matching, point.phase == current.phase,
                                  point.location == current.location, point.recorded_at == current.recorded_at,
                                  point.value != current.value).limit(1))
        reference = calculate_reference(current.value, current.uncertainty, candidates, start, end,
                                        blocked="quality" if current.quality != "verified" else "conflict" if conflict else None)
        percent = reference.change / reference.median * 100 if reference.change is not None and reference.median else None
        result.append(AdaptationReading(parameter=parameter, label=PARAMETERS[parameter].label, unit=current.unit,
                                       phase=current.phase, value=current.value, recorded_at=current.recorded_at,
                                       preflight=reference.median, change=reference.change, percentage_change=percent,
                                       days=reference.days))
    return result


def interval_totals(intervals, start: datetime, end: datetime) -> tuple[dict[str, float], float]:
    """Return labelled seconds and seconds carrying conflicting labels inside a bounded window."""
    events = []
    for left, right, label in intervals:
        left, right = max(left, start), min(right, end)
        if left < right:
            events.extend(((left, label, 1), (right, label, -1)))
    counts: dict[str, int] = {}
    totals: dict[str, float] = {}
    conflict = 0.0
    last = start
    for time, label, delta in sorted(events):
        seconds = (time - last).total_seconds()
        if seconds:
            if len(counts) == 1:
                key = next(iter(counts))
                totals[key] = totals.get(key, 0) + seconds
            elif counts:
                conflict += seconds
        counts[label] = counts.get(label, 0) + delta
        if counts[label] == 0:
            del counts[label]
        last = time
    return totals, conflict


def add_unique(records, parameter: str, start: datetime, end: datetime) -> float | None:
    observations = {}
    for row in records:
        if row.parameter == parameter and start <= row.recorded_at < end and row.value is not None:
            observations.setdefault(row.recorded_at, set()).add(row.value)
    values = [next(iter(group)) for group in observations.values() if len(group) == 1]
    return sum(values) if values else None


def daily_context(session: DbSession, conditions, through: datetime) -> list[DailyContext]:
    last_day = through.replace(hour=0, minute=0, second=0, microsecond=0)
    start = last_day - timedelta(days=6)
    observations = list(session.scalars(select(MissionObservation).where(
        *conditions, MissionObservation.parameter.in_((*INTAKE, "exercise_minutes")),
        MissionObservation.recorded_at >= start, MissionObservation.quality != "suspect",
    )))
    if not observations:
        return []
    untimed = [row for row in observations if row.parameter == "exercise_minutes" and row.context is None]
    intervals = []
    for row in observations:
        if row.parameter == "exercise_minutes" and row.context is not None:
            item = ExerciseInterval.model_validate(row.context)
            intervals.append((item.start, item.end, item.mode + " · " + item.intensity))
    days = []
    for index in range(7):
        day = start + timedelta(days=index)
        cutoff = min(day + timedelta(days=1), through + timedelta(microseconds=1))
        exercise, conflict = interval_totals(intervals, day, cutoff)
        days.append(DailyContext(date=day.date().isoformat(),
                                 intake={name: add_unique(observations, name, day, cutoff) for name in INTAKE},
                                 exercise_minutes=sum(exercise.values()) / 60 if exercise else None,
                                 exercise_by_mode={name: seconds / 60 for name, seconds in exercise.items()},
                                 exercise_conflict_minutes=conflict / 60,
                                 untimed_exercise_minutes=add_unique(untimed, "exercise_minutes", day, cutoff)))
    return days


def gravity_report(session: DbSession, conditions, through: datetime) -> GravityReport | None:
    # Reject contradictory regimes in overlap, even if they were recorded at different locations.
    start = through - timedelta(days=30)
    context = MissionObservation.context
    rows = session.scalars(select(context).where(
        *conditions, MissionObservation.parameter == "gravity_exposure_minutes",
        MissionObservation.recorded_at >= start, MissionObservation.quality == "verified",
    ))
    intervals = []
    for row in rows:
        interval = GravityInterval.model_validate(row)
        intervals.append((interval.start, interval.end, interval.regime))
    totals, conflict = interval_totals(intervals, start, through)
    if not totals and not conflict:
        return None
    return GravityReport(since=start, through=through, hours={name: seconds / 3600 for name, seconds in totals.items()},
                         conflict_hours=conflict / 3600,
                         unlogged_hours=((through - start).total_seconds() - sum(totals.values()) - conflict) / 3600)


@router.get("/missions/{mission_code}/crew/{crew_code}/monitoring")
def crew_report(mission_code: Code, crew_code: Code, window: Annotated[MonitoringWindow, Query()],
                access: ObservationAccess, session: DbSession) -> CrewReport:
    authorize(access, mission_code, "crew")
    authorize_crew(access, mission_code, crew_code)
    through = window.through or datetime.now(UTC)
    conditions = (*scoped(mission_code, crew_code), MissionObservation.recorded_at <= through)
    latest = latest_points(session, conditions, INDICATORS)
    report = CrewReport(through=through, indicators=[make_indicator(session, conditions, latest[key], window)
                                                     for key in INDICATORS if key in latest],
                        adaptation=adaptation_report(session, conditions, window), daily_context=daily_context(session, conditions, through),
                        gravity=gravity_report(session, conditions, through))
    session.add(ObservationAudit(actor=access.actor, action="crew_monitoring", mission_code=mission_code, scope="crew", crew_code=crew_code))
    session.commit()
    return report
