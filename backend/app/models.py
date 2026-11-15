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
    archived: Mapped[bool] = mapped_column(server_default=sa.false())
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
            " OR (kind = 'respiratory_rate' AND value >= 0)"
            " OR (kind = 'spo2' AND value BETWEEN 0 AND 100)"
            " OR (kind = 'body_temperature' AND value >= -273.15)"
            " OR (kind = 'sleep_duration' AND value BETWEEN 0 AND 24)))",
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


class AssessmentFollowUp(Base):
    __tablename__ = "assessment_follow_ups"
    __table_args__ = (
        sa.CheckConstraint("outcome IN ('continue_review', 'workflow_complete')", name="ck_follow_up_outcome"),
        sa.UniqueConstraint("assessment_id", "measurement_id", name="uq_follow_up_measurement"),
    )

    assessment_id: Mapped[UUID] = mapped_column(sa.ForeignKey("assessments.id"), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    measurement_id: Mapped[UUID] = mapped_column(sa.ForeignKey("measurements.id"))
    outcome: Mapped[str] = mapped_column(sa.String(24))
    recorded_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.clock_timestamp())
    measurement: Mapped[Measurement] = relationship(lazy="joined")


class MissionObservation(Base):
    __tablename__ = "mission_observations"
    __table_args__ = (
        sa.CheckConstraint(
            "(scope = 'environment' AND crew_code IS NULL) OR (scope = 'crew' AND crew_code IS NOT NULL)",
            name="ck_mission_observation_scope",
        ),
        sa.CheckConstraint("value BETWEEN -1e12 AND 1e12", name="ck_mission_observation_value"),
        sa.CheckConstraint("uncertainty BETWEEN 0 AND 1e12", name="ck_mission_observation_uncertainty"),
        sa.CheckConstraint("(value IS NULL) <> (event_text IS NULL)", name="ck_mission_observation_payload"),
        sa.Index("ix_mission_observation_history", "mission_code", "scope", "crew_code", "recorded_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    mission_code: Mapped[str] = mapped_column(sa.String(64))
    crew_code: Mapped[str | None] = mapped_column(sa.String(64))
    scope: Mapped[str] = mapped_column(sa.String(16))
    location: Mapped[str] = mapped_column(sa.String(64))
    phase: Mapped[str] = mapped_column(sa.String(16))
    activity: Mapped[str] = mapped_column(sa.String(16))
    parameter: Mapped[str] = mapped_column(sa.String(64))
    unit: Mapped[str] = mapped_column(sa.String(24))
    value: Mapped[float | None] = mapped_column(sa.Float)
    event_text: Mapped[str | None] = mapped_column(sa.Text)
    quality: Mapped[str] = mapped_column(sa.String(16))
    device: Mapped[str | None] = mapped_column(sa.String(120))
    calibration: Mapped[str | None] = mapped_column(sa.String(120))
    uncertainty: Mapped[float | None] = mapped_column(sa.Float)
    provenance: Mapped[str] = mapped_column(sa.String(24))
    method: Mapped[str] = mapped_column(sa.String(24))
    context: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    recorded_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())


class ObservationAudit(Base):
    __tablename__ = "observation_audit"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    actor: Mapped[str] = mapped_column(sa.String(64))
    action: Mapped[str] = mapped_column(sa.String(16))
    mission_code: Mapped[str] = mapped_column(sa.String(64))
    scope: Mapped[str] = mapped_column(sa.String(16))
    crew_code: Mapped[str | None] = mapped_column(sa.String(64))
    observation_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())


class MissionClock(Base):
    __tablename__ = "mission_clocks"

    code: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    epoch: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))


class DeviceChannel(Base):
    __tablename__ = "mission_device_channels"
    __table_args__ = (sa.UniqueConstraint("sha256", name="uq_device_channel_credential"),)

    mission_code: Mapped[str] = mapped_column(sa.ForeignKey("mission_clocks.code"), primary_key=True)
    code: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    crew_code: Mapped[str | None] = mapped_column(sa.String(64))
    sha256: Mapped[str | None] = mapped_column(sa.String(64))
    configuration: Mapped[dict] = mapped_column(JSONB)


class DeviceReceipt(Base):
    __tablename__ = "mission_device_receipts"
    __table_args__ = (
        sa.ForeignKeyConstraint(["mission_code", "channel_code"],
                                ["mission_device_channels.mission_code", "mission_device_channels.code"]),
        sa.Index("ix_device_receipt_time", "mission_code", "channel_code", "recorded_at"),
    )

    mission_code: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    channel_code: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    sequence: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True)
    recorded_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    fingerprint: Mapped[str] = mapped_column(sa.String(64))
    status: Mapped[str] = mapped_column(sa.String(24))
    received_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())
    observation_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("mission_observations.id", ondelete="CASCADE"))


class HealthReviewPolicy(Base):
    __tablename__ = "health_review_policies"
    __table_args__ = (
        sa.Index("ix_health_review_active", "mission_code", unique=True, postgresql_where=sa.text("retired_at IS NULL")),
    )

    mission_code: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    version: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    configuration: Mapped[dict] = mapped_column(JSONB)
    published_by: Mapped[str] = mapped_column(sa.String(64))
    published_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    retired_by: Mapped[str | None] = mapped_column(sa.String(64))


class HealthReviewAcknowledgment(Base):
    __tablename__ = "health_review_acknowledgments"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["mission_code", "policy_version"], ["health_review_policies.mission_code", "health_review_policies.version"],
        ),
    )

    mission_code: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    crew_code: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    decision_key: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    policy_version: Mapped[str] = mapped_column(sa.String(64))
    action: Mapped[str] = mapped_column(sa.String(32))
    actor: Mapped[str] = mapped_column(sa.String(64))
    recorded_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    snapshot: Mapped[dict] = mapped_column(JSONB)
