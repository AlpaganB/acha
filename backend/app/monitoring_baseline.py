from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Literal

from pydantic import model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .schemas import ApiModel, Timestamp

REFERENCE_DAYS = 30
MIN_REFERENCE_DAYS = 5
INDICATORS = (
    "heart_rate", "spo2", "respiratory_rate", "systolic_bp", "diastolic_bp",
    "core_temperature", "sleep_minutes", "sleep_episode_minutes", "body_mass",
    "grip_strength", "reaction_time",
)
ADAPTATION_INDICATORS = ("body_mass", "grip_strength", "vo2_peak", "bone_mineral_density")


class MonitoringWindow(ApiModel):
    through: Timestamp | None = None
    reference_start: Timestamp | None = None
    reference_end: Timestamp | None = None

    @model_validator(mode="after")
    def check_window(self):
        through = self.through or datetime.now(UTC)
        if through > datetime.now(UTC):
            raise ValueError("Review through an elapsed observation time.")
        if (self.reference_start is None) != (self.reference_end is None):
            raise ValueError("Provide both reference dates.")
        if self.reference_start is not None and (
            not self.reference_start < self.reference_end <= through
            or self.reference_end - self.reference_start > timedelta(days=366)
        ):
            raise ValueError("Choose a reference period of up to 366 days ending by the review date.")
        return self


class Reference(ApiModel):
    start: Timestamp
    end: Timestamp
    days: int
    median: float | None = None
    change: float | None = None
    lower: float | None = None
    upper: float | None = None
    status: Literal["collecting", "flat_history", "within", "above", "below", "quality", "conflict"]


class Indicator(ApiModel):
    parameter: str
    label: str
    unit: str
    value: float
    recorded_at: Timestamp
    phase: str | None = None
    activity: str | None = None
    posture: str | None = None
    timing: str | None = None
    device: str | None = None
    quality: str
    reference: Reference


class IndicatorReport(ApiModel):
    through: Timestamp
    indicators: list[Indicator]


@dataclass(frozen=True)
class DailyReading:
    value: float
    uncertainty: float | None


def daily_readings(session: Session, statement) -> list[DailyReading]:
    candidates = statement.subquery()
    # Same-time conflicting values do not vote for the baseline. Repeated identical results count once.
    resolved = (
        select(candidates.c.recorded_at, func.min(candidates.c.value).label("value"),
               func.max(candidates.c.uncertainty).label("uncertainty"))
        .group_by(candidates.c.recorded_at)
        .having(func.min(candidates.c.value) == func.max(candidates.c.value))
        .subquery()
    )
    day = func.date_trunc("day", func.timezone("UTC", resolved.c.recorded_at))
    query = select(func.percentile_cont(0.5).within_group(resolved.c.value), func.max(resolved.c.uncertainty)).group_by(day)
    return [DailyReading(value, uncertainty) for value, uncertainty in session.execute(query)]


def reference_bounds(recorded_at: datetime, start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    through = min(end or recorded_at, recorded_at)
    return min(start or recorded_at - timedelta(days=REFERENCE_DAYS), through), through


def calculate_reference(value: float, uncertainty: float | None, days: list[DailyReading],
                        start: datetime, end: datetime, *, blocked: Literal["quality", "conflict"] | None = None) -> Reference:
    reference = Reference(start=start, end=end, days=len(days), status=blocked or "collecting")
    if not days:
        return reference
    center = median(day.value for day in days)
    reference.median = center
    if blocked is not None:
        return reference
    reference.change = value - center
    if len(days) < MIN_REFERENCE_DAYS:
        return reference

    deviation = median(abs(day.value - center) for day in days)
    historical_uncertainty = median([day.uncertainty for day in days if day.uncertainty is not None] or [0])
    width = max(3 * 1.4826 * deviation, historical_uncertainty + (uncertainty or 0))
    if width == 0:
        reference.status = "flat_history"
        return reference
    reference.lower, reference.upper = center - width, center + width
    reference.status = "above" if value > reference.upper else "below" if value < reference.lower else "within"
    return reference
