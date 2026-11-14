import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from crew_app import METRICS, Store
from health_assessment import evaluate_health_payload
from serve_demo import handle


class DemoFlowTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "crew.sqlite"
        self.store = Store(self.path)

    def request(self, method, path, payload=None):
        status, mime, body = handle(self.store, method, path, "application/json",
                                    json.dumps(payload).encode() if payload is not None else b"",
                                    None, "127.0.0.1:8765")
        return status, json.loads(body) if mime.startswith("application/json") else body

    def checkin(self, profile="orbital"):
        stamp = datetime.now(timezone.utc).isoformat()
        return {"id": str(uuid4()), "profile": profile, "symptoms": [], "supplemental_oxygen": False,
                "readings": {key: {"value": metric[5], "unit": metric[1], "measured_at": stamp}
                             for key, metric in METRICS.items() if profile != "transit" or not key.endswith("_bp")}}

    def test_routine_drift_urgent_and_replay(self):
        routine = self.checkin()
        status, result = self.request("POST", "/api/checkins", routine)
        self.assertEqual((status, result["status"], result["news2"]["total_score"]), (200, "no_flags", 0))
        self.assertFalse(result["trend_available"])
        self.assertEqual(self.request("POST", "/api/checkins", routine)[1], result)

        drift = self.checkin()
        drift["readings"]["pulse_rate"]["value"] = 86
        status, result = self.request("POST", "/api/checkins", drift)
        self.assertEqual((status, result["status"]), (200, "review"))
        self.assertTrue(any(f["code"] == "baseline_delta" for f in result["rationale"]))

        urgent = self.checkin()
        del urgent["readings"]["temperature"]
        urgent["symptoms"] = ["chest_pain"]
        status, result = self.request("POST", "/api/checkins", urgent)
        self.assertEqual((status, result["status"], result["protocol_id"]), (200, "urgent", "DEMO-CHEST"))
        self.assertIsNone(result["news2"]["total_score"])
        self.assertTrue(result["guide"]["steps"])
        replay = evaluate_health_payload(result["input_snapshot"], result["profile_snapshot"])
        self.assertEqual(replay, {key: result[key] for key in replay})

        self.store = Store(self.path)
        self.assertEqual(len(self.request("GET", "/api/history")[1]), 3)
        self.assertEqual(self.request("POST", "/api/sync", {})[1], {"acknowledged": 3, "total_received": 3})
        self.assertEqual(self.request("POST", "/api/sync", {})[1], {"acknowledged": 0, "total_received": 3})

    def test_transit_profile_and_failed_sensor(self):
        data = self.checkin("transit")
        data["readings"].pop("spo2")
        data["failures"] = {"spo2": "unable_to_obtain"}
        status, result = self.request("POST", "/api/checkins", data)
        self.assertEqual((status, result["status"]), (200, "urgent"))
        self.assertTrue(any(f["code"] == "news2_unobtainable_measurement" for f in result["rationale"]))

    def test_invalid_pressure_and_conflicting_id(self):
        data = self.checkin()
        data["readings"]["diastolic_bp"]["value"] = 140
        self.assertEqual(self.request("POST", "/api/checkins", data)[0], 422)
        data["readings"]["diastolic_bp"]["value"] = 78
        self.assertEqual(self.request("POST", "/api/checkins", data)[0], 200)
        data["symptoms"] = ["fatigue"]
        self.assertEqual(self.request("POST", "/api/checkins", data)[0], 400)

    def test_all_offline_files_and_guides_exist(self):
        for path in ("/", "/app.css", "/app.js", "/sw.js", "/api/config"):
            status, body = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertTrue(body)
        self.assertIn("DEMO-UNRESPONSIVE", self.request("GET", "/api/config")[1]["guides"])

    def test_delayed_observations_preserve_capture_time_and_enable_trend(self):
        now = datetime.now(timezone.utc)
        for hours, pulse in ((20, 72), (16, 72), (2, 85), (1, 85)):
            data = self.checkin()
            data["captured_at"] = (now - timedelta(hours=hours)).isoformat()
            for reading in data["readings"].values():
                reading["measured_at"] = data["captured_at"]
            data["readings"]["pulse_rate"]["value"] = pulse
            status, result = self.request("POST", "/api/checkins", data)
            self.assertEqual(status, 200)
            self.assertEqual(datetime.fromisoformat(result["assessed_at"]), now - timedelta(hours=hours))
        self.assertTrue(result["trend_available"])
        self.assertTrue(any(f["code"] == "trend_delta" and f["compared_value"] == 13 for f in result["rationale"]))


if __name__ == "__main__":
    unittest.main()
