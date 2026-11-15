from dataclasses import asdict
from datetime import timedelta
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .database import DbSession
from .models import MissionObservation, ObservationAudit
from .observation_access import Access, ObservationAccess
from .observation_context import (
    CONTEXTS, LAB_PARAMETERS, PERFORMANCE_PARAMETERS, PERSONAL_TOTALS, PROTOCOL_PARAMETERS, RADIATION_CHANNELS,
    ORGAN_GRAY_EQ_TISSUES, RADIATION_ASSESSMENTS, RADIATION_ESTIMATES, READING_PARAMETERS, SITE_PARAMETERS,
    REQUIRED_PERFORMANCE_PARAMETERS, REQUIRED_PROTOCOL_PARAMETERS,
    DoseEstimateContext, ExerciseInterval, GravityInterval, ObservationContext, PerformanceContext, ProtocolContext,
    RadiationAssessment, RadiationContext, ReadingContext, SleepEpisode,
)
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
    context: ObservationContext | None = None

    @model_validator(mode="after")
    def match_parameter(self) -> Self:
        parameter = PARAMETERS.get(self.parameter)
        if parameter is None:
            raise ValueError("Select a registered parameter.")
        if (parameter.scope == "crew") != (self.crew_code is not None):
            raise ValueError("A crew code is required for crew observations and omitted for environment observations.")
        self.check_context()
        if parameter.input_kind == "event":
            if self.event_text is None or self.value is not None or self.uncertainty is not None:
                raise ValueError("Event records require a description and do not use numeric values or uncertainty.")
            return self
        if self.value is None or self.event_text is not None:
            raise ValueError("This parameter requires a numeric value.")
        if ((parameter.minimum is not None and self.value < parameter.minimum)
                or (parameter.maximum is not None and self.value > parameter.maximum)):
            raise ValueError(f"Value is outside the supported input domain for {parameter.label}.")
        if self.parameter == "sustained_attention_lapses" and isinstance(self.context, PerformanceContext):
            if not self.value.is_integer() or self.value > self.context.valid_trials:
                raise ValueError("Lapses must be a whole number no greater than valid trials.")
        if self.quality == "verified" and parameter.method not in {"self_report", "manual_count"} and not self.device:
            if not isinstance(self.context, (PerformanceContext, ProtocolContext, DoseEstimateContext, GravityInterval,
                                             RadiationAssessment)) and (
                not isinstance(self.context, SleepEpisode) or self.context.method != "self_report"
            ):
                raise ValueError("A device or protocol identifier is required for a verified reading.")
        return self

    def check_context(self) -> None:
        context = self.context
        if self.parameter == "sleep_episode_minutes":
            if not isinstance(context, SleepEpisode) or self.recorded_at < context.out_of_bed_at:
                raise ValueError("A sleep episode requires ordered timestamps through the observation time.")
            if context.method != "self_report" and (self.device is None or self.uncertainty is None):
                raise ValueError("Instrument sleep episodes require a device and uncertainty in minutes.")
            if self.value is not None and self.value != context.sleep_minutes:
                raise ValueError("Sleep duration must match the episode timestamps.")
            self.value = context.sleep_minutes
        elif self.parameter in RADIATION_ASSESSMENTS:
            if not isinstance(context, RadiationAssessment) or context.basis != RADIATION_ASSESSMENTS[self.parameter]:
                raise ValueError("The reviewed radiation assessment basis must match the selected quantity.")
            if self.value is None or not context.lower <= self.value <= context.upper:
                raise ValueError("The reported result must be inside its documented uncertainty interval.")
            if self.uncertainty is not None:
                raise ValueError("Use the reported assessment bounds for radiation models.")
            if self.parameter == "organ_gray_equivalent_30d":
                if context.tissue not in ORGAN_GRAY_EQ_TISSUES:
                    raise ValueError("Select a supported organ for a gray-equivalent assessment.")
            elif self.parameter == "hippocampal_absorbed_30d":
                if context.tissue != "hippocampus":
                    raise ValueError("The central nervous-system assessment requires hippocampal absorbed dose.")
            elif context.tissue is not None:
                raise ValueError("This assessment is not a tissue-specific quantity.")
            if self.parameter in {"organ_gray_equivalent_30d", "hippocampal_absorbed_30d"} and (
                context.exposure_end - context.exposure_start != timedelta(days=30)
                or context.exposure_end > self.recorded_at or context.includes_mission_projection
            ):
                raise ValueError("Use a completed 30-day organ assessment without projected exposure.")
            if self.parameter in {"radiation_reid", "radiation_reic"} and context.upper > 100:
                raise ValueError("Cancer risk results use percent from 0 to 100.")
        elif self.parameter in RADIATION_ESTIMATES:
            if not isinstance(context, DoseEstimateContext) or (
                (self.parameter == "organ_equivalent_dose_estimate") != (context.tissue is not None)
            ):
                raise ValueError("Provide the dose model and tissue for the selected dose estimate.")
        elif self.parameter in RADIATION_CHANNELS:
            if self.parameter in PERSONAL_TOTALS or context is not None:
                if not isinstance(context, RadiationContext) or not self.device or not self.calibration:
                    raise ValueError("Provide radiation source, geometry, shielding, device and calibration.")
        elif self.parameter in PERFORMANCE_PARAMETERS:
            if (context is not None or self.parameter in REQUIRED_PERFORMANCE_PARAMETERS) and not isinstance(context, PerformanceContext):
                raise ValueError("Provide the versioned performance protocol and session conditions.")
        elif self.parameter in READING_PARAMETERS:
            if context is not None and not isinstance(context, ReadingContext):
                raise ValueError("Provide the posture and timing of the measurement.")
        elif self.parameter == "gravity_exposure_minutes" or (self.parameter == "exercise_minutes" and context is not None):
            expected = GravityInterval if self.parameter == "gravity_exposure_minutes" else ExerciseInterval
            if not isinstance(context, expected) or self.recorded_at < context.end:
                raise ValueError("Record the complete interval through the observation time.")
            if self.value is not None and self.value != context.minutes:
                raise ValueError("The duration must match the interval timestamps.")
            self.value = context.minutes
        elif self.parameter in PROTOCOL_PARAMETERS:
            if context is not None or self.parameter in REQUIRED_PROTOCOL_PARAMETERS:
                if not isinstance(context, ProtocolContext):
                    raise ValueError("Provide the versioned measurement protocol.")
                if self.parameter in SITE_PARAMETERS | {"skeletal_strength"} and context.body_site is None:
                    raise ValueError("Provide the measurement body site.")
                if self.parameter in LAB_PARAMETERS and context.specimen is None:
                    raise ValueError("Provide a specimen reference.")
        elif context is not None:
            raise ValueError("Structured context is unavailable for the selected parameter.")

    def database_values(self) -> dict:
        return self.model_dump(exclude={"context"}) | {
            "context": self.context.model_dump(mode="json") if self.context else None,
        }


class Observation(ObservationInput):
    mission_code: Code
    scope: Scope
    unit: str
    provenance: Literal["USER_REPORTED", "MANUAL_OBSERVATION", "CLINICAL_RECORD", "DEVICE_REPORTED"]
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


def authorize_crew(access: Access, mission_code: str, crew_code: str | None) -> None:
    if crew_code is not None and access.crew is not None and crew_code not in access.crew.get(mission_code, ()):
        raise HTTPException(403, "This credential does not grant access to this crew record.")


@router.get("/parameters")
def parameter_registry() -> list[dict]:
    return [{"id": key, **asdict(parameter), "context_kind": CONTEXTS.get(key)} for key, parameter in PARAMETERS.items()]


@router.get("/access")
def observation_access(access: ObservationAccess) -> Access:
    return access


@router.get("/missions/{mission_code}")
def list_observations(
    mission_code: Code, query: Annotated[ObservationQuery, Query()], access: ObservationAccess, session: DbSession,
) -> list[Observation]:
    authorize(access, mission_code, query.scope)
    authorize_crew(access, mission_code, query.crew_code)
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
    authorize_crew(access, mission_code, payload.crew_code)
    method = payload.context.method if isinstance(payload.context, SleepEpisode) else parameter.method
    provenance = {
        "self_report": "USER_REPORTED", "laboratory_transcribed": "CLINICAL_RECORD",
        "clinical_transcribed": "CLINICAL_RECORD",
    }.get(method, "MANUAL_OBSERVATION")
    statement = (insert(MissionObservation).values(
        **payload.database_values(), mission_code=mission_code, scope=parameter.scope,
        unit=parameter.unit, method=method, provenance=provenance,
    ).on_conflict_do_nothing(index_elements=[MissionObservation.id]).returning(MissionObservation))
    record = session.scalar(statement)
    if record is None:
        record = require_record(session, MissionObservation, payload.id, "Observation")
        if record.mission_code != mission_code or record.provenance == "DEVICE_REPORTED" or ObservationInput.model_validate(record) != payload:
            raise HTTPException(409, "Observation ID is already in use for different data.")
        response.status_code = 200
    else:
        session.add(ObservationAudit(actor=access.actor, action="write", mission_code=mission_code,
                                     scope=parameter.scope, crew_code=payload.crew_code, observation_id=payload.id))
        session.commit()
    return Observation.model_validate(record)
