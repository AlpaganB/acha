# ACHA assessment engine 0.3

The backend calls `evaluate_health_payload(payload, mission_rules)` and receives a JSON-compatible dictionary. Runtime requirements are Python 3.10+ and Pydantic 2. The verified environment used Python 3.14.6 and Pydantic 2.13.4.

```python
from health_assessment import evaluate_health_payload
from example_usage import ASSESSMENT, MISSION_RULES

result = evaluate_health_payload(ASSESSMENT, MISSION_RULES)
assert result["news2"]["total_score"] == 0
```

Keep `health_assessment.py`, `assessment_models.py`, and `news2.py` on the same Python import path. `example_usage.py` supplies four executable synthetic scenarios. Its DEMO protocol IDs and timing settings are integration placeholders.

## Backend contract

| Input field | Meaning |
| --- | --- |
| assessed_at | Assessment time with timezone. |
| current | Latest readings by metric, with value, measured_at, unit and quality. |
| baselines | Personal reference values in canonical units. |
| history | Timestamped readings by metric for trends. |
| symptoms | Reported questionnaire codes. Empty means none reported. Null means unanswered. |
| news2_context | Time, age, pregnancy status, consciousness and supplemental oxygen. |
| measurement_failures | Timestamped events with equipment_unavailable or unable_to_obtain as the reason. |

| Metric | Unit |
| --- | --- |
| heart_rate, pulse_rate | bpm |
| respiratory_rate | breaths/min |
| spo2 | %, on the 0–100 scale |
| systolic_bp, diastolic_bp | mmHg |
| temperature | C |

NEWS2 requires pulse_rate. There is no automatic substitution of ECG heart rate for pulse rate. Convert units in the acquisition layer. A suspect quality flag excludes a reading. Omitted quality retains the original accepted-quality assumption.

The original response fields remain status, rationale, next_step and protocol_id. Additional fields are news2, engine_version, profile_version, profile_hash and assessed_at. Numeric findings include observations, references, timestamps, units, comparisons and threshold semantics. Optional rule_id and source values propagate from custom limits. NEWS2 returns its source, rule version and component scores.

Store the request, profile and result together. The profile hash is SHA-256 of the canonical validated configuration. It identifies content and provides no authenticity guarantee. Load profiles from trusted backend configuration. Scale 2 requires a reference to a documented clinician decision in the patient's configuration.

The typed entry point `evaluate_health(AssessmentInput, MissionProfile)` remains available. The dictionary entry point validates untrusted data and raises Pydantic ValidationError for invalid structure. Semantic data-quality issues become findings. JSON cannot represent NaN. Acquisition adapters should represent unavailable readings as missing data or a timestamped failure.

## NEWS2 behavior

Enable NEWS2 through the profile's news2 field. It can run alongside custom rules. Both oxygen scales and all seven score components are supported. The implemented population scope is age 16 or older with pregnancy explicitly false. Unknown applicability produces an incomplete result. Astronaut clinical validity remains unmeasured.

NEWS2 requires explicit units, whole-number rates/pressure/saturation and temperature at one decimal place or less. Ambiguous precision is flagged for acquisition-side resolution without implicit rounding. This preserves the chart's discrete boundaries.

max_age_seconds and max_spread_seconds are required application settings. They control freshness and temporal consistency. Their mission values require project agreement.

Complete observations return complete=true, total_score and trigger. Incomplete observations retain partial_score and issues with total_score=null. Known partial scores can trigger escalation. Inconsistent timestamps block aggregate triggers while retaining an individual three-point trigger.

The published trigger category remains inside news2. The application maps low nonzero scores to review and single-red, medium and high to urgent. High uses the emergency protocol ID. Configured urgent symptoms remain visible even with zero NEWS2. Render all relevant findings.

Failure to obtain a NEWS2 reading despite equipment use generates immediate-review guidance. A newer valid, accepted reading supersedes that failure. Suspect or invalid replacements keep it unresolved. Equipment unavailability yields an incomplete assessment. Failure events also prevent custom rules from reusing superseded readings.

## Custom rules

absolute compares a reading with configured limits. baseline_delta compares current minus baseline. additional_absolute supports multiple review/urgent bands. Limits carry value, action, optional inclusive, rule_id and source. Default comparisons are strict. inclusive=true includes equality. Device valid_min and valid_max are separate inclusive input bounds.

Trend calculation compares medians in adjacent windows anchored at the current reading. For window length W, recent ages are [0, W) and previous ages are [W, 2W). Each needs enough distinct timestamps. Identical duplicates count once. Invalid or conflicting samples block the trend. Error precedence is independent of history order. Future and out-of-window readings are excluded.

Statuses prioritize urgent, review, insufficient_data and no_flags. Within equal status, protocol-bearing findings come first. Remaining ties preserve failure, NEWS2, symptom and numeric-rule evaluation order. no_flags means no configured alert was triggered.

Baselines and trend settings require an appropriate measurement protocol. Baseline age, variability and reliability are currently the caller's responsibility. Legacy custom readings without explicit units assume canonical units.

## Verification

```bash
python -m pip install "pydantic>=2,<3" numpy coverage
python -m unittest -v
python verify_protocol.py
python validate_engine.py
python verify_mutations.py
python benchmark_workloads.py
python example_usage.py
```

NumPy and coverage are verification dependencies. Mutation checks write temporary code copies beside the package under mutation_runs. The optional previous-version benchmark runs when the original baseline snapshot is present locally.

See the [verification report](VALIDATION.md), [BIDMC data attribution](DATA_SOURCE.md) and [NEWS2 source notes](NEWS2_SOURCES.md). The Python engine is used by both the [connected mission API](../backend) and the [standalone onboard demo](START_HERE.md).
