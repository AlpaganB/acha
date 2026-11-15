from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import DbSession
from .models import Assessment, AssessmentFollowUp, Measurement
from .records import measurement_read
from .schemas import ApiModel, MeasurementRead, Timestamp

router = APIRouter(prefix="/crew-members/{crew_id}/assessments/{assessment_id}/follow-ups", tags=["Assessments"])


class FollowUpCreate(ApiModel):
    id: UUID
    measurement_id: UUID
    outcome: Literal["continue_review", "workflow_complete"]


class FollowUpRead(FollowUpCreate):
    recorded_at: Timestamp
    measurement: MeasurementRead


def scoped_assessment(session: Session, crew_id: UUID, assessment_id: UUID, *, lock: bool = False) -> Assessment:
    query = select(Assessment).where(Assessment.id == assessment_id, Assessment.crew_member_id == crew_id)
    assessment = session.scalar(query.with_for_update() if lock else query)
    if assessment is None:
        raise HTTPException(404, "Assessment not found.")
    return assessment


def read_entry(entry: AssessmentFollowUp) -> FollowUpRead:
    return FollowUpRead(**FollowUpCreate.model_validate(entry).model_dump(), recorded_at=entry.recorded_at,
                        measurement=measurement_read(entry.measurement))


@router.get("")
def list_follow_ups(crew_id: UUID, assessment_id: UUID, session: DbSession, response: Response) -> list[FollowUpRead]:
    scoped_assessment(session, crew_id, assessment_id)
    response.headers["Cache-Control"] = "no-store"
    rows = session.scalars(select(AssessmentFollowUp).where(AssessmentFollowUp.assessment_id == assessment_id)
                           .order_by(AssessmentFollowUp.recorded_at, AssessmentFollowUp.id))
    return [read_entry(row) for row in rows]


@router.post("", status_code=201)
def record_follow_up(crew_id: UUID, assessment_id: UUID, payload: FollowUpCreate,
                     session: DbSession, response: Response) -> FollowUpRead:
    # Serialize writers per assessment so concurrent requests cannot append after closure.
    assessment = scoped_assessment(session, crew_id, assessment_id, lock=True)
    response.headers["Cache-Control"] = "no-store"
    existing = session.get(AssessmentFollowUp, (assessment_id, payload.id))
    if existing is not None:
        if FollowUpCreate.model_validate(existing) != payload:
            raise HTTPException(409, "Follow-up ID is already in use for different data.")
        response.status_code = 200
        return read_entry(existing)
    if assessment.status == "pending":
        raise HTTPException(409, "Evaluate the assessment before recording follow-up.")
    entries = select(AssessmentFollowUp.id).where(AssessmentFollowUp.assessment_id == assessment_id)
    if session.scalar(entries.where(AssessmentFollowUp.outcome == "workflow_complete").limit(1)) is not None:
        raise HTTPException(409, "This workflow is already complete.")
    if session.scalar(entries.where(AssessmentFollowUp.measurement_id == payload.measurement_id)) is not None:
        raise HTTPException(409, "This reading is already linked to the assessment.")

    measurement = session.scalar(select(Measurement).where(Measurement.id == payload.measurement_id,
                                                           Measurement.crew_member_id == crew_id))
    if measurement is None or not assessment.assessed_at < measurement.recorded_at <= datetime.now(UTC):
        raise HTTPException(422, "Choose a measurement for this crew member recorded after the assessment.")
    if assessment.measurements and measurement.kind not in {item.kind for item in assessment.measurements}:
        raise HTTPException(422, "Choose a repeat of an indicator included in the assessment.")

    entry = AssessmentFollowUp(assessment_id=assessment_id, **payload.model_dump(), measurement=measurement)
    session.add(entry)
    session.commit()
    return read_entry(entry)
