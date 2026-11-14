from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select, text

from .database import DbSession
from .models import Assessment, CrewMember, Measurement, MissionProfile
from .records import (
    history_page,
    measurement_read,
    require_record,
    save_assessment,
    save_measurement,
)
from .schemas import (
    AssessmentCreate,
    AssessmentRead,
    AssessmentResult,
    CrewMemberCreate,
    CrewMemberRead,
    CrewMissionUpdate,
    HistoryQuery,
    MeasurementCreate,
    MeasurementHistoryQuery,
    MeasurementRead,
    MissionProfileCreate,
    MissionProfileRead,
)

router = APIRouter(prefix="/api/v1")
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/health", tags=["Health"])
def health(session: DbSession) -> dict[str, str]:
    session.execute(text("SELECT 1"))
    return {"status": "ok"}


@router.post("/mission-profiles", tags=["Mission profiles"], status_code=201)
def create_mission_profile(payload: MissionProfileCreate, session: DbSession) -> MissionProfileRead:
    record = MissionProfile(**payload.model_dump(mode="json"))
    session.add(record)
    session.commit()
    return MissionProfileRead.model_validate(record)


@router.get("/mission-profiles", tags=["Mission profiles"])
def list_mission_profiles(
    session: DbSession, limit: Limit = 50, offset: Offset = 0
) -> list[MissionProfileRead]:
    statement = (
        select(MissionProfile).order_by(MissionProfile.name, MissionProfile.id).offset(offset).limit(limit)
    )
    return [MissionProfileRead.model_validate(record) for record in session.scalars(statement)]


@router.get("/mission-profiles/{profile_id}", tags=["Mission profiles"])
def get_mission_profile(profile_id: UUID, session: DbSession) -> MissionProfileRead:
    return MissionProfileRead.model_validate(
        require_record(session, MissionProfile, profile_id, "Mission profile")
    )


@router.post("/crew-members", tags=["Crew"], status_code=201)
def create_crew_member(payload: CrewMemberCreate, session: DbSession) -> CrewMemberRead:
    require_record(session, MissionProfile, payload.mission_profile_id, "Mission profile")
    record = CrewMember(**payload.model_dump())
    session.add(record)
    session.commit()
    return CrewMemberRead.model_validate(record)


@router.get("/crew-members", tags=["Crew"])
def list_crew_members(session: DbSession, limit: Limit = 50, offset: Offset = 0) -> list[CrewMemberRead]:
    statement = (
        select(CrewMember).order_by(CrewMember.display_name, CrewMember.id).offset(offset).limit(limit)
    )
    return [CrewMemberRead.model_validate(record) for record in session.scalars(statement)]


@router.get("/crew-members/{crew_id}", tags=["Crew"])
def get_crew_member(crew_id: UUID, session: DbSession) -> CrewMemberRead:
    return CrewMemberRead.model_validate(require_record(session, CrewMember, crew_id, "Crew member"))


@router.patch("/crew-members/{crew_id}/mission-profile", tags=["Crew"])
def assign_mission_profile(crew_id: UUID, payload: CrewMissionUpdate, session: DbSession) -> CrewMemberRead:
    record = require_record(session, CrewMember, crew_id, "Crew member")
    require_record(session, MissionProfile, payload.mission_profile_id, "Mission profile")
    record.mission_profile_id = payload.mission_profile_id
    session.commit()
    return CrewMemberRead.model_validate(record)


@router.post(
    "/crew-members/{crew_id}/measurements",
    tags=["Measurements"],
    status_code=201,
    responses={
        200: {"model": MeasurementRead, "description": "Existing identical measurement"},
        409: {"description": "ID conflict"},
    },
)
def create_measurement(
    crew_id: UUID, payload: MeasurementCreate, session: DbSession, response: Response
) -> MeasurementRead:
    require_record(session, CrewMember, crew_id, "Crew member")
    record, created = save_measurement(session, crew_id, payload)
    if not created:
        response.status_code = 200
    return measurement_read(record)


@router.get("/crew-members/{crew_id}/measurements", tags=["Measurements"])
def list_measurements(
    crew_id: UUID, query: Annotated[MeasurementHistoryQuery, Query()], session: DbSession
) -> list[MeasurementRead]:
    require_record(session, CrewMember, crew_id, "Crew member")
    statement = select(Measurement).where(Measurement.crew_member_id == crew_id)
    if query.kind is not None:
        statement = statement.where(Measurement.kind == query.kind)
    page = history_page(statement, Measurement.recorded_at, Measurement.id, query)
    return [measurement_read(record) for record in session.scalars(page)]


@router.get("/crew-members/{crew_id}/measurements/{measurement_id}", tags=["Measurements"])
def get_measurement(crew_id: UUID, measurement_id: UUID, session: DbSession) -> MeasurementRead:
    record = session.scalar(
        select(Measurement).where(Measurement.id == measurement_id, Measurement.crew_member_id == crew_id)
    )
    if record is None:
        raise HTTPException(404, "Measurement not found.")
    return measurement_read(record)


@router.post(
    "/crew-members/{crew_id}/assessments",
    tags=["Assessments"],
    status_code=201,
    responses={
        200: {"model": AssessmentRead, "description": "Existing identical assessment"},
        409: {"description": "ID conflict"},
    },
)
def create_assessment(
    crew_id: UUID, payload: AssessmentCreate, session: DbSession, response: Response
) -> AssessmentRead:
    require_record(session, CrewMember, crew_id, "Crew member")
    require_record(session, MissionProfile, payload.mission_profile_id, "Mission profile")
    record, created = save_assessment(session, crew_id, payload)
    if not created:
        response.status_code = 200
    return record


@router.get("/crew-members/{crew_id}/assessments", tags=["Assessments"])
def list_assessments(
    crew_id: UUID, query: Annotated[HistoryQuery, Query()], session: DbSession
) -> list[AssessmentRead]:
    require_record(session, CrewMember, crew_id, "Crew member")
    statement = select(Assessment).where(Assessment.crew_member_id == crew_id)
    page = history_page(statement, Assessment.assessed_at, Assessment.id, query)
    return [AssessmentRead.model_validate(record) for record in session.scalars(page)]


@router.get("/crew-members/{crew_id}/assessments/{assessment_id}", tags=["Assessments"])
def get_assessment(crew_id: UUID, assessment_id: UUID, session: DbSession) -> AssessmentRead:
    record = session.scalar(
        select(Assessment).where(Assessment.id == assessment_id, Assessment.crew_member_id == crew_id)
    )
    if record is None:
        raise HTTPException(404, "Assessment not found.")
    return AssessmentRead.model_validate(record)


@router.put(
    "/crew-members/{crew_id}/assessments/{assessment_id}/result",
    tags=["Assessments"],
    summary="Store a result from the assessment engine",
    responses={409: {"description": "A different result is already stored"}},
)
def store_assessment_result(
    crew_id: UUID, assessment_id: UUID, payload: AssessmentResult, session: DbSession
) -> AssessmentRead:
    statement = select(Assessment).where(Assessment.id == assessment_id, Assessment.crew_member_id == crew_id)
    record = session.scalar(statement.with_for_update())
    if record is None:
        raise HTTPException(404, "Assessment not found.")
    if record.status != "pending":
        if AssessmentResult.model_validate(record) != payload:
            raise HTTPException(409, "A different assessment result is already stored.")
        return AssessmentRead.model_validate(record)

    record.status = payload.status
    record.rationale = payload.rationale
    record.next_step = payload.next_step
    record.protocol_id = payload.protocol_id
    session.commit()
    return AssessmentRead.model_validate(record)
