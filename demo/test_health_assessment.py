import json
import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from health_assessment import AssessmentInput, MissionProfile, evaluate_health

NOW = datetime(2026, 11, 14, 10, tzinfo=timezone.utc)
REVIEW = {"status": "review", "next_step": "Open the review demo."}
URGENT = {
    "status": "urgent", "next_step": "Open the urgent demo.", "protocol_id": "DEMO-01"
}


def sample(value, minutes_before=0):
    return {"value": value, "measured_at": NOW - timedelta(minutes=minutes_before)}


def profile(**rules):
    return MissionProfile.model_validate({
        "metrics": {"heart_rate": {"max_age_minutes": 15, **rules}},
        "symptoms": {"demo_event": URGENT, "demo_note": None},
    })


class AssessmentTests(unittest.TestCase):
    def setUp(self):
        self.absolute = {"upper": {"value": 20, "action": REVIEW}}
        self.baseline = {"lower": {"value": -5, "action": REVIEW}}
        self.trend = {
            "window_minutes": 10,
            "delta": {"upper": {"value": 4, "action": REVIEW}},
        }

    def evaluate(self, mission, **payload):
        return evaluate_health(AssessmentInput(assessed_at=NOW, **payload), mission)

    def test_inclusive_boundary_and_json_response_shape(self):
        result = self.evaluate(profile(absolute=self.absolute),
                               current={"heart_rate": sample(20, 15)}, symptoms=[])
        self.assertEqual(result.status, "no_flags")
        serialized = json.loads(result.model_dump_json())
        self.assertEqual({key: serialized[key] for key in ("status", "rationale", "protocol_id", "next_step")}, {
            "status": "no_flags", "rationale": [], "protocol_id": None,
            "next_step": "No configured rule was triggered.",
        })

    def test_absolute_result_has_evidence_and_outranks_missing_baseline(self):
        result = self.evaluate(profile(absolute=self.absolute, baseline_delta=self.baseline),
                               current={"heart_rate": sample(21)}, symptoms=[])
        self.assertEqual(result.status, "review")
        absolute, missing = result.rationale
        self.assertEqual((absolute.code, absolute.observed, absolute.threshold, absolute.unit),
                         ("absolute_limit", 21, 20, "bpm"))
        self.assertEqual(missing.code, "missing_baseline")

    def test_symptom_outranks_measurement_review(self):
        result = self.evaluate(profile(absolute=self.absolute), current={"heart_rate": sample(21)},
                               symptoms=["demo_event", "demo_event"])
        self.assertEqual((result.status, result.protocol_id, result.next_step),
                         ("urgent", "DEMO-01", URGENT["next_step"]))
        self.assertEqual([finding.code for finding in result.rationale],
                         ["reported_symptom", "absolute_limit"])

    def test_urgent_symptom_survives_missing_measurement(self):
        result = self.evaluate(profile(absolute=self.absolute), symptoms=["demo_event"])
        self.assertEqual(result.status, "urgent")
        self.assertEqual(result.rationale[1].code, "missing_measurement")

    def test_baseline_delta_preserves_direction(self):
        result = self.evaluate(profile(baseline_delta=self.baseline), symptoms=[],
                               current={"heart_rate": sample(14)}, baselines={"heart_rate": 20})
        finding = result.rationale[0]
        self.assertEqual((finding.code, finding.direction, finding.reference, finding.compared_value),
                         ("baseline_delta", "below", 20, -6))

    def test_trend_uses_adjacent_median_windows_and_deduplicates(self):
        history = [sample(8, 10), sample(6, 15), sample(14, 5), sample(999, 20),
                   sample(16), sample(999, -1), sample(6, 15)]
        result = self.evaluate(profile(trend=self.trend), symptoms=[],
                               current={"heart_rate": sample(16)}, history={"heart_rate": history})
        finding = result.rationale[0]
        self.assertEqual((finding.code, finding.observed, finding.reference, finding.compared_value),
                         ("trend_delta", 15, 7, 8))

    def test_trend_requires_distinct_nonconflicting_samples(self):
        mission = profile(trend=self.trend)
        for history, expected in [
            ([sample(15, 5), sample(7, 15), sample(7, 15)], "missing_trend_history"),
            ([sample(15, 5), sample(8, 15), sample(7, 15)], "conflicting_trend_history"),
        ]:
            with self.subTest(expected=expected):
                result = self.evaluate(mission, symptoms=[], current={"heart_rate": sample(16)},
                                       history={"heart_rate": history})
                self.assertEqual(result.status, "insufficient_data")
                self.assertEqual(result.rationale[0].code, expected)

    def test_stale_and_future_values_are_excluded(self):
        for age, code in [(16, "stale_measurement"), (-1, "future_measurement")]:
            with self.subTest(age=age):
                result = self.evaluate(profile(absolute=self.absolute), symptoms=[],
                                       current={"heart_rate": sample(99, age)})
                self.assertEqual(result.status, "insufficient_data")
                self.assertEqual(result.rationale[0].code, code)

    def test_missing_unknown_and_neutral_symptoms_are_distinct(self):
        mission = profile(absolute=self.absolute)
        current = {"heart_rate": sample(10)}
        for symptoms, code in [(None, "missing_symptom_answers"), (["unmapped"], "unknown_symptom")]:
            with self.subTest(symptoms=symptoms):
                result = self.evaluate(mission, current=current, symptoms=symptoms)
                self.assertEqual(result.rationale[0].code, code)
        self.assertEqual(self.evaluate(mission, current=current, symptoms=["demo_note"]).status,
                         "no_flags")

    def test_invalid_input_and_profile_are_rejected(self):
        for invalid in [True, "10", float("nan"), float("inf")]:
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                self.evaluate(profile(absolute=self.absolute), current={"heart_rate": sample(invalid)})
        with self.assertRaises(ValidationError):
            AssessmentInput(assessed_at=NOW.replace(tzinfo=None))
        with self.assertRaises(ValidationError):
            MissionProfile(symptoms={"demo_event": {"status": "urgent", "next_step": "Demo"}})
        with self.assertRaises(ValidationError):
            profile(absolute={"upper": {"value": 2, "action": REVIEW},
                              "lower": {"value": 3, "action": REVIEW}})


if __name__ == "__main__":
    unittest.main()
