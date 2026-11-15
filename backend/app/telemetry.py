from datetime import UTC, datetime
from hashlib import sha256
from secrets import compare_digest
from typing import Annotated, Literal, Self
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import Field, model_validator
from sqlalchemy import func, select

from .database import DbSession
from .models import DeviceChannel, DeviceReceipt, MissionClock, MissionObservation, ObservationAudit
from .observation_access import ObservationAccess, bearer
from .observation_context import PROTOCOL_PARAMETERS, RADIATION_CHANNELS, READING_PARAMETERS, ProtocolContext, RadiationContext, ReadingContext
from .observation_registry import PARAMETERS
from .observations import Activity, ObservationInput, Phase, Scope, authorize, authorize_crew
from .schemas import ApiModel, Code, Name, Reading, Timestamp

router = APIRouter(prefix="/api/v1/observations", tags=["Device ingest"])
Sequence = Annotated[int, Field(strict=True, ge=0, le=9_007_199_254_740_991)]
BoundedValue = Annotated[Reading, Field(ge=-1e12, le=1e12)]
MillisecondError = Annotated[int, Field(strict=True, ge=0, le=60_000)]


class ChannelSettings(ApiModel):
    parameter: Code
    unit: Name
    hardware: Name
    firmware: Name
    calibration: Name
    operating_limits_ref: Name
    location: Code
    location_ref: Name
    crew_code: Code | None = None
    phase: Phase
    sample_interval_ms: Annotated[int, Field(strict=True, gt=0, le=86_400_000)] | None
    clock_tolerance_ms: MillisecondError
    minimum: BoundedValue
    maximum: BoundedValue
    context: RadiationContext | ProtocolContext | ReadingContext | None = None

    @model_validator(mode="after")
    def check_channel(self) -> Self:
        parameter = PARAMETERS.get(self.parameter)
        if parameter is None or parameter.input_kind != "number" or parameter.method not in {
            "instrument_transcribed", "manual_count", "protocol_transcribed",
        } or self.parameter in {"sleep_episode_minutes", "reaction_time", "task_accuracy",
                                "organ_equivalent_dose_estimate", "effective_dose_estimate", "gravity_exposure_minutes"}:
            raise ValueError("This parameter is unavailable for device ingestion.")
        if self.unit != parameter.unit or (parameter.scope == "crew") != (self.crew_code is not None):
            raise ValueError("Channel unit and crew scope must match the parameter registry.")
        if self.minimum >= self.maximum or (
            parameter.minimum is not None and self.minimum < parameter.minimum
        ) or (parameter.maximum is not None and self.maximum > parameter.maximum):
            raise ValueError("Channel measurement bounds must fit the parameter.")
        expected = (RadiationContext if self.parameter in RADIATION_CHANNELS
                    else ProtocolContext if self.parameter in PROTOCOL_PARAMETERS
                    else (ReadingContext, type(None)) if self.parameter in READING_PARAMETERS
                    else type(None))
        if not isinstance(self.context, expected):
            raise ValueError("Channel context must match the measurement protocol.")
        # Validate required context fields using the same contract as the accepted observations.
        ObservationInput(id=uuid4(), crew_code=self.crew_code, location=self.location, phase=self.phase,
                         parameter=self.parameter, value=self.minimum, device=self.hardware, calibration=self.calibration,
                         recorded_at=datetime.now(UTC), context=self.context)
        return self


class DeviceSample(ApiModel):
    sequence: Sequence
    recorded_at: Timestamp
    mission_elapsed_ms: Sequence
    clock_error_ms: MillisecondError
    firmware: Name
    quality: Literal["ok", "saturated", "detached", "artefact"]
    value: BoundedValue | None = None
    uncertainty: Annotated[Reading, Field(ge=0, le=1e12)] | None = None
    activity: Activity = "unknown"

    @model_validator(mode="after")
    def check_value(self) -> Self:
        if self.quality == "ok" and self.value is None:
            raise ValueError("A usable sample requires a value.")
        if self.quality == "detached" and (self.value is not None or self.uncertainty is not None):
            raise ValueError("A detached sample has no measurement.")
        return self


class Receipt(ApiModel):
    sequence: Sequence
    status: Literal["accepted", "saturated", "detached", "artefact", "out_of_range"]
    observation_id: UUID | None


class QualityQuery(ApiModel):
    location: Code
    scope: Scope
    crew_code: Code | None = None
    since: Timestamp | None = None

    @model_validator(mode="after")
    def check_scope(self) -> Self:
        if (self.scope == "crew") != (self.crew_code is not None):
            raise ValueError("Provide a crew code only for crew channels.")
        return self


class ChannelQuality(ApiModel):
    channel: Code
    parameter: Code
    unit: str
    firmware: Name
    calibration: Name
    sample_interval_ms: int | None
    last_sample_at: Timestamp | None
    last_received_at: Timestamp | None
    missing_sequences: int
    counts: dict[str, int]


@router.get("/missions/{mission_code}/devices")
def list_channels(mission_code: Code, query: Annotated[QualityQuery, Query()],
                  access: ObservationAccess, session: DbSession) -> list[ChannelQuality]:
    authorize(access, mission_code, query.scope)
    authorize_crew(access, mission_code, query.crew_code)
    channels = session.scalars(select(DeviceChannel).where(
        DeviceChannel.mission_code == mission_code, DeviceChannel.crew_code == query.crew_code,
        DeviceChannel.configuration["location"].astext == query.location,
    ).order_by(DeviceChannel.code)).all()
    if not channels:
        return []
    statement = (select(DeviceReceipt.channel_code, DeviceReceipt.status, func.count(),
                        func.min(DeviceReceipt.sequence), func.max(DeviceReceipt.sequence),
                        func.max(DeviceReceipt.recorded_at), func.max(DeviceReceipt.received_at))
                 .where(DeviceReceipt.mission_code == mission_code,
                        DeviceReceipt.channel_code.in_([item.code for item in channels]))
                 .group_by(DeviceReceipt.channel_code, DeviceReceipt.status))
    if query.since is not None:
        statement = statement.where(DeviceReceipt.recorded_at >= query.since)
    groups = {}
    for row in session.execute(statement):
        groups.setdefault(row[0], []).append(row[1:])
    result = []
    for channel in channels:
        info = channel.configuration
        rows = groups.get(channel.code, [])
        counts = {status: count for status, count, *_ in rows}
        missing = max(row[3] for row in rows) - min(row[2] for row in rows) + 1 - sum(counts.values()) if rows else 0
        result.append(ChannelQuality(
            channel=channel.code, parameter=info["parameter"], unit=info["unit"], firmware=info["firmware"],
            calibration=info["calibration"], sample_interval_ms=info["sample_interval_ms"],
            last_sample_at=max(row[4] for row in rows) if rows else None,
            last_received_at=max(row[5] for row in rows) if rows else None, missing_sequences=missing, counts=counts,
        ))
    session.add(ObservationAudit(actor=access.actor, action="device_quality", mission_code=mission_code,
                                 scope=query.scope, crew_code=query.crew_code))
    session.commit()
    return result


def verify_channel(channel: DeviceChannel | None, digest: str) -> None:
    if channel is None or channel.sha256 is None or not compare_digest(channel.sha256, digest):
        raise HTTPException(401, "A valid device key is required.", headers={"WWW-Authenticate": "Bearer"})


def check_cadence(session: DbSession, channel: DeviceChannel, settings: ChannelSettings, sample: DeviceSample) -> None:
    stream = select(DeviceReceipt).where(DeviceReceipt.mission_code == channel.mission_code,
                                        DeviceReceipt.channel_code == channel.code)
    lower = session.scalar(stream.where(DeviceReceipt.sequence < sample.sequence)
                           .order_by(DeviceReceipt.sequence.desc()).limit(1))
    upper = session.scalar(stream.where(DeviceReceipt.sequence > sample.sequence)
                           .order_by(DeviceReceipt.sequence).limit(1))
    for neighbor in (lower, upper):
        if neighbor is None:
            continue
        sequence_gap = sample.sequence - neighbor.sequence
        measured_ms = (sample.recorded_at - neighbor.recorded_at).total_seconds() * 1000
        if measured_ms * sequence_gap <= 0:
            raise HTTPException(422, "Device sequence and timestamps are out of order.")
        if (settings.sample_interval_ms is not None
                and abs(measured_ms - sequence_gap * settings.sample_interval_ms) > 2 * settings.clock_tolerance_ms + 0.001):
            raise HTTPException(422, "Sequence and timestamp do not match the registered channel cadence.")


@router.post("/missions/{mission_code}/devices/{channel_code}/samples", status_code=201,
             responses={200: {"model": Receipt}})
def ingest(
    mission_code: Code, channel_code: Code, sample: DeviceSample, session: DbSession, response: Response,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Receipt:
    if credentials is None or not 32 <= len(credentials.credentials) <= 256:
        raise HTTPException(401, "A valid device key is required.", headers={"WWW-Authenticate": "Bearer"})
    digest = sha256(credentials.credentials.encode()).hexdigest()
    identity = (mission_code, channel_code)
    channel = session.get(DeviceChannel, identity)
    verify_channel(channel, digest)
    mission = session.get(MissionClock, mission_code)
    # Serialize sequence checks and recheck the key after concurrent rotation.
    channel = session.get(DeviceChannel, identity, with_for_update=True, populate_existing=True)
    verify_channel(channel, digest)
    settings = ChannelSettings.model_validate(channel.configuration | {"crew_code": channel.crew_code})
    elapsed_ms = (sample.recorded_at - mission.epoch).total_seconds() * 1000
    future_ms = (sample.recorded_at - datetime.now(UTC)).total_seconds() * 1000
    if (elapsed_ms < 0 or future_ms > sample.clock_error_ms
            or sample.clock_error_ms > settings.clock_tolerance_ms
            or abs(elapsed_ms - sample.mission_elapsed_ms) > sample.clock_error_ms + 0.001):
        raise HTTPException(422, "Timestamp does not match the mission clock or exceeds the declared clock error.")
    if sample.firmware != settings.firmware:
        raise HTTPException(422, "Firmware does not match the registered channel.")

    fingerprint = sha256(sample.model_dump_json().encode()).hexdigest()
    existing = session.get(DeviceReceipt, (*identity, sample.sequence))
    if existing is not None:
        if existing.fingerprint != fingerprint:
            raise HTTPException(409, "This channel sequence already refers to a different sample.")
        response.status_code = 200
        return Receipt.model_validate(existing)

    check_cadence(session, channel, settings, sample)
    status = sample.quality
    observation_id = None
    if status == "ok":
        status = "accepted" if settings.minimum <= sample.value <= settings.maximum else "out_of_range"
    if status == "accepted":
        observation = ObservationInput(
            id=uuid4(), crew_code=channel.crew_code, location=settings.location, phase=settings.phase,
            parameter=settings.parameter, value=sample.value, activity=sample.activity, quality="verified",
            device=channel.code, calibration=settings.calibration, uncertainty=sample.uncertainty,
            recorded_at=sample.recorded_at, context=settings.context,
        )
        observation_id = observation.id
        scope = PARAMETERS[settings.parameter].scope
        session.add(MissionObservation(**observation.database_values(), mission_code=mission_code,
                                       scope=scope, unit=settings.unit, method="instrument_stream",
                                       provenance="DEVICE_REPORTED"))
        session.flush()
        session.add(ObservationAudit(actor=channel.code, action="device_write", mission_code=mission_code,
                                     scope=scope, crew_code=channel.crew_code, observation_id=observation_id))
    receipt = DeviceReceipt(mission_code=mission_code, channel_code=channel_code, sequence=sample.sequence,
                            recorded_at=sample.recorded_at,
                            fingerprint=fingerprint, status=status, observation_id=observation_id)
    session.add(receipt)
    answer = Receipt.model_validate(receipt)
    session.commit()
    return answer
