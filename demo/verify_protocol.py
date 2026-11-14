"""Verify complete chart combinations and replay the available real records."""
import csv
import hashlib
import itertools
import json
import math
import time
from pathlib import Path

from health_assessment import evaluate_health_payload
from news2 import score_parameter
from test_news2 import CONFIG, NORMAL, payload, reference_score, reference_trigger
from validate_engine import replay_real_record

ROOT = Path(__file__).resolve().parent


def complete_combinations():
    representatives = {"respiratory_rate": (8, 9, 12, 21, 25),
        "spo2": (91, 92, 94, 96), "systolic_bp": (90, 91, 101, 111, 220),
        "pulse_rate": (40, 41, 51, 91, 111, 131), "temperature": (35.0, 35.1, 36.1, 38.1, 39.1)}
    consciousness_values = ("alert", "new_confusion", "voice", "pain", "unresponsive")
    counts = {}
    for scale in (1, 2):
        config = {"news2": {**CONFIG, "oxygen_scale": scale}}
        if scale == 2:
            config["news2"]["scale2_authorization"] = "SYNTHETIC-TEST-ONLY"
            representatives["spo2"] = (83, 84, 86, 88, 93, 95, 97)
        count = 0
        data = payload()
        for values in itertools.product(*representatives.values(), consciousness_values, (False, True)):
            numeric = dict(zip(representatives, values[:5]))
            consciousness, oxygen = values[5:]
            for metric, value in numeric.items():
                data["current"][metric]["value"] = value
            data["news2_context"].update(consciousness=consciousness, supplemental_oxygen=oxygen)
            expected_scores = {metric: reference_score(metric, value, scale, oxygen)
                               for metric, value in numeric.items()}
            expected_scores.update(consciousness=0 if consciousness == "alert" else 3,
                                   supplemental_oxygen=2 if oxygen else 0)
            result = evaluate_health_payload(data, config)
            news = result["news2"]
            expected_trigger = reference_trigger(list(expected_scores.values()))
            expected_status = {"routine": "no_flags", "low": "review", "single_red": "urgent",
                               "medium": "urgent", "high": "urgent"}[expected_trigger]
            assert news["complete"]
            assert news["total_score"] == sum(expected_scores.values())
            assert news["trigger"] == expected_trigger
            assert result["status"] == expected_status
            assert {c["parameter"]: c["score"] for c in news["components"]} == expected_scores
            count += 1
        counts[f"scale_{scale}"] = count
    return {"cases": counts, "mismatches": 0}


def real_records():
    records = [ROOT / "bidmc_01_Numerics.csv", *sorted((ROOT / "data").glob("*_Numerics.csv"))]
    reports = []
    chart_checks = 0
    missing_components = 0
    for path in records:
        replay = replay_real_record(path)
        with path.open() as file:
            rows = list(csv.DictReader(file, skipinitialspace=True))
        assert len(rows) == 481
        assert [int(row["Time [s]"]) for row in rows] == list(range(481))
        for row in rows:
            for metric, column in (("pulse_rate", "PULSE"), ("respiratory_rate", "RESP"), ("spo2", "SpO2")):
                value = float(row[column])
                if not math.isfinite(value):
                    missing_components += 1
                    continue
                assert value.is_integer(), (path.name, metric, value)
                for scale, oxygen in ((1, False), (2, False), (2, True)) if metric == "spo2" else ((1, False),):
                    assert score_parameter(metric, value, scale, oxygen) == reference_score(metric, value, scale, oxygen)
                    chart_checks += 1
        reports.append(replay)
    return {"records": reports, "chart_component_checks": chart_checks,
            "missing_chart_components": missing_components, "mismatches": 0,
            "clinical_outcomes_evaluated": False}


if __name__ == "__main__":
    started = time.perf_counter()
    report = {"complete_chart_combinations": complete_combinations(), "real_records": real_records()}
    report["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    (ROOT / "protocol_verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
