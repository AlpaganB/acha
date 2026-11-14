"""Check whether regression tests detect specific injected implementation faults."""
import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MUTATIONS = [
    ("respiratory_boundary", "news2.py", "((8, 11, 20, 24)", "((9, 11, 20, 24)"),
    ("spo2_boundary", "news2.py", "((91, 93, 95)", "((91, 93, 96)"),
    ("temperature_boundary", "news2.py", "((35.0, 36.0, 38.0, 39.0)", "((35.0, 36.0, 38.1, 39.0)"),
    ("emergency_threshold", "news2.py", "if total >= 7:", "if total >= 8:"),
    ("urgent_threshold", "news2.py", "if total >= 5:", "if total >= 6:"),
    ("single_red", "news2.py", "if 3 in scores:", "if 4 in scores:"),
    ("scale2_oxygen", "news2.py", "if supplemental_oxygen:", "if not supplemental_oxygen:"),
    ("oxygen_points", "news2.py", "(2 if value else 0)", "(0 if value else 0)"),
    ("missing_total", "news2.py", "total_score=sum(scores) if complete else None", "total_score=sum(scores)"),
    ("timestamp_boundary", "news2.py", "if age > config.max_age_seconds:", "if age >= config.max_age_seconds:"),
    ("unit_check", "news2.py", "if reading.unit != UNITS[parameter]:", "if False:"),
    ("scope_check", "news2.py", "context.age_years < 16 or context.pregnant", "context.age_years < 15 or context.pregnant"),
    ("urgent_precedence", "health_assessment.py", 'priority = {"urgent": 0, "review": 1, "insufficient_data": 2}',
     'priority = {"urgent": 2, "review": 1, "insufficient_data": 0}'),
]


if __name__ == "__main__":
    run_root = ROOT.parent / "mutation_runs" / uuid.uuid4().hex
    run_root.mkdir(parents=True)
    results = []
    for name, target, original, replacement in MUTATIONS:
        destination = run_root / name
        destination.mkdir()
        for source in ROOT.glob("*.py"):
            shutil.copyfile(source, destination / source.name)
        path = destination / target
        text = path.read_text(encoding="utf-8")
        assert text.count(original) == 1, name
        path.write_text(text.replace(original, replacement), encoding="utf-8")
        process = subprocess.run([sys.executable, "-m", "unittest", "discover", "-q"],
                                 cwd=destination, capture_output=True, text=True, timeout=60)
        output = process.stdout + process.stderr
        detected = process.returncode == 1 and "FAIL:" in output and "ERROR:" not in output
        results.append({"mutation": name, "detected_by_assertion": detected})
        if not detected:
            print(name, output)
    report = {"mutations": results, "detected": sum(r["detected_by_assertion"] for r in results),
              "total": len(results)}
    (ROOT / "mutation_results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if report["detected"] != report["total"]:
        raise SystemExit(1)
