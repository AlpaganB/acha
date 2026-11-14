import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pydantic import AwareDatetime, Field, StrictBool, model_validator

if __package__:
    from .assessment_models import Measurement, Metric, Schema
    from .health_assessment import AssessmentInput, evaluate_health_payload
else:
    from assessment_models import Measurement, Metric, Schema
    from health_assessment import AssessmentInput, evaluate_health_payload

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "mission_demo.json").read_text(encoding="utf-8"))
METRICS = CONFIG["metrics"]
PROFILES = CONFIG["profiles"]
SYMPTOMS = CONFIG["symptoms"]
GUIDES = CONFIG["guides"]
UNITS = {key: definition[1] for key, definition in METRICS.items()}


class CheckIn(Schema):
    id: uuid.UUID
    profile: str
    readings: dict[Metric, Measurement] = Field(default_factory=dict)
    failures: dict[Metric, str] = Field(default_factory=dict)
    symptoms: list[str]
    supplemental_oxygen: StrictBool | None = None
    captured_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def check_choices(self):
        if self.profile not in PROFILES:
            raise ValueError("Choose an available mission profile.")
        if set(self.symptoms) - SYMPTOMS.keys():
            raise ValueError("Unknown symptom code.")
        if self.readings.keys() & self.failures.keys():
            raise ValueError("A reading cannot also be marked unavailable.")
        enabled = set(profile_metrics(self.profile))
        if (self.readings.keys() | self.failures.keys()) - enabled:
            raise ValueError("Measurement is not available for the selected profile.")
        if any(reason not in {"equipment_unavailable", "unable_to_obtain"} for reason in self.failures.values()):
            raise ValueError("Unknown measurement failure reason.")
        for key, reading in self.readings.items():
            _, unit, lower, upper, step, _, _ = METRICS[key]
            if reading.unit != unit or not lower <= reading.value <= upper:
                raise ValueError(f"{key} must be within the demo instrument range in {unit}.")
            if (step == 1 and not reading.value.is_integer()) or (step == 0.1 and round(reading.value, 1) != reading.value):
                raise ValueError(f"Use the configured precision for {key}.")
        systolic = self.readings.get("systolic_bp")
        diastolic = self.readings.get("diastolic_bp")
        if systolic and diastolic and diastolic.value >= systolic.value:
            raise ValueError("Check the blood pressure pair. The upper value must exceed the lower value.")
        return self


def profile_metrics(profile):
    return [key for key in METRICS if PROFILES[profile]["has_cuff"] or key not in {"systolic_bp", "diastolic_bp"}]


def action(status, protocol):
    text = "Open the crew emergency guide now." if status == "urgent" else "Review this check-in with the crew medical officer."
    return {"status": status, "protocol_id": protocol, "next_step": text}


def rules_for(profile, history_available):
    review = action("review", "DEMO-REVIEW")
    return {
        "profile_version": PROFILES[profile]["version"],
        "news2": {"max_age_seconds": 300, "max_spread_seconds": 120, "oxygen_scale": 1,
                  "review_protocol_id": "DEMO-REVIEW", "urgent_protocol_id": "DEMO-URGENT",
                  "emergency_protocol_id": "DEMO-URGENT"},
        "metrics": {key: {"max_age_minutes": 5, "valid_min": METRICS[key][2],
                          "valid_max": METRICS[key][3],
                          "baseline_delta": {"lower": {"value": -8, "action": review, "rule_id": "demo-pulse-baseline"},
                                             "upper": {"value": 8, "action": review, "rule_id": "demo-pulse-baseline"}},
                          "trend": {"window_minutes": PROFILES[profile]["interval_hours"] * 60,
                                    "delta": {"upper": {"value": 6, "action": review, "rule_id": "demo-pulse-trend"},
                                              "lower": {"value": -6, "action": review, "rule_id": "demo-pulse-trend"}}} if history_available else None}
                    for key in ["pulse_rate"]},
        "symptoms": {"chest_pain": action("urgent", "DEMO-CHEST"),
                     "breathing_difficulty": action("urgent", "DEMO-BREATHING"),
                     "unresponsive": action("urgent", "DEMO-UNRESPONSIVE"),
                     "new_confusion": action("urgent", "DEMO-URGENT"),
                     "dizziness": review, "fatigue": review},
    }


class Store:
    def __init__(self, path):
        self.path = str(path)
        self.postgres = self.path.startswith(("postgres://", "postgresql://"))
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS checkins (id text PRIMARY KEY, payload text NOT NULL, result text NOT NULL, synced integer NOT NULL DEFAULT 0)")
            db.execute("CREATE TABLE IF NOT EXISTS ground_inbox (id text PRIMARY KEY, record text NOT NULL)")

    @contextmanager
    def connect(self):
        if self.postgres:
            import psycopg
            with psycopg.connect(self.path) as db:
                yield db
            return
        db = sqlite3.connect(self.path)
        try:
            with db:
                yield db
        finally:
            db.close()

    def query(self, db, sql, args=()):
        return db.execute(sql.replace("?", "%s") if self.postgres else sql, args)

    def rows(self, db):
        return [{"payload": json.loads(payload), "result": json.loads(result), "synced": bool(synced)}
                for payload, result, synced in db.execute("SELECT payload,result,synced FROM checkins").fetchall()]

    def snapshot(self):
        with self.connect() as db:
            return sorted(self.rows(db), key=lambda row: row["result"]["assessed_at"], reverse=True)

    def assess(self, body):
        checkin = CheckIn.model_validate(body)
        payload = checkin.model_dump(mode="json")
        ident = payload["id"]
        with self.connect() as db:
            existing = self.query(db, "SELECT payload,result FROM checkins WHERE id=?", (ident,)).fetchone()
            if existing:
                if json.loads(existing[0]) != payload:
                    raise ValueError("This assessment ID already belongs to a different check-in.")
                return json.loads(existing[1])
            received_at = datetime.now(timezone.utc)
            captured_at = checkin.captured_at or received_at
            if captured_at > received_at + timedelta(seconds=5):
                raise ValueError("The check-in time is ahead of the onboard clock.")
            stamped = captured_at.astimezone(timezone.utc).isoformat()
            history = []
            window = timedelta(hours=PROFILES[checkin.profile]["interval_hours"])
            anchor = checkin.readings.get("pulse_rate")
            buckets = [set(), set()]
            if anchor is not None:
                buckets[0].add(anchor.measured_at)
                for (record,) in db.execute("SELECT payload FROM checkins").fetchall():
                    previous = json.loads(record)
                    reading = previous["readings"].get("pulse_rate")
                    if previous["profile"] != checkin.profile or not reading:
                        continue
                    timestamp = datetime.fromisoformat(reading["measured_at"].replace("Z", "+00:00"))
                    age = anchor.measured_at - timestamp
                    if timedelta(0) <= age < 2 * window:
                        history.append(reading)
                        if reading["quality"] == "accepted":
                            buckets[int(age >= window)].add(timestamp)
            # The demonstration baseline is an explicitly seeded pre-mission reference.
            assessment = {
                "assessed_at": stamped, "current": {k: v for k, v in payload["readings"].items() if k != "diastolic_bp"},
                "baselines": {"pulse_rate": METRICS["pulse_rate"][5]}, "history": {"pulse_rate": history},
                "measurement_failures": {k: {"measured_at": stamped, "reason": v}
                                         for k, v in checkin.failures.items() if k != "diastolic_bp"},
                "news2_context": {"measured_at": stamped, "age_years": 35, "pregnant": False,
                                  "consciousness": "unresponsive" if "unresponsive" in checkin.symptoms else
                                  "new_confusion" if "new_confusion" in checkin.symptoms else "alert",
                                  "supplemental_oxygen": checkin.supplemental_oxygen},
                "symptoms": checkin.symptoms,
            }
            rules = rules_for(checkin.profile, min(map(len, buckets)) >= 2)
            result = evaluate_health_payload(assessment, rules)
            result["trend_available"] = rules["metrics"]["pulse_rate"]["trend"] is not None
            result["id"] = ident
            result["guide"] = GUIDES.get(result["protocol_id"])
            result["input_snapshot"] = assessment
            result["profile_snapshot"] = rules
            inserted = self.query(db, "INSERT INTO checkins (id,payload,result) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",
                                  (ident, json.dumps(payload), json.dumps(result)))
            if inserted.rowcount == 0:
                saved = self.query(db, "SELECT payload,result FROM checkins WHERE id=?", (ident,)).fetchone()
                if json.loads(saved[0]) != payload:
                    raise ValueError("This assessment ID already belongs to a different check-in.")
                return json.loads(saved[1])
            return result

    def synchronize(self):
        # The demo receiver is a separate logical inbox on the same workstation.
        with self.connect() as db:
            rows = [row for row in self.rows(db) if not row["synced"]]
            for row in rows:
                ident = row["payload"]["id"]
                self.query(db, "INSERT INTO ground_inbox (id,record) VALUES (?,?) ON CONFLICT(id) DO NOTHING",
                           (ident, json.dumps(row)))
                self.query(db, "UPDATE checkins SET synced=1 WHERE id=?", (ident,))
            return {"acknowledged": len(rows), "total_received": db.execute(
                "SELECT count(*) FROM ground_inbox").fetchone()[0]}


def database():
    return Store(os.environ.get("ACHA_DATABASE_URL") or ROOT / "crew-demo.sqlite3")
