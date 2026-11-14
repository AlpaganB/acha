"""create health record tables"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mission_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("environment", sa.String(length=32), nullable=False),
        sa.Column("equipment", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("constraints", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("measurement_schedules", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("guidance_protocol_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "environment IN ('spacecraft', 'orbital_station', 'lunar_habitat', 'deep_space')",
            name="ck_mission_profiles_environment",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "crew_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("mission_profile_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["mission_profile_id"],
            ["mission_profiles.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_crew_members_mission_profile_id"), "crew_members", ["mission_profile_id"], unique=False
    )
    op.create_table(
        "assessments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("crew_member_id", sa.Uuid(), nullable=False),
        sa.Column("mission_profile_id", sa.Uuid(), nullable=False),
        sa.Column("assessed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("symptoms", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("next_step", sa.Text(), nullable=True),
        sa.Column("protocol_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(status = 'pending' AND rationale IS NULL AND next_step IS NULL AND protocol_id IS NULL) OR (status <> 'pending' AND rationale IS NOT NULL AND next_step IS NOT NULL)",
            name="ck_assessments_result_state",
        ),
        sa.ForeignKeyConstraint(
            ["crew_member_id"],
            ["crew_members.id"],
        ),
        sa.ForeignKeyConstraint(
            ["mission_profile_id"],
            ["mission_profiles.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assessments_crew_history", "assessments", ["crew_member_id", "assessed_at", "id"], unique=False
    )
    op.create_index(
        op.f("ix_assessments_mission_profile_id"), "assessments", ["mission_profile_id"], unique=False
    )
    op.create_table(
        "measurements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("crew_member_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("diastolic", sa.Float(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(kind = 'blood_pressure' AND diastolic IS NOT NULL AND diastolic > 0 AND value >= diastolic) OR (diastolic IS NULL AND ((kind = 'heart_rate' AND value > 0) OR (kind = 'spo2' AND value BETWEEN 0 AND 100) OR (kind = 'body_temperature' AND value >= -273.15)))",
            name="ck_measurements_values_by_kind",
        ),
        sa.CheckConstraint(
            "value > '-Infinity'::float8 AND value < 'Infinity'::float8", name="ck_measurements_finite_value"
        ),
        sa.ForeignKeyConstraint(
            ["crew_member_id"],
            ["crew_members.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_measurements_crew_history", "measurements", ["crew_member_id", "recorded_at", "id"], unique=False
    )
    op.create_index(
        "ix_measurements_crew_kind_history",
        "measurements",
        ["crew_member_id", "kind", "recorded_at", "id"],
        unique=False,
    )
    op.create_table(
        "assessment_measurements",
        sa.Column("assessment_id", sa.Uuid(), nullable=False),
        sa.Column("measurement_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["assessment_id"],
            ["assessments.id"],
        ),
        sa.ForeignKeyConstraint(
            ["measurement_id"],
            ["measurements.id"],
        ),
        sa.PrimaryKeyConstraint("assessment_id", "measurement_id"),
    )
    op.create_index(
        "ix_assessment_measurements_measurement_id",
        "assessment_measurements",
        ["measurement_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("assessment_measurements")
    op.drop_table("measurements")
    op.drop_table("assessments")
    op.drop_table("crew_members")
    op.drop_table("mission_profiles")
