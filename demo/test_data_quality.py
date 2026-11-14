import unittest
import itertools
from datetime import timedelta

from health_assessment import AssessmentInput, MissionProfile, evaluate_health
from test_health_assessment import NOW, REVIEW, URGENT, sample


class DataQualityTests(unittest.TestCase):
    def setUp(self):
        self.rules = {"max_age_minutes": 5,
                      "absolute": {"lower": {"value": 90, "action": REVIEW}}}
        self.profile = MissionProfile(metrics={"spo2": self.rules}, symptoms={"demo_event": URGENT})

    def evaluate(self, measurement, **extra):
        return evaluate_health(AssessmentInput(assessed_at=NOW, current={"spo2": measurement},
                                               symptoms=[], **extra), self.profile)

    def test_percent_above_100_does_not_pass_as_no_flags(self):
        result = self.evaluate(sample(101))
        self.assertEqual(result.status, "insufficient_data")
        self.assertEqual(result.rationale[0].code, "invalid_measurement")

    def test_negative_measurement_is_rejected(self):
        self.assertEqual(self.evaluate(sample(-1)).rationale[0].code, "invalid_measurement")

    def test_unit_mismatch_and_suspect_quality(self):
        for extra, code in [({"unit": "fraction"}, "unit_mismatch"),
                            ({"quality": "suspect"}, "suspect_measurement")]:
            with self.subTest(code=code):
                self.assertEqual(self.evaluate({**sample(98), **extra}).rationale[0].code, code)

    def test_zero_can_trigger_a_rule_instead_of_being_silently_discarded(self):
        result = self.evaluate(sample(0))
        self.assertEqual(result.status, "review")
        self.assertEqual(result.rationale[0].observed, 0)

    def test_unconfigured_reading_is_reported(self):
        data = AssessmentInput(assessed_at=NOW, current={"heart_rate": sample(90)}, symptoms=[])
        result = evaluate_health(data, self.profile)
        self.assertIn("unconfigured_metric", [f.code for f in result.rationale])

    def test_invalid_data_preserves_urgent_symptom(self):
        data = AssessmentInput(assessed_at=NOW, current={"spo2": sample(105)}, symptoms=["demo_event"])
        result = evaluate_health(data, self.profile)
        self.assertEqual(result.status, "urgent")
        self.assertIn("invalid_measurement", [f.code for f in result.rationale])

    def test_invalid_baseline_is_reported(self):
        self.profile.metrics["spo2"].baseline_delta = self.profile.metrics["spo2"].absolute
        self.assertEqual(self.evaluate(sample(98), baselines={"spo2": 150}).rationale[0].code,
                         "invalid_baseline")

    def test_device_range_boundaries(self):
        self.profile.metrics["spo2"].valid_min = 70
        self.profile.metrics["spo2"].valid_max = 99
        self.assertEqual(self.evaluate(sample(69)).rationale[0].code, "invalid_measurement")
        self.assertEqual(self.evaluate(sample(70)).rationale[0].code, "absolute_limit")
        self.assertEqual(self.evaluate(sample(99)).status, "no_flags")
        self.assertEqual(self.evaluate(sample(100)).rationale[0].code, "invalid_measurement")

    def test_offset_timestamps_represent_same_instant(self):
        result = self.evaluate({"value": 98, "measured_at": NOW.isoformat().replace(
            "10:00:00+00:00", "13:00:00+03:00")})
        self.assertEqual(result.status, "no_flags")

    def test_invalid_trend_samples_are_visible(self):
        self.profile = MissionProfile(metrics={"spo2": {"max_age_minutes": 5, "trend": {
            "window_minutes": 1, "delta": {"upper": {"value": 1, "action": REVIEW}}}}})
        for value in (101, -2):
            result = self.evaluate(sample(98), history={"spo2": [
                {"value": value, "measured_at": NOW - timedelta(seconds=20)}]})
            self.assertEqual(result.rationale[0].code, "invalid_trend_history")

    def test_mixed_history_errors_do_not_depend_on_input_order(self):
        self.profile = MissionProfile(metrics={"spo2": {"max_age_minutes": 5, "trend": {
            "window_minutes": 1, "delta": {"upper": {"value": 1, "action": REVIEW}}}}})
        rows = [{"value": value, "measured_at": NOW - timedelta(seconds=second)}
                for value, second in ((98, 10), (97, 10), (105, 20), (98, 70))]
        expected = None
        for ordering in itertools.permutations(rows):
            result = self.evaluate(sample(98), history={"spo2": list(ordering)})
            if expected is None:
                expected = result
            self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
