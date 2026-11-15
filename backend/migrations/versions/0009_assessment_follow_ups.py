"""Persist linked assessment follow-up evidence and workflow closure."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assessment_follow_ups",
        sa.Column("assessment_id", sa.Uuid, sa.ForeignKey("assessments.id"), primary_key=True),
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("measurement_id", sa.Uuid, sa.ForeignKey("measurements.id"), nullable=False),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.clock_timestamp(), nullable=False),
        sa.CheckConstraint("outcome IN ('continue_review', 'workflow_complete')", name="ck_follow_up_outcome"),
        sa.UniqueConstraint("assessment_id", "measurement_id", name="uq_follow_up_measurement"),
    )


def downgrade() -> None:
    op.drop_table("assessment_follow_ups")
