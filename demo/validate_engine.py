"""Reproducible numerical checks using NumPy as an independent oracle."""
import csv
import hashlib
import importlib.util
import json
import math
import platform
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pydantic

import health_assessment as engine

ROOT = Path(__file__).resolve().parent
NOW = datetime(2026, 11, 14, tzinfo=timezone.utc)
ACTION = {"status": "review", "next_step": "Synthetic numerical test."}
PROFILE = engine.MissionProfile.model_validate({"metrics": {
    metric: {"max_age_minutes": 1, "trend": {
        "window_minutes": 1, "min_samples_per_window": 2,
        "delta": {"lower": {"value": -1, "action": ACTION},
                  "upper": {"value": 1, "action": ACTION}},
    }} for metric in ("heart_rate", "spo2")
}})


def expected_delta(times, values, anchor):
    times = np.asarray(times)
    values = np.asarray(values)
    recent = values[(times > anchor - 60) & (times <= anchor)]
    previous = values[(times > anchor - 120) & (times <= anchor - 60)]
    if min(len(recent), len(previous)) < 2:
        return None
    return float(np.median(recent) - np.median(previous))


def check_result(result, metric, expected):
    findings = [finding for finding in result.rationale if finding.metric == metric]
    if expected is None:
        assert [finding.code for finding in findings] == ["missing_trend_history"]
    elif abs(expected) > 1:
        assert len(findings) == 1 and findings[0].code == "trend_delta"
        assert math.isclose(findings[0].compared_value, expected, abs_tol=1e-10)
    else:
        assert not findings


def replay_real_record(path=None):
    path = path or ROOT / "bidmc_01_Numerics.csv"
    with path.open() as source:
        rows = list(csv.DictReader(source, skipinitialspace=True))
    history = {metric: [] for metric in PROFILE.metrics}
    times = {metric: [] for metric in PROFILE.metrics}
    values = {metric: [] for metric in PROFILE.metrics}
    missing = 0
    checks = 0
    for row in rows:
        second = int(row["Time [s]"])
        timestamp = NOW + timedelta(seconds=second)
        current = {}
        for metric, column in (("heart_rate", "HR"), ("spo2", "SpO2")):
            value = float(row[column])
            if math.isfinite(value):
                current[metric] = engine.Measurement(value=value, measured_at=timestamp)
                history[metric].append(current[metric])
                times[metric].append(second)
                values[metric].append(value)
            else:
                missing += 1
        data = engine.AssessmentInput(assessed_at=timestamp, current=current, history=history, symptoms=[])
        result = engine.evaluate_health(data, PROFILE)
        for metric in PROFILE.metrics:
            if metric in current:
                check_result(result, metric, expected_delta(times[metric], values[metric], second))
            else:
                assert any(f.code == "missing_measurement" and f.metric == metric for f in result.rationale)
            checks += 1
    return {"record": path.stem, "rows": len(rows), "metric_checks": checks,
            "missing_readings": missing, "mismatches": 0,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def randomized_checks(count=10000):
    rng = random.Random(4729)
    rules = PROFILE.metrics["heart_rate"].trend
    for _ in range(count):
        seconds = rng.sample(range(-180, 30), rng.randint(0, 120))
        seconds = sorted(set(seconds) | {0})
        values = [rng.uniform(40, 160) for _ in seconds]
        samples = [engine.Measurement(value=value, measured_at=NOW + timedelta(seconds=second))
                   for second, value in zip(seconds, values)]
        current = samples[seconds.index(0)]
        shuffled = samples.copy()
        rng.shuffle(shuffled)
        expected = expected_delta(seconds, values, 0)
        actual = engine._trend_comparison(shuffled, current, rules)
        if expected is None:
            assert actual == "missing_trend_history"
        else:
            assert math.isclose(actual[0] - actual[1], expected, abs_tol=1e-10)
    return {"seed": 4729, "cases": count, "mismatches": 0}


def threshold_checks(count=10000):
    rng = random.Random(4730)
    profile = engine.MissionProfile.model_validate({"metrics": {"heart_rate": {
        "max_age_minutes": 1,
        "absolute": {"lower": {"value": 60, "action": ACTION},
                     "upper": {"value": 100, "action": ACTION}},
        "baseline_delta": {"lower": {"value": -10, "action": ACTION},
                           "upper": {"value": 10, "action": ACTION}},
    }}})
    cases = [(rng.uniform(0, 250), rng.uniform(40, 120)) for _ in range(count)]
    cases.extend((value, 80) for value in (60, 100, 70, 90))
    for value, baseline in cases:
        data = engine.AssessmentInput(assessed_at=NOW,
            current={"heart_rate": engine.Measurement(value=value, measured_at=NOW)},
            baselines={"heart_rate": baseline}, symptoms=[])
        before = data.model_dump_json()
        result = engine.evaluate_health(data, profile)
        expected = []
        if not 60 <= value <= 100:
            expected.append("absolute_limit")
        if not -10 <= value - baseline <= 10:
            expected.append("baseline_delta")
        assert [f.code for f in result.rationale] == expected
        assert result.status == ("review" if expected else "no_flags")
        assert before == data.model_dump_json()
        assert result == engine.evaluate_health(data, profile)
    return {"seed": 4730, "cases": len(cases), "mismatches": 0}


def benchmark():
    previous_path = ROOT.parent / "health_assessment_before.py"
    modules = {"current": engine}
    if previous_path.exists():
        spec = importlib.util.spec_from_file_location("previous_engine", previous_path)
        previous = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = previous
        spec.loader.exec_module(previous)
        modules["previous"] = previous
    results = {}
    for size, repeats in ((100, 40), (10000, 20), (100000, 10)):
        payload = {"assessed_at": NOW, "current": {"heart_rate": {
            "value": 80, "measured_at": NOW}}, "symptoms": [], "history": {"heart_rate": [
                {"value": 80 + index % 3, "measured_at": NOW - timedelta(seconds=index)}
                for index in range(size)]}}
        config = {"metrics": {"heart_rate": {"max_age_minutes": 1, "trend": {
            "window_minutes": 1, "min_samples_per_window": 2,
            "delta": {"lower": {"value": -1, "action": ACTION},
                      "upper": {"value": 1, "action": ACTION}}}}}}
        config["metrics"]["heart_rate"].pop("valid_min", None)
        config["metrics"]["heart_rate"].pop("valid_max", None)
        results[str(size)] = {}
        for name, module in modules.items():
            profile = module.MissionProfile.model_validate(config)
            data = module.AssessmentInput.model_validate(payload)
            elapsed = []
            for _ in range(repeats):
                start = time.perf_counter_ns()
                module.evaluate_health(data, profile)
                elapsed.append((time.perf_counter_ns() - start) / 1e6)
            combined = []
            for _ in range(5):
                start = time.perf_counter_ns()
                parsed = module.AssessmentInput.model_validate(payload)
                module.evaluate_health(parsed, profile)
                combined.append((time.perf_counter_ns() - start) / 1e6)
            results[str(size)][name] = {
                "evaluate_median_ms": float(np.median(elapsed)),
                "evaluate_p95_ms": float(np.percentile(elapsed, 95)),
                "parse_and_evaluate_median_ms": float(np.median(combined)),
                "repeats": repeats,
            }
    return results


if __name__ == "__main__":
    report = {"engine_version": engine.ENGINE_VERSION,
              "python": platform.python_version(), "pydantic": pydantic.__version__,
              "numpy": np.__version__, "real_data": replay_real_record(),
              "randomized": randomized_checks(), "threshold_checks": threshold_checks(),
              "performance": benchmark()}
    (ROOT / "validation_results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
