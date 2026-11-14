import copy
import itertools
import unittest
from datetime import timedelta

from pydantic import ValidationError

from health_assessment import AssessmentInput, MissionProfile, evaluate_health_payload
from news2 import News2Config, classify_scores, score_parameter
from test_health_assessment import NOW

CONFIG = {"max_age_seconds": 300, "max_spread_seconds": 60,
          "review_protocol_id": "DEMO-REVIEW", "urgent_protocol_id": "DEMO-URGENT",
          "emergency_protocol_id": "DEMO-EMERGENCY"}
NORMAL = {"respiratory_rate": 16, "spo2": 98, "systolic_bp": 120,
          "pulse_rate": 70, "temperature": 37.0}
UNITS = {"respiratory_rate": "breaths/min", "spo2": "%", "systolic_bp": "mmHg",
         "pulse_rate": "bpm", "temperature": "C"}


def payload():
    return {"assessed_at": NOW, "current": {
        metric: {"value": value, "measured_at": NOW, "unit": UNITS[metric]}
        for metric, value in NORMAL.items()}, "symptoms": [], "news2_context": {
            "measured_at": NOW, "age_years": 30, "pregnant": False,
            "consciousness": "alert", "supplemental_oxygen": False}}


def assess(data, **config):
    return evaluate_health_payload(data, {"profile_version": "test-1", "news2": {**CONFIG, **config}})


def reference_score(parameter, value, scale=1, oxygen=False):
    """Independent interval-based reference transcribed from RCP Chart 1."""
    if parameter == "respiratory_rate":
        if value <= 8 or value >= 25:
            return 3
        if 9 <= value <= 11:
            return 1
        return 2 if 21 <= value <= 24 else 0
    if parameter == "spo2":
        if scale == 1:
            if value >= 96:
                return 0
            if value >= 94:
                return 1
            return 2 if value >= 92 else 3
        if value <= 83:
            return 3
        if value <= 85:
            return 2
        if value <= 87:
            return 1
        if value <= 92 or not oxygen:
            return 0
        if value <= 94:
            return 1
        return 2 if value <= 96 else 3
    if parameter == "systolic_bp":
        if value <= 90 or value >= 220:
            return 3
        if value <= 100:
            return 2
        return 1 if value <= 110 else 0
    if parameter == "pulse_rate":
        if value <= 40 or value >= 131:
            return 3
        if value <= 50 or 91 <= value <= 110:
            return 1
        return 2 if value >= 111 else 0
    if parameter == "temperature":
        if value <= 35:
            return 3
        if value <= 36 or 38.1 <= value <= 39:
            return 1
        return 2 if value >= 39.1 else 0
    raise AssertionError(parameter)


def reference_trigger(scores):
    total = sum(scores)
    if total == 0:
        return "routine"
    if total <= 4:
        return "single_red" if max(scores) == 3 else "low"
    return "medium" if total <= 6 else "high"


class News2Tests(unittest.TestCase):
    def test_all_discrete_values_against_reference(self):
        domains = {"respiratory_rate": range(0, 81), "spo2": range(101),
                   "systolic_bp": range(301), "pulse_rate": range(251),
                   "temperature": [value / 10 for value in range(250, 451)]}
        for metric, values in domains.items():
            for value in values:
                with self.subTest(metric=metric, value=value):
                    self.assertEqual(score_parameter(metric, value), reference_score(metric, value))
        for value, oxygen in itertools.product(range(101), (False, True)):
            self.assertEqual(score_parameter("spo2", value, 2, oxygen),
                             reference_score("spo2", value, 2, oxygen))

    def test_all_score_vectors_match_trigger_reference(self):
        for scores in itertools.product(range(4), repeat=6):
            for oxygen_score in (0, 2):
                vector = [*scores, oxygen_score]
                self.assertEqual(classify_scores(vector), reference_trigger(vector))

    def test_complete_zero_score(self):
        result = assess(payload())
        self.assertEqual(result["status"], "no_flags")
        self.assertEqual(result["news2"]["total_score"], 0)
        self.assertTrue(result["news2"]["complete"])
        self.assertEqual(len(result["news2"]["components"]), 7)

    def test_single_red_triggers_even_below_total_five(self):
        data = payload()
        data["current"]["respiratory_rate"]["value"] = 25
        result = assess(data)
        self.assertEqual(result["news2"]["total_score"], 3)
        self.assertEqual(result["news2"]["trigger"], "single_red")
        self.assertEqual((result["status"], result["protocol_id"]), ("urgent", "DEMO-URGENT"))

    def test_scale2_air_and_oxygen(self):
        data = payload()
        for oxygen, total in ((False, 0), (True, 5)):
            data["news2_context"]["supplemental_oxygen"] = oxygen
            result = assess(data, oxygen_scale=2, scale2_authorization="DEMO-CLINICIAN-NOTE")
            self.assertEqual(result["news2"]["total_score"], total)

    def test_scale2_requires_profile_authorization(self):
        with self.assertRaises(ValidationError):
            assess(payload(), oxygen_scale=2)

    def test_missing_oxygen_blocks_scale2_saturation_scoring(self):
        data = payload()
        data["news2_context"].pop("supplemental_oxygen")
        result = assess(data, oxygen_scale=2, scale2_authorization="DEMO-NOTE")
        self.assertIn("news2_missing_oxygen_for_scale2", [f["code"] for f in result["rationale"]])
        self.assertNotIn("spo2", [c["parameter"] for c in result["news2"]["components"]])
        with self.assertRaises(ValueError):
            score_parameter("spo2", 90, oxygen_scale=2)

    def test_absent_context_blocks_complete_score(self):
        data = payload()
        data.pop("news2_context")
        result = assess(data)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIsNone(result["news2"]["total_score"])

    def test_out_of_domain_values_are_not_scored(self):
        for metric, value in (("spo2", 101), ("pulse_rate", -1)):
            data = payload()
            data["current"][metric]["value"] = value
            result = assess(data)
            self.assertIn("news2_invalid_value", [f["code"] for f in result["rationale"]])

    def test_low_and_high_protocol_selection(self):
        data = payload()
        data["current"]["pulse_rate"]["value"] = 91
        self.assertEqual(assess(data)["protocol_id"], "DEMO-REVIEW")
        data["current"]["respiratory_rate"]["value"] = 25
        data["current"]["spo2"]["value"] = 91
        result = assess(data)
        self.assertEqual(result["news2"]["total_score"], 7)
        self.assertEqual(result["protocol_id"], "DEMO-EMERGENCY")

    def test_no_implicit_patient_context_or_oxygen(self):
        for key in ("age_years", "pregnant", "consciousness", "supplemental_oxygen"):
            data = payload()
            del data["news2_context"][key]
            result = assess(data)
            self.assertIsNone(result["news2"]["total_score"])
            self.assertEqual(result["status"], "insufficient_data")

    def test_population_scope(self):
        for updates in ({"age_years": 15}, {"pregnant": True}):
            data = payload()
            data["news2_context"].update(updates)
            result = assess(data)
            self.assertIsNone(result["news2"]["trigger"])
            self.assertIsNone(result["news2"]["minimum_trigger"])
            self.assertEqual(result["status"], "insufficient_data")

    def test_missing_data_does_not_hide_known_urgent_score(self):
        data = payload()
        data["current"].pop("temperature")
        data["current"]["respiratory_rate"]["value"] = 25
        result = assess(data)
        self.assertIsNone(result["news2"]["total_score"])
        self.assertEqual(result["news2"]["partial_score"], 3)
        self.assertEqual(result["status"], "urgent")
        self.assertFalse(result["news2"]["complete"])

    def test_every_missing_field_combination_is_incomplete(self):
        fields = [*NORMAL, "consciousness", "supplemental_oxygen"]
        for flags in itertools.product((False, True), repeat=7):
            data = payload()
            for field, missing in zip(fields, flags):
                if missing:
                    target = data["current"] if field in NORMAL else data["news2_context"]
                    target.pop(field)
            result = assess(data)
            self.assertEqual(result["news2"]["complete"], not any(flags))
            self.assertEqual(result["news2"]["total_score"], None if any(flags) else 0)

    def test_ambiguous_precision_is_not_rounded(self):
        for metric, value in (("temperature", 36.05), ("spo2", 95.5), ("pulse_rate", 90.5)):
            data = payload()
            data["current"][metric]["value"] = value
            result = assess(data)
            self.assertEqual(result["status"], "insufficient_data")
            self.assertIn("news2_invalid_precision", [f["code"] for f in result["rationale"]])

    def test_units_quality_and_timestamps(self):
        for updates, code in [({"unit": "F"}, "news2_unit_required_or_mismatch"),
            ({"unit": None}, "news2_unit_required_or_mismatch"),
            ({"quality": "suspect"}, "news2_suspect_measurement"),
            ({"measured_at": NOW - timedelta(seconds=301)}, "news2_stale_measurement"),
            ({"measured_at": NOW + timedelta(seconds=1)}, "news2_future_measurement")]:
            data = payload()
            data["current"]["temperature"].update(updates)
            result = assess(data)
            self.assertIn(code, [f["code"] for f in result["rationale"]])
            self.assertIsNone(result["news2"]["total_score"])

    def test_observation_spread_boundary(self):
        for seconds, complete in ((60, True), (61, False)):
            data = payload()
            data["current"]["temperature"]["measured_at"] = NOW - timedelta(seconds=seconds)
            self.assertEqual(assess(data)["news2"]["complete"], complete)

    def test_invalid_context_timestamp(self):
        data = payload()
        data["news2_context"]["measured_at"] = NOW + timedelta(seconds=1)
        result = assess(data)
        self.assertIsNone(result["news2"]["total_score"])

    def test_maximum_age_boundary_is_inclusive(self):
        data = payload()
        for reading in data["current"].values():
            reading["measured_at"] = NOW - timedelta(seconds=300)
        data["news2_context"]["measured_at"] = NOW - timedelta(seconds=300)
        self.assertTrue(assess(data)["news2"]["complete"])

    def test_unsynchronized_data_preserves_single_red_without_aggregate(self):
        data = payload()
        data["current"]["temperature"]["measured_at"] = NOW - timedelta(seconds=61)
        data["current"]["respiratory_rate"]["value"] = 25
        result = assess(data)
        self.assertIsNone(result["news2"]["total_score"])
        self.assertEqual(result["news2"]["minimum_trigger"], "single_red")
        self.assertEqual(result["status"], "urgent")

    def test_invalid_boolean_is_rejected(self):
        for value in ("false", 0, 1):
            data = payload()
            data["news2_context"]["supplemental_oxygen"] = value
            with self.assertRaises(ValidationError):
                assess(data)

    def test_failure_reason_has_distinct_escalation(self):
        for reason, status in (("equipment_unavailable", "insufficient_data"), ("unable_to_obtain", "urgent")):
            data = payload()
            data["measurement_failures"] = {"spo2": {"reason": reason, "measured_at": NOW}}
            result = assess(data)
            self.assertEqual(result["status"], status)
            self.assertIsNone(result["news2"]["total_score"])

    def test_new_successful_measurement_supersedes_old_failure(self):
        data = payload()
        data["measurement_failures"] = {"spo2": {"reason": "unable_to_obtain",
                                              "measured_at": NOW - timedelta(seconds=1)}}
        self.assertEqual(assess(data)["status"], "no_flags")

    def test_new_invalid_reading_does_not_cancel_unresolved_failure(self):
        for update in ({"quality": "suspect"}, {"unit": "fraction"}, {"value": 95.5},
                       {"value": 101}, {"measured_at": NOW + timedelta(seconds=1)}):
            data = payload()
            data["current"]["spo2"].update(update)
            data["measurement_failures"] = {"spo2": {"reason": "unable_to_obtain",
                "measured_at": NOW - timedelta(seconds=1)}}
            result = assess(data)
            self.assertEqual(result["status"], "urgent")
            self.assertIn("news2_unobtainable_measurement", [f["code"] for f in result["rationale"]])

    def test_profile_fingerprint_and_input_preservation(self):
        data = payload()
        before = copy.deepcopy(data)
        first = assess(data)
        self.assertEqual(data, before)
        self.assertEqual(first, assess(data))
        self.assertNotEqual(first["profile_hash"], assess(data, max_age_seconds=301)["profile_hash"])
        self.assertEqual(first["profile_version"], "test-1")


if __name__ == "__main__":
    unittest.main()
