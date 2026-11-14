"""Sleep capture validation and its separation from clinical scoring.

Also runnable without pytest or PostgreSQL:
    python -m unittest discover -s tests -p test_sleep_duration.py
"""

import unittest
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import ValidationError

from app.evaluation import evaluate_assessment
from app.models import Assessment, Measurement, MissionProfile
from app.schemas import MEASUREMENT_UNITS, MeasurementCreate


class SleepDurationTests(unittest.TestCase):
    def payload(self, **changes):
        return {
            "id": str(uuid4()), "kind": "sleep_duration", "value": 7.5,
            "recorded_at": "2026-11-15T10:00:00+03:00", **changes,
        }

    def test_sleep_allows_zero_fractional_and_full_day(self):
        for hours in [0, 7.5, 24]:
            with self.subTest(hours=hours):
                record = MeasurementCreate.model_validate(self.payload(value=hours))
                self.assertEqual(record.value, hours)
                self.assertEqual(MEASUREMENT_UNITS[record.kind], "h")
                self.assertEqual(record.recorded_at.hour, 7)

    def test_sleep_rejects_out_of_range_non_numeric_and_non_finite_values(self):
        for value in [-0.01, 24.01, float("nan"), float("inf"), "7.5", True]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                MeasurementCreate.model_validate(self.payload(value=value))
        with self.assertRaises(ValidationError):
            MeasurementCreate.model_validate(self.payload(diastolic=4))

    def test_sleep_only_assessment_is_not_a_clinical_score(self):
        class NoHistoryQueries:
            def execute(self, *_):
                raise AssertionError("Sleep must not query clinical baseline history")

        profile = MissionProfile(id=uuid4(), environment="orbital_station")
        sleep = Measurement(
            id=uuid4(), kind="sleep_duration", value=7.5, diastolic=None,
            recorded_at=datetime(2026, 11, 15, 7, tzinfo=UTC),
        )
        assessment = Assessment(
            id=uuid4(), crew_member_id=uuid4(), mission_profile_id=profile.id,
            assessed_at=datetime(2026, 11, 15, 8, tzinfo=UTC), symptoms=[], measurements=[sleep],
        )
        evaluate_assessment(NoHistoryQueries(), assessment, profile)
        self.assertEqual(assessment.status, "insufficient_data")
        self.assertEqual(assessment.engine_snapshot["input"]["current"], {})
        self.assertEqual(assessment.engine_result["comparisons"], {})
        self.assertEqual(assessment.measurements[0].value, 7.5)


if __name__ == "__main__":
    unittest.main()
