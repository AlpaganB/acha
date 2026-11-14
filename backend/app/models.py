from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class MissionProfile(Base):
    __tablename__ = "mission_profiles"
    __table_args__ = (
        sa.CheckConstraint(
            "environment IN ('spacecraft', 'orbital_station', 'lunar_habitat', 'deep_space')",
            name="ck_mission_profiles_environment",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(sa.String(120))
    environment: Mapped[str] = mapped_column(sa.String(32))
    equipment: Mapped[list[str]] = mapped_column(JSONB)
    constraints: Mapped[list[str]] = mapped_column(JSONB)
    measurement_schedules: Mapped[list[dict]] = mapped_column(JSONB)
    guidance_protocol_ids: Mapped[list[str]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())


class CrewMember(Base):
    __tablename__ = "crew_members"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    display_name: Mapped[str] = mapped_column(sa.String(120))
    mission_profile_id: Mapped[UUID] = mapped_column(sa.ForeignKey("mission_profiles.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        sa.CheckConstraint(
            "value > '-Infinity'::float8 AND value < 'Infinity'::float8",
            name="ck_measurements_finite_value",
        ),
        sa.CheckConstraint(
            "(kind = 'blood_pressure' AND diastolic IS NOT NULL AND diastolic > 0 AND value >= diastolic)"
            " OR (diastolic IS NULL AND ("
            "(kind = 'heart_rate' AND value > 0)"
            " OR (kind = 'spo2' AND value BETWEEN 0 AND 100)"
            " OR (kind = 'body_temperature' AND value >= -273.15)))",
            name="ck_measurements_values_by_kind",
        ),
        sa.Index("ix_measurements_crew_history", "crew_member_id", "recorded_at", "id"),
        sa.Index("ix_measurements_crew_kind_history", "crew_member_id", "kind", "recorded_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    crew_member_id: Mapped[UUID] = mapped_column(sa.ForeignKey("crew_members.id"))
    kind: Mapped[str] = mapped_column(sa.String(24))
    value: Mapped[float] = mapped_column(sa.Float)
    diastolic: Mapped[float | None] = mapped_column(sa.Float)
    recorded_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())


assessment_measurements = sa.Table(
    "assessment_measurements",
    Base.metadata,
    sa.Column("assessment_id", sa.Uuid, sa.ForeignKey("assessments.id"), primary_key=True),
    sa.Column("measurement_id", sa.Uuid, sa.ForeignKey("measurements.id"), primary_key=True),
    sa.Index("ix_assessment_measurements_measurement_id", "measurement_id"),
)


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        sa.CheckConstraint(
            "(status = 'pending' AND rationale IS NULL AND next_step IS NULL AND protocol_id IS NULL)"
            " OR (status <> 'pending' AND rationale IS NOT NULL AND next_step IS NOT NULL)",
            name="ck_assessments_result_state",
        ),
        sa.Index("ix_assessments_crew_history", "crew_member_id", "assessed_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    crew_member_id: Mapped[UUID] = mapped_column(sa.ForeignKey("crew_members.id"))
    mission_profile_id: Mapped[UUID] = mapped_column(sa.ForeignKey("mission_profiles.id"), index=True)
    assessed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    symptoms: Mapped[list[dict]] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(sa.Text)
    status: Mapped[str] = mapped_column(sa.String(32), server_default="pending")
    rationale: Mapped[str | None] = mapped_column(sa.Text)
    next_step: Mapped[str | None] = mapped_column(sa.Text)
    protocol_id: Mapped[str | None] = mapped_column(sa.String(64))
    engine_snapshot: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())
    measurements: Mapped[list[Measurement]] = relationship(
        secondary=assessment_measurements, lazy="selectin", order_by=Measurement.id
    )

    @property
    def measurement_ids(self) -> list[UUID]:
        return [measurement.id for measurement in self.measurements]

    @property
    def engine_result(self) -> dict | None:
        return self.engine_snapshot["result"] if self.engine_snapshot else None
