from collections import defaultdict
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import model_validator
from sqlalchemy import func, select

from .crew_monitoring import scoped
from .database import DbSession
from .models import DeviceChannel, DeviceReceipt, MissionClock, MissionObservation, ObservationAudit
from .observation_access import ObservationAccess
from .observation_context import PERSONAL_RATES, PERSONAL_TOTALS, RADIATION_ESTIMATES, RadiationContext
from .observations import Observation, authorize, authorize_crew
from .schemas import ApiModel, Code, Timestamp

router = APIRouter(prefix="/api/v1/observations", tags=["Personal radiation dose"])


class DoseWindow(ApiModel):
    mode: Literal["period", "mission"] = "period"
    start: Timestamp | None = None
    end: Timestamp | None = None

    @model_validator(mode="after")
    def valid_window(self):
        now = datetime.now(UTC)
        end = self.end or now
        if self.mode == "mission":
            if self.start is not None or end > now:
                raise ValueError("Provide only an elapsed end date for a mission radiation review.")
            return self
        start = self.start or end - timedelta(days=30)
        if not start < end <= now or end - start > timedelta(days=366):
            raise ValueError("Choose a completed radiation window of up to 366 days.")
        return self


class DoseDay(ApiModel):
    date: str
    covered_hours: float
    dose: float
    running_observed_dose: float


class IntegratedDose(ApiModel):
    channel: str
    location: str
    calibration: str
    context: RadiationContext
    parameter: str
    unit: str
    last_rate: float | None
    last_sample: Timestamp | None
    reported_rate_unit: str
    dose: float | None
    rad: float | None
    lower: float | None
    upper: float | None
    coverage: float
    covered_hours: float
    gap_intervals: int
    daily: list[DoseDay]


class DoseCounter(ApiModel):
    observation: Observation
    change: float | None
    rad: float | None
    reset: bool


class CrewRadiation(ApiModel):
    start: Timestamp
    end: Timestamp
    start_source: Literal["selected_period", "mission_clock", "first_record"]
    channels: list[IntegratedDose]
    counters: list[DoseCounter]
    estimates: list[Observation]
    reported_rates: list[Observation]


def integrate(rows, max_seconds: float | None, start: datetime, end: datetime) -> dict:
    days = defaultdict(lambda: [0.0, 0.0])
    covered = low = high = 0.0
    bounded = True
    last_value = None
    last_time = None
    broken = 0
    previous = None

    for row in rows:
        if row.value is not None:
            last_value, last_time = row.value, row.recorded_at
        if previous is not None:
            duration = (row.recorded_at - previous.recorded_at).total_seconds()
            usable = (max_seconds is not None and 0 < duration <= max_seconds
                      and row.sequence == previous.sequence + 1 and previous.value is not None and row.value is not None)
            if usable:
                covered += duration
                if previous.uncertainty is None or row.uncertainty is None:
                    bounded = False
                elif bounded:
                    low += (max(0, previous.value - previous.uncertainty) + max(0, row.value - row.uncertainty)) * duration / 7_200_000
                    high += (previous.value + previous.uncertainty + row.value + row.uncertainty) * duration / 7_200_000

                # Integrate linear interpolation separately on each UTC day.
                segment = previous.recorded_at
                while segment < row.recorded_at:
                    midnight = segment.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
                    right = min(midnight, row.recorded_at)
                    derivative = (row.value - previous.value) / duration
                    left_rate = previous.value + derivative * (segment - previous.recorded_at).total_seconds()
                    right_rate = previous.value + derivative * (right - previous.recorded_at).total_seconds()
                    seconds = (right - segment).total_seconds()
                    entry = days[segment.date().isoformat()]
                    entry[0] += seconds
                    entry[1] += (left_rate + right_rate) * seconds / 7_200_000
                    segment = right
            else:
                broken += 1
        previous = row

    running = 0.0
    daily = []
    for date, (seconds, dose) in days.items():
        running += dose
        daily.append(DoseDay(date=date, covered_hours=seconds / 3600, dose=dose, running_observed_dose=running))
    return {"dose": running if covered else None, "lower": low if covered and bounded else None,
            "upper": high if covered and bounded else None, "coverage": min(covered / (end - start).total_seconds(), 1),
            "covered_hours": covered / 3600, "daily": daily, "gap_intervals": broken,
            "last_rate": last_value, "last_sample": last_time}


def counter_reports(rows) -> list[DoseCounter]:
    by_series = defaultdict(list)
    for row in rows:
        identity = (row.parameter, row.unit, row.device, row.calibration, row.location, row.phase, row.provenance,
                    tuple(sorted((row.context or {}).items())))
        by_series[identity].append(row)
    output = []
    for series in by_series.values():
        latest = series[-1]
        unit, multiplier = PERSONAL_TOTALS[latest.parameter]
        if latest.unit != unit:
            continue
        reset = any(b.value < a.value for a, b in pairwise(series))
        conflict = any(b.recorded_at == a.recorded_at and b.value != a.value for a, b in pairwise(series))
        changed = latest.value - series[0].value if len(series) > 1 and series[0].recorded_at < latest.recorded_at and not (reset or conflict) else None
        output.append(DoseCounter(observation=Observation.model_validate(latest), change=changed,
                                  rad=latest.value * multiplier if multiplier is not None else None, reset=reset))
    return output


@router.get("/missions/{mission_code}/crew/{crew_code}/radiation")
def personal_radiation(mission_code: Code, crew_code: Code, window: Annotated[DoseWindow, Query()],
                       access: ObservationAccess, session: DbSession) -> CrewRadiation:
    authorize(access, mission_code, "crew")
    authorize_crew(access, mission_code, crew_code)
    end = window.end or datetime.now(UTC)
    start = window.start or end - timedelta(days=30)
    start_source = "selected_period"
    point = MissionObservation
    scope = scoped(mission_code, crew_code)
    dosimetry_parameters = PERSONAL_RATES.keys() | PERSONAL_TOTALS.keys() | RADIATION_ESTIMATES
    if window.mode == "mission":
        clock = session.get(MissionClock, mission_code)
        if clock is not None:
            if clock.epoch >= end:
                raise HTTPException(422, "The review date must follow the mission clock epoch.")
            start, start_source = clock.epoch, "mission_clock"
        else:
            first = session.scalar(select(func.min(point.recorded_at)).where(
                *scope, point.parameter.in_(dosimetry_parameters), point.recorded_at <= end,
                point.quality == "verified",
            ))
            if first is not None:
                start, start_source = min(first, end - timedelta(microseconds=1)), "first_record"
    channels = session.scalars(select(DeviceChannel).where(
        DeviceChannel.mission_code == mission_code, DeviceChannel.crew_code == crew_code,
        DeviceChannel.configuration["parameter"].astext.in_(PERSONAL_RATES),
    ).order_by(DeviceChannel.code)).all()
    results = []
    for channel in channels:
        setup = channel.configuration
        cadence = setup["sample_interval_ms"]
        maximum_interval = (cadence + 2 * setup["clock_tolerance_ms"]) / 1000 if cadence is not None else None
        parameter = setup["parameter"]
        query = (select(DeviceReceipt.sequence, DeviceReceipt.recorded_at, MissionObservation.value, MissionObservation.uncertainty)
                 .outerjoin(MissionObservation, MissionObservation.id == DeviceReceipt.observation_id)
                 .where(DeviceReceipt.mission_code == mission_code, DeviceReceipt.channel_code == channel.code,
                        DeviceReceipt.recorded_at.between(start, end))
                 .order_by(DeviceReceipt.sequence))
        unit, multiplier = PERSONAL_RATES[parameter]
        values = integrate(session.execute(query).yield_per(500), maximum_interval, start, end)
        if values["last_rate"] is None:
            continue
        dose = values["dose"]
        results.append(IntegratedDose(channel=channel.code, location=setup["location"], calibration=setup["calibration"],
                                      context=RadiationContext.model_validate(setup["context"]), parameter=parameter,
                                      unit=unit, reported_rate_unit=setup["unit"],
                                      rad=dose * multiplier if dose is not None and multiplier is not None else None, **values))

    relevant = session.scalars(select(point).where(
        *scope, point.parameter.in_(PERSONAL_TOTALS.keys() | RADIATION_ESTIMATES),
        point.recorded_at.between(start, end), point.quality == "verified",
    ).order_by(point.recorded_at, point.id)).all()
    estimates = {}
    for item in relevant:
        if item.parameter in RADIATION_ESTIMATES:
            context = item.context or {}
            estimates[(item.parameter, context.get("tissue"), context.get("model_version"))] = Observation.model_validate(item)
    manual_rates = session.scalars(select(point).where(
        *scope, point.parameter.in_(PERSONAL_RATES),
        point.recorded_at.between(start, end), point.provenance != "DEVICE_REPORTED",
        point.quality == "verified",
    ).order_by(point.parameter, point.device, point.recorded_at.desc(), point.id.desc())
      .distinct(point.parameter, point.device))
    report = CrewRadiation(start=start, end=end, start_source=start_source, channels=results,
                           counters=counter_reports(row for row in relevant if row.parameter in PERSONAL_TOTALS),
                           estimates=list(estimates.values()), reported_rates=[Observation.model_validate(row) for row in manual_rates])
    session.add(ObservationAudit(actor=access.actor, action="crew_dose", mission_code=mission_code, scope="crew", crew_code=crew_code))
    session.commit()
    return report
