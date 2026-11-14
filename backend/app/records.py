from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Select, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import InstrumentedAttribute, Session

from .models import Assessment, Base, Measurement, assessment_measurements
from .schemas import (
    MEASUREMENT_UNITS,
    AssessmentCreate,
    AssessmentRead,
    HistoryQuery,
    MeasurementCreate,
    MeasurementRead,
)


def require_record[Record: Base](
    session: Session, model: type[Record], record_id: UUID, label: str
) -> Record:
    record = session.get(model, record_id)
    if record is None:
        raise HTTPException(404, f"{label} not found.")
    return record


def history_page[Record: Base](
    statement: Select[tuple[Record]],
    time_column: InstrumentedAttribute[datetime],
    id_column: InstrumentedAttribute[UUID],
    query: HistoryQuery,
) -> Select[tuple[Record]]:
    if query.since is not None:
        statement = statement.where(time_column >= query.since)
    if query.until is not None:
        statement = statement.where(time_column < query.until)
    return statement.order_by(time_column.desc(), id_column.desc()).offset(query.offset).limit(query.limit)


def measurement_read(record: Measurement) -> MeasurementRead:
    return MeasurementRead(
        **MeasurementCreate.model_validate(record).model_dump(),
        crew_member_id=record.crew_member_id,
        created_at=record.created_at,
        unit=MEASUREMENT_UNITS[record.kind],
    )


def save_measurement(session: Session, crew_id: UUID, payload: MeasurementCreate) -> tuple[Measurement, bool]:
    statement = (
        insert(Measurement)
        .values(crew_member_id=crew_id, **payload.model_dump())
        .on_conflict_do_nothing(index_elements=[Measurement.id])
        .returning(Measurement)
    )
    inserted = session.scalar(statement)
    if inserted is not None:
        session.commit()
        return inserted, True

    existing = require_record(session, Measurement, payload.id, "Measurement")
    if existing.crew_member_id != crew_id or MeasurementCreate.model_validate(existing) != payload:
        raise HTTPException(409, "Measurement ID is already in use for different data.")
    return existing, False


def save_assessment(
    session: Session, crew_id: UUID, payload: AssessmentCreate
) -> tuple[AssessmentRead, bool]:
    statement = (
        insert(Assessment)
        .values(crew_member_id=crew_id, **payload.model_dump(exclude={"measurement_ids"}))
        .on_conflict_do_nothing(index_elements=[Assessment.id])
        .returning(Assessment.id)
    )
    inserted_id = session.scalar(statement)
    if inserted_id is not None:
        if payload.measurement_ids:
            matching_ids = session.scalars(
                select(Measurement.id).where(
                    Measurement.crew_member_id == crew_id,
                    Measurement.id.in_(payload.measurement_ids),
                )
            ).all()
            if len(matching_ids) != len(payload.measurement_ids):
                raise HTTPException(422, "All measurement IDs must refer to records for this crew member.")
            session.execute(
                insert(assessment_measurements),
                [{"assessment_id": inserted_id, "measurement_id": item} for item in payload.measurement_ids],
            )
        record = require_record(session, Assessment, inserted_id, "Assessment")
        response = AssessmentRead.model_validate(record)
        session.commit()
        return response, True

    existing = require_record(session, Assessment, payload.id, "Assessment")
    if existing.crew_member_id != crew_id or AssessmentCreate.model_validate(existing) != payload:
        raise HTTPException(409, "Assessment ID is already in use for different data.")
    return AssessmentRead.model_validate(existing), False
