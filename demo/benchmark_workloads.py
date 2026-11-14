"""Measure current-version JSON entry-point costs for two explicit workloads."""
import json
import random
import time
from datetime import timedelta
from pathlib import Path

import numpy as np

from example_usage import ASSESSMENT, MISSION_RULES
from health_assessment import ENGINE_VERSION, evaluate_health_payload
from test_health_assessment import NOW, REVIEW


def measure(operation, repeats):
    operation()
    samples = []
    for _ in range(repeats):
        start = time.perf_counter_ns()
        operation()
        samples.append((time.perf_counter_ns() - start) / 1e6)
    return {"median_ms": float(np.median(samples)), "p95_ms": float(np.percentile(samples, 95)),
            "repeats": repeats}


if __name__ == "__main__":
    rng = random.Random(4731)
    dense = {"assessed_at": NOW.isoformat(), "current": {
        "heart_rate": {"value": 80, "measured_at": NOW.isoformat()}}, "symptoms": [],
        "history": {"heart_rate": [
            {"value": rng.uniform(60, 100), "measured_at": (NOW - timedelta(microseconds=index * 1000)).isoformat()}
            for index in range(1, 100001)]}}
    config = {"metrics": {"heart_rate": {"max_age_minutes": 1,
        "trend": {"window_minutes": 1, "delta": {"upper": {"value": 10, "action": REVIEW}}}}}}
    report = {"engine_version": ENGINE_VERSION,
              "single_news2_json": measure(lambda: evaluate_health_payload(ASSESSMENT, MISSION_RULES), 1000),
              "sequential_20_news2_json": measure(
                  lambda: [evaluate_health_payload(ASSESSMENT, MISSION_RULES) for _ in range(20)], 100),
              "dense_100000_trend_json": measure(lambda: evaluate_health_payload(dense, config), 10),
              "includes": ["Pydantic input validation", "rule evaluation", "profile hashing", "JSON-ready response"],
              "excludes": ["HTTP", "database", "network", "concurrent server load"]}
    assert report["single_news2_json"]["p95_ms"] < 10, "Local NEWS2 latency target exceeded."
    assert report["dense_100000_trend_json"]["p95_ms"] < 1000, "Local dense-history target exceeded."
    (Path(__file__).resolve().parent / "workload_results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
