import math
import unittest
from datetime import timedelta

from pydantic import ValidationError

from health_assessment import evaluate_health_payload
from test_health_assessment import NOW, REVIEW, URGENT
from test_news2 import CONFIG, payload


class RuleIntegrationTests(unittest.TestCase):
    def test_inclusive_threshold_and_adjacent_floats(self):
        for direction in ("lower", "upper"):
            for inclusive in (False, True):
                profile = {"metrics": {"heart_rate": {"max_age_minutes": 1, "absolute": {
                    direction: {"value": 80, "inclusive": inclusive, "action": REVIEW}}}}}
                for value in (math.nextafter(80, -math.inf), 80, math.nextafter(80, math.inf)):
                    result = evaluate_health_payload({"assessed_at": NOW, "current": {
                        "heart_rate": {"value": value, "measured_at": NOW}}}, profile)
                    expected = (value < 80 if direction == "lower" else value > 80) or (inclusive and value == 80)
                    self.assertEqual(result["status"], "review" if expected else "no_flags")

    def test_multiple_severity_bands_keep_evidence(self):
        profile = {"profile_version": "demo-bands-1", "metrics": {"heart_rate": {
            "max_age_minutes": 1,
            "absolute": {"upper": {"value": 100, "action": REVIEW, "rule_id": "demo-review"}},
            "additional_absolute": [{"upper": {"value": 130, "inclusive": True,
                "action": URGENT, "rule_id": "demo-urgent", "source": "synthetic-test"}}]}}}
        for value, expected in ((100, "no_flags"), (101, "review"), (129, "review"), (130, "urgent")):
            result = evaluate_health_payload({"assessed_at": NOW, "current": {
                "heart_rate": {"value": value, "measured_at": NOW}}}, profile)
            self.assertEqual(result["status"], expected)
        self.assertEqual(result["rationale"][0]["rule_id"], "demo-urgent")
        self.assertTrue(result["rationale"][0]["threshold_inclusive"])
        self.assertEqual(len(result["rationale"]), 2)

    def test_device_range_prevents_news2_using_rejected_measurement(self):
        data = payload()
        data["current"]["spo2"]["value"] = 45
        profile = {"news2": CONFIG, "metrics": {"spo2": {"max_age_minutes": 5,
            "valid_min": 70, "absolute": {"lower": {"value": 90, "action": REVIEW}}}}}
        result = evaluate_health_payload(data, profile)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIsNone(result["news2"]["total_score"])
        self.assertNotIn("spo2", [c["parameter"] for c in result["news2"]["components"]])

    def test_symptom_urgent_survives_zero_news2(self):
        data = payload()
        data["symptoms"] = ["demo_event"]
        result = evaluate_health_payload(data, {"news2": CONFIG, "symptoms": {"demo_event": URGENT}})
        self.assertEqual(result["news2"]["total_score"], 0)
        self.assertEqual(result["status"], "urgent")

    def test_unknown_confusion_onset_receives_three_points(self):
        data = payload()
        data["news2_context"]["consciousness"] = "confusion_onset_unknown"
        result = evaluate_health_payload(data, {"news2": CONFIG})
        self.assertEqual(result["news2"]["total_score"], 3)
        self.assertEqual(result["status"], "urgent")

    def test_invalid_profiles_are_rejected(self):
        invalid = [{}, {"metrics": {"heart_rate": {"max_age_minutes": 1}}},
            {"metrics": {"heart_rate": {"max_age_minutes": 1, "absolute": {}}}},
            {"metrics": {"heart_rate": {"max_age_minutes": 1, "valid_min": 10, "valid_max": 5,
                "absolute": {"upper": {"value": 100, "action": REVIEW}}}}}]
        for profile in invalid:
            with self.subTest(profile=profile), self.assertRaises(ValidationError):
                evaluate_health_payload({"assessed_at": NOW}, profile)

    def test_failure_without_news2_suppresses_old_reading(self):
        data = {"assessed_at": NOW, "current": {"heart_rate": {"value": 80, "measured_at": NOW}},
                "measurement_failures": {"heart_rate": {"measured_at": NOW, "reason": "equipment_unavailable"}}}
        profile = {"metrics": {"heart_rate": {"max_age_minutes": 1,
                   "absolute": {"upper": {"value": 100, "action": REVIEW}}}}}
        result = evaluate_health_payload(data, profile)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIn("measurement_unavailable", [f["code"] for f in result["rationale"]])

    def test_custom_rule_failure_clears_only_after_valid_reading(self):
        profile = {"metrics": {"heart_rate": {"max_age_minutes": 1,
                   "absolute": {"upper": {"value": 100, "action": REVIEW}}}}}
        data = {"assessed_at": NOW, "current": {"heart_rate": {"value": 80, "measured_at": NOW}},
                "measurement_failures": {"heart_rate": {"measured_at": NOW - timedelta(seconds=1),
                                                        "reason": "equipment_unavailable"}}}
        self.assertEqual(evaluate_health_payload(data, profile)["status"], "no_flags")
        data["current"]["heart_rate"]["quality"] = "suspect"
        self.assertEqual(evaluate_health_payload(data, profile)["status"], "insufficient_data")

    def test_unknown_failure_is_reported(self):
        data = payload()
        data["measurement_failures"] = {"heart_rate": {"measured_at": NOW, "reason": "equipment_unavailable"}}
        result = evaluate_health_payload(data, {"news2": CONFIG})
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIn("unconfigured_measurement_failure", [f["code"] for f in result["rationale"]])

    def test_future_failure_and_stale_unresolved_failure(self):
        for seconds in (-1, 301):
            data = payload()
            data["current"].pop("spo2")
            data["measurement_failures"] = {"spo2": {
                "measured_at": NOW - timedelta(seconds=seconds), "reason": "unable_to_obtain"}}
            result = evaluate_health_payload(data, {"news2": CONFIG})
            self.assertEqual(result["status"], "insufficient_data")
            self.assertIn("invalid_failure_time", [f["code"] for f in result["rationale"]])

    def test_negative_rate_is_not_scored(self):
        data = {"assessed_at": NOW, "current": {"heart_rate": {"value": -1, "measured_at": NOW}}}
        profile = {"metrics": {"heart_rate": {"max_age_minutes": 1,
                   "absolute": {"lower": {"value": 50, "action": REVIEW}}}}}
        result = evaluate_health_payload(data, profile)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["rationale"][0]["code"], "invalid_measurement")


if __name__ == "__main__":
    unittest.main()
