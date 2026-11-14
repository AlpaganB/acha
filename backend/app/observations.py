from dataclasses import asdict
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .database import DbSession
from .models import MissionObservation, ObservationAudit
from .observation_access import Access, ObservationAccess
from .observation_registry import PARAMETERS
from .records import history_page, require_record
from .schemas import ApiModel, Code, Description, HistoryQuery, Name, Reading, Timestamp

router = APIRouter(prefix="/api/v1/observations", tags=["Mission observations"])
Scope = Literal["environment", "crew"]
Phase = Literal["preflight", "in_flight", "eva", "postflight"]
Activity = Literal["unknown", "rest", "exercise", "task"]


class ObservationInput(ApiModel):
    id: UUID
    crew_code: Code | None = None
    location: Code
    phase: Phase
    activity: Activity = "unknown"
    parameter: Code
    value: Annotated[Reading, Field(ge=-1e12, le=1e12)] | None = None
    event_text: Description | None = None
    quality: Literal["unverified", "verified", "suspect"] = "unverified"
    device: Name | None = None
    calibration: Name | None = None
    uncertainty: Annotated[Reading, Field(ge=0, le=1e12)] | None = None
    recorded_at: Timestamp

    @model_validator(mode="after")
    def match_parameter(self) -> Self:
        parameter = PARAMETERS.get(self.parameter)
        if parameter is None:
            raise ValueError("Select a registered parameter.")
        if (parameter.scope == "crew") != (self.crew_code is not None):
            raise ValueError("A crew code is required for crew observations and omitted for environment observations.")
        if parameter.input_kind == "event":
            if self.event_text is None or self.value is not None or self.uncertainty is not None:
                raise ValueError("Event records require a description and do not use numeric values or uncertainty.")
            return self
        if self.value is None or self.event_text is not None:
            raise ValueError("This parameter requires a numeric value.")
        if ((parameter.minimum is not None and self.value < parameter.minimum)
                or (parameter.maximum is not None and self.value > parameter.maximum)):
            raise ValueError(f"Value is outside the supported input domain for {parameter.label}.")
        if self.quality == "verified" and parameter.method not in {"self_report", "manual_count"} and not self.device:
            raise ValueError("A device or protocol identifier is required for a verified reading.")
        return self


class Observation(ObservationInput):
    mission_code: Code
    scope: Scope
    unit: str
    provenance: Literal["USER_REPORTED", "MANUAL_OBSERVATION", "CLINICAL_RECORD"]
    method: str
    created_at: Timestamp


class ObservationQuery(HistoryQuery):
    scope: Scope
    crew_code: Code | None = None
    location: Code | None = None
    phase: Phase | None = None
    parameter: Code | None = None

    @model_validator(mode="after")
    def match_scope(self) -> Self:
        if (self.scope == "crew") != (self.crew_code is not None):
            raise ValueError("Provide a crew code only for crew history.")
        return self


def authorize(access: Access, mission: str, scope: Scope, *, write: bool = False) -> None:
    if (mission not in access.missions or (scope == "crew" and access.role != "medical")
            or (scope == "environment" and write and access.role != "operations")):
        raise HTTPException(403, "This credential does not grant access to the requested records.")


@router.get("/parameters")
def parameter_registry() -> list[dict]:
    return [{"id": key, **asdict(parameter)} for key, parameter in PARAMETERS.items()]


@router.get("/access")
def observation_access(access: ObservationAccess) -> Access:
    return access


@router.get("/missions/{mission_code}")
def list_observations(
    mission_code: Code, query: Annotated[ObservationQuery, Query()], access: ObservationAccess, session: DbSession,
) -> list[Observation]:
    authorize(access, mission_code, query.scope)
    statement = select(MissionObservation).where(
        MissionObservation.mission_code == mission_code,
        MissionObservation.scope == query.scope,
        MissionObservation.crew_code == query.crew_code,
    )
    for field in ("location", "phase", "parameter"):
        if (value := getattr(query, field)) is not None:
            statement = statement.where(getattr(MissionObservation, field) == value)
    page = history_page(statement, MissionObservation.recorded_at, MissionObservation.id, query)
    observations = [Observation.model_validate(item) for item in session.scalars(page)]
    session.add(ObservationAudit(actor=access.actor, action="read", mission_code=mission_code,
                                 scope=query.scope, crew_code=query.crew_code))
    session.commit()
    return observations


@router.post("/missions/{mission_code}", status_code=201, responses={200: {"model": Observation}, 409: {"description": "ID conflict"}})
def create_observation(
    mission_code: Code, payload: ObservationInput, access: ObservationAccess, session: DbSession, response: Response,
) -> Observation:
    parameter = PARAMETERS[payload.parameter]
    authorize(access, mission_code, parameter.scope, write=True)
    provenance = {
        "self_report": "USER_REPORTED", "laboratory_transcribed": "CLINICAL_RECORD",
        "clinical_transcribed": "CLINICAL_RECORD",
    }.get(parameter.method, "MANUAL_OBSERVATION")
    statement = (insert(MissionObservation).values(
        **payload.model_dump(), mission_code=mission_code, scope=parameter.scope,
        unit=parameter.unit, method=parameter.method, provenance=provenance,
    ).on_conflict_do_nothing(index_elements=[MissionObservation.id]).returning(MissionObservation))
    record = session.scalar(statement)
    if record is None:
        record = require_record(session, MissionObservation, payload.id, "Observation")
        if record.mission_code != mission_code or ObservationInput.model_validate(record) != payload:
            raise HTTPException(409, "Observation ID is already in use for different data.")
        response.status_code = 200
    else:
        session.add(ObservationAudit(actor=access.actor, action="write", mission_code=mission_code,
                                     scope=parameter.scope, crew_code=payload.crew_code, observation_id=payload.id))
        session.commit()
    return Observation.model_validate(record)
