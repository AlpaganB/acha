"""Keep legacy test records out of the crew workspace."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("crew_members", sa.Column("archived", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.execute("""
        UPDATE crew_members SET archived = true WHERE id IN (
            '83c5be82-2bc3-4bdb-a7a6-7d191a560101',
            '83c5be82-2bc3-4bdb-a7a6-7d191a560102'
        )
    """)


def downgrade() -> None:
    op.drop_column("crew_members", "archived")
