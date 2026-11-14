from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assessments", sa.Column("engine_snapshot", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("assessments", "engine_snapshot")
