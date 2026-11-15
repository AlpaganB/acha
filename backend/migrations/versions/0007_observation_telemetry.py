"""Add registered telemetry and structured observation context."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def mission_key() -> sa.Column:
    return sa.Column("mission_code", sa.String(64), sa.ForeignKey("mission_clocks.code"), primary_key=True)


def upgrade() -> None:
    op.add_column("mission_observations", sa.Column("context", JSONB(none_as_null=True)))
    op.create_table(
        "mission_clocks",
        sa.Column("code", sa.String(64), primary_key=True),
        sa.Column("epoch", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "mission_device_channels", mission_key(),
        sa.Column("code", sa.String(64), primary_key=True),
        sa.Column("crew_code", sa.String(64)),
        sa.Column("sha256", sa.String(64)),
        sa.Column("configuration", JSONB, nullable=False),
        sa.UniqueConstraint("sha256", name="uq_device_channel_credential"),
    )
    op.create_table(
        "mission_device_receipts",
        sa.Column("mission_code", sa.String(64), primary_key=True),
        sa.Column("channel_code", sa.String(64), primary_key=True),
        sa.Column("sequence", sa.BigInteger, primary_key=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("observation_id", sa.Uuid, sa.ForeignKey("mission_observations.id", ondelete="CASCADE")),
        sa.ForeignKeyConstraint(["mission_code", "channel_code"],
                                ["mission_device_channels.mission_code", "mission_device_channels.code"]),
    )
    op.create_index("ix_device_receipt_time", "mission_device_receipts", ["mission_code", "channel_code", "recorded_at"])


def downgrade() -> None:
    op.execute("""
        LOCK TABLE mission_clocks, mission_observations IN ACCESS EXCLUSIVE MODE;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM mission_clocks)
                OR EXISTS (SELECT 1 FROM mission_observations WHERE context IS NOT NULL) THEN
                RAISE EXCEPTION 'Archive telemetry and structured observations before downgrading.';
            END IF;
        END $$;
    """)
    op.drop_table("mission_device_receipts")
    op.drop_table("mission_device_channels")
    op.drop_table("mission_clocks")
    op.drop_column("mission_observations", "context")
