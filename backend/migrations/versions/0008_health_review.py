"""Store mission health-review policy versions and acknowledgments."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_review_policies",
        sa.Column("mission_code", sa.String(64), primary_key=True),
        sa.Column("version", sa.String(64), primary_key=True),
        sa.Column("configuration", JSONB, nullable=False),
        sa.Column("published_by", sa.String(64), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True)),
        sa.Column("retired_by", sa.String(64)),
    )
    op.create_index("ix_health_review_active", "health_review_policies", ["mission_code"], unique=True,
                    postgresql_where=sa.text("retired_at IS NULL"))
    op.create_table(
        "health_review_acknowledgments",
        sa.Column("mission_code", sa.String(64), primary_key=True),
        sa.Column("crew_code", sa.String(64), primary_key=True),
        sa.Column("decision_key", sa.String(64), primary_key=True),
        sa.Column("policy_version", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("actor", sa.String(64), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.ForeignKeyConstraint(
            ["mission_code", "policy_version"], ["health_review_policies.mission_code", "health_review_policies.version"],
        ),
    )


def downgrade() -> None:
    op.execute("""
        LOCK TABLE health_review_policies, mission_observations, health_review_acknowledgments
            IN ACCESS EXCLUSIVE MODE;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM health_review_policies)
                OR EXISTS (SELECT 1 FROM mission_observations WHERE parameter IN (
                    'nasa_career_effective_dose', 'organ_gray_equivalent_30d', 'hippocampal_absorbed_30d',
                    'radiation_reid', 'radiation_reic', 'skeletal_strength'
                )) THEN
                RAISE EXCEPTION 'Archive health-review policies and qualified observations before downgrading.';
            END IF;
        END $$;
    """)
    op.drop_table("health_review_acknowledgments")
    op.drop_table("health_review_policies")
