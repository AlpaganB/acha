import json
from pathlib import Path
from uuid import UUID

from sqlalchemy import case
from sqlalchemy.dialects.postgresql import insert

from .database import make_engine
from .models import (
    Assessment,
    CrewMember,
    Measurement,
    MissionProfile,
    assessment_measurements,
)
from .schemas import (
    AssessmentCreate,
    AssessmentResult,
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

            for item in data["measurements"]:
                crew_id = UUID(item["crew_member_id"])
                row = MeasurementCreate.model_validate(
                    {key: val for key, val in item.items() if key != "crew_member_id"}
                )
                statement = insert(Measurement).values(crew_member_id=crew_id, **row.model_dump())
                connection.execute(statement.on_conflict_do_nothing(index_elements=[Measurement.id]))

            for item in data["assessments"]:
                crew_id = UUID(item["crew_member_id"])
                row = AssessmentCreate.model_validate(
                    {key: val for key, val in item.items() if key not in {"crew_member_id", "result"}}
                )
                result = (
                    AssessmentResult.model_validate(item["result"]).model_dump() if "result" in item else {}
                )
                statement = insert(Assessment).values(
                    crew_member_id=crew_id, **row.model_dump(exclude={"measurement_ids"}), **result
                )
                inserted_id = connection.scalar(
                    statement.on_conflict_do_nothing(index_elements=[Assessment.id]).returning(Assessment.id)
                )
                if inserted_id is not None and row.measurement_ids:
                    connection.execute(
                        insert(assessment_measurements),
                        [
                            {"assessment_id": inserted_id, "measurement_id": item}
                            for item in row.measurement_ids
                        ],
                    )
    finally:
        engine.dispose()


if __name__ == "__main__":
    if public_workspace_enabled():
        seed_demo_data()
        print("Demo data is available.")
