from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from sqlalchemy import select

from .database import DbSession
from .models import DeviceChannel, DeviceReceipt, MissionObservation, ObservationAudit
from .observation_access import ObservationAccess
from .observation_context import RADIATION_RATES
from .observation_registry import PARAMETERS
from .observations import authorize, authorize_crew
from .schemas import ApiModel, Code, Reading, Timestamp
from .telemetry import ChannelSettings

router = APIRouter(prefix="/api/v1/observations", tags=["Radiation review"])


class ReviewRequest(ApiModel):
    channel: Code
    end: Timestamp
    boundary: Annotated[Reading, Field(ge=0, le=1e12)]
    window_seconds: Annotated[int, Field(strict=True, ge=2, le=86_400)]
    maximum_gap_seconds: Annotated[int, Field(strict=True, ge=1, le=86_400)]
    minimum_coverage: Annotated[Reading, Field(gt=0, le=1)]
    minimum_exceedance_seconds: Annotated[int, Field(strict=True, ge=1, le=86_400)]
    uncertainty_margin: Annotated[Reading, Field(ge=0, le=1e12)]
    @model_validator(mode="after")
    def check_window(self):
        if max(self.maximum_gap_seconds, self.minimum_exceedance_seconds) > self.window_seconds:
            raise ValueError("Gap and exceedance duration must fit the review window.")
        if self.end > datetime.now(UTC):
            raise ValueError("Choose a completed review window.")
        return self


class ReviewResult(ApiModel):
    parameter: str
    unit: str
    start: Timestamp
    end: Timestamp
    coverage: float
    longest_exceedance_seconds: float
    result: Literal["insufficient_data", "boundary_exceeded", "boundary_not_observed"]


@router.post("/missions/{mission_code}/radiation/review")
def review_radiation(mission_code: Code, payload: ReviewRequest, access: ObservationAccess,
                     session: DbSession) -> ReviewResult:
    if mission_code not in access.missions:
        raise HTTPException(403, "This credential does not grant access to the requested records.")
    channel = session.get(DeviceChannel, (mission_code, payload.channel))
    if channel is None:
        raise HTTPException(404, "No registered channel matches this review.")
    settings = ChannelSettings.model_validate(channel.configuration | {"crew_code": channel.crew_code})
    scope = PARAMETERS[settings.parameter].scope
    authorize(access, mission_code, scope)
    authorize_crew(access, mission_code, channel.crew_code)
    if settings.parameter not in RADIATION_RATES:
        raise HTTPException(422, "Choose a registered radiation rate channel.")
    start = payload.end - timedelta(seconds=payload.window_seconds)
    query = (select(DeviceReceipt.sequence, DeviceReceipt.recorded_at, MissionObservation.value,
                    MissionObservation.uncertainty)
             .outerjoin(MissionObservation, MissionObservation.id == DeviceReceipt.observation_id)
             .where(DeviceReceipt.mission_code == mission_code, DeviceReceipt.channel_code == channel.code,
                    DeviceReceipt.recorded_at.between(start, payload.end))
             .order_by(DeviceReceipt.sequence))
    covered = current = longest = 0.0
    # An interval needs adjacent, uncertainty-qualified samples at both ends.
    rows = session.execute(query).yield_per(500)
    previous = None
    for row in rows:
        if previous is not None:
            duration = (row.recorded_at - previous.recorded_at).total_seconds()
            usable = (row.sequence == previous.sequence + 1 and 0 < duration <= payload.maximum_gap_seconds
                      and None not in (row.value, previous.value, row.uncertainty, previous.uncertainty))
            if usable:
                covered += duration
            exceeded = usable and all(
                sample.value - sample.uncertainty - payload.uncertainty_margin > payload.boundary
                for sample in (previous, row)
            )
            current = current + duration if exceeded else 0.0
            longest = max(longest, current)
        previous = row

    coverage = min(1.0, covered / payload.window_seconds)
    if coverage < payload.minimum_coverage:
        result = "insufficient_data"
    elif longest >= payload.minimum_exceedance_seconds:
        result = "boundary_exceeded"
    else:
        result = "boundary_not_observed"
    session.add(ObservationAudit(actor=access.actor, mission_code=mission_code, action="radiation_review",
                                 scope=scope, crew_code=channel.crew_code))
    session.commit()
    return ReviewResult(parameter=settings.parameter, unit=settings.unit,
                        start=start, end=payload.end, coverage=coverage,
                        longest_exceedance_seconds=longest, result=result)
