import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid5

from sqlalchemy import case
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .database import make_engine
from .models import (
    AssessmentFollowUp,
    CrewMember,
    Measurement,
    MissionProfile,
)
from .records import save_assessment
from .schemas import (
    AssessmentCreate,
    CrewMemberCreate,
    MeasurementCreate,
    MissionProfileCreate,
)
from .workspace import public_workspace_enabled


def seed_demo_data(value: str | None = None) -> None:
    source = Path(__file__).resolve().parents[1] / "demo_data.json"
    data = json.loads(source.read_text(encoding="utf-8"))
    engine = make_engine(value)
    try:
        with engine.begin() as connection:
            for item in data["mission_profiles"]:
                row = MissionProfileCreate.model_validate(
                    {key: val for key, val in item.items() if key != "id"}
                )
                statement = insert(MissionProfile).values(id=UUID(item["id"]), **row.model_dump(mode="json"))
                legacy_name = MissionProfile.name.in_(("Orbital Station Demo", "Lunar Habitat Demo"))
                missing_guides = MissionProfile.guidance_protocol_ids == []
                connection.execute(statement.on_conflict_do_update(
                    index_elements=[MissionProfile.id],
                    set_={
                        "name": case((legacy_name, statement.excluded.name), else_=MissionProfile.name),
                        "guidance_protocol_ids": case(
                            (missing_guides, statement.excluded.guidance_protocol_ids),
                            else_=MissionProfile.guidance_protocol_ids,
                        ),
                    },
                    where=legacy_name | missing_guides,
                ))

            for item in data["crew_members"]:
                row = CrewMemberCreate.model_validate({key: val for key, val in item.items() if key != "id"})
                statement = insert(CrewMember).values(id=UUID(item["id"]), **row.model_dump())
                connection.execute(statement.on_conflict_do_nothing(index_elements=[CrewMember.id]))

            with Session(bind=connection) as session:
                for item in data["crew_members"]:
                    seed_crew_history(session, data, item)
    finally:
        engine.dispose()


def seed_crew_history(session: Session, data: dict, member: dict) -> None:
    crew_id = UUID(member["id"])
    history = data["crew_history"][member["id"]]
    start = datetime.fromisoformat(f'{data["history_start"]}T{history["utc_time"]}').replace(tzinfo=UTC)
    readings_by_day: list[dict[str, MeasurementCreate]] = []
    measurements = []
    for day, values in enumerate(history["readings"]):
        daily = {}
        for minute, (kind, value) in enumerate(zip(data["indicators"], values, strict=True)):
            recorded_at = start + timedelta(days=day, minutes=minute)
            value, diastolic = value if kind == "blood_pressure" else (value, None)
            reading = MeasurementCreate(
                id=uuid5(crew_id, f"demo:{recorded_at.date()}:{kind}"),
                kind=kind,
                value=value,
                diastolic=diastolic,
                recorded_at=recorded_at,
            )
            daily[kind] = reading
            measurements.append({"crew_member_id": crew_id, **reading.model_dump()})
        readings_by_day.append(daily)

    session.execute(insert(Measurement).values(measurements).on_conflict_do_nothing(index_elements=[Measurement.id]))

    check_in = readings_by_day[-2]
    profile_id = UUID(member["mission_profile_id"])
    profile = session.get_one(MissionProfile, profile_id)
    assessment = AssessmentCreate(
        id=uuid5(crew_id, "demo:2026-11:morning-check-in"),
        mission_profile_id=profile_id,
        assessed_at=max(reading.recorded_at for reading in check_in.values()) + timedelta(minutes=5),
        measurement_ids=[reading.id for reading in check_in.values()],
        notes=history["note"],
    )
    _, created = save_assessment(session, crew_id, assessment, profile, evaluate=True)
    if created:
        repeat = readings_by_day[-1]["heart_rate"]
        session.execute(insert(AssessmentFollowUp).values(
            id=uuid5(assessment.id, "demo:repeat-heart-rate"),
            assessment_id=assessment.id,
            measurement_id=repeat.id,
            outcome="workflow_complete",
            recorded_at=repeat.recorded_at + timedelta(minutes=10),
        ))
        session.commit()


if __name__ == "__main__":
    if public_workspace_enabled():
        seed_demo_data()
        print("Demo data is available.")
