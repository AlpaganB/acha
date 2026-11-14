"""Allow respiratory-rate readings in the existing measurements table."""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

CONSTRAINT = "ck_measurements_values_by_kind"
ORIGINAL_VALUES = (
    "(kind = 'blood_pressure' AND diastolic IS NOT NULL AND diastolic > 0 AND value >= diastolic)"
    " OR (diastolic IS NULL AND ("
    "(kind = 'heart_rate' AND value > 0)"
    " OR (kind = 'spo2' AND value BETWEEN 0 AND 100)"
    " OR (kind = 'body_temperature' AND value >= -273.15)"
    " OR (kind = 'sleep_duration' AND value BETWEEN 0 AND 24)"
)


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT, "measurements", type_="check")
    op.create_check_constraint(
        CONSTRAINT, "measurements",
        ORIGINAL_VALUES + " OR (kind = 'respiratory_rate' AND value >= 0)))",
    )


def downgrade() -> None:
    # Preserve new data and schedules if the older application cannot represent them.
    op.drop_constraint(CONSTRAINT, "measurements", type_="check")
    op.execute("LOCK TABLE mission_profiles IN SHARE ROW EXCLUSIVE MODE")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM measurements WHERE kind = 'respiratory_rate')
            OR EXISTS (
                SELECT 1 FROM mission_profiles
                WHERE measurement_schedules @> '[{"kind":"respiratory_rate"}]'::jsonb
            ) THEN
                RAISE EXCEPTION 'Export and remove respiratory-rate readings and schedules before downgrading.';
            END IF;
        END $$;
    """)
    op.create_check_constraint(CONSTRAINT, "measurements", ORIGINAL_VALUES + "))")
