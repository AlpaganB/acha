"""Add authenticated mission observations and access audit entries."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mission_observations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("mission_code", sa.String(64), nullable=False),
        sa.Column("crew_code", sa.String(64)),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("location", sa.String(64), nullable=False),
        sa.Column("phase", sa.String(16), nullable=False),
        sa.Column("activity", sa.String(16), nullable=False),
        sa.Column("parameter", sa.String(64), nullable=False),
        sa.Column("unit", sa.String(24), nullable=False),
        sa.Column("value", sa.Float()),
        sa.Column("event_text", sa.Text()),
        sa.Column("quality", sa.String(16), nullable=False),
        sa.Column("device", sa.String(120)),
        sa.Column("calibration", sa.String(120)),
        sa.Column("uncertainty", sa.Float()),
        sa.Column("provenance", sa.String(24), nullable=False),
        sa.Column("method", sa.String(24), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "(scope = 'environment' AND crew_code IS NULL) OR (scope = 'crew' AND crew_code IS NOT NULL)",
            name="ck_mission_observation_scope",
        ),
        sa.CheckConstraint("value BETWEEN -1e12 AND 1e12", name="ck_mission_observation_value"),
        sa.CheckConstraint("uncertainty BETWEEN 0 AND 1e12", name="ck_mission_observation_uncertainty"),
        sa.CheckConstraint("(value IS NULL) <> (event_text IS NULL)", name="ck_mission_observation_payload"),
    )
    op.create_index("ix_mission_observation_history", "mission_observations",
                    ["mission_code", "scope", "crew_code", "recorded_at", "id"])
    op.create_table(
        "observation_audit",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor", sa.String(64), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("mission_code", sa.String(64), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("crew_code", sa.String(64)),
        sa.Column("observation_id", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.execute("""
        LOCK TABLE mission_observations, observation_audit IN ACCESS EXCLUSIVE MODE;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM mission_observations) OR EXISTS (SELECT 1 FROM observation_audit) THEN
                RAISE EXCEPTION 'Archive mission observations and audit records before downgrading.';
            END IF;
        END $$;
    """)
    op.drop_table("observation_audit")
    op.drop_table("mission_observations")
