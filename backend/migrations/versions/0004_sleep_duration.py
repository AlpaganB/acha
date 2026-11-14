"""Allow recorded sleep duration in hours, without changing clinical scoring."""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

LEGACY_CHECK = (
    "(kind = 'blood_pressure' AND diastolic IS NOT NULL AND diastolic > 0 AND value >= diastolic)"
    " OR (diastolic IS NULL AND ("
    "(kind = 'heart_rate' AND value > 0)"
    " OR (kind = 'spo2' AND value BETWEEN 0 AND 100)"
    " OR (kind = 'body_temperature' AND value >= -273.15)))"
)


def upgrade() -> None:
    op.drop_constraint("ck_measurements_values_by_kind", "measurements", type_="check")
    op.create_check_constraint(
        "ck_measurements_values_by_kind", "measurements",
        LEGACY_CHECK + " OR (kind = 'sleep_duration' AND diastolic IS NULL AND value BETWEEN 0 AND 24)",
    )


def downgrade() -> None:
    # Preserve records: a downgrade requires explicitly handling any sleep entries first.
    op.drop_constraint("ck_measurements_values_by_kind", "measurements", type_="check")
    op.create_check_constraint("ck_measurements_values_by_kind", "measurements", LEGACY_CHECK)
