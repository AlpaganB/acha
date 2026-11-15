# ACHA 0.3 verification and two-day acceptance plan

## Current evidence

The 15 November competition candidate adds deterministic replay and inline local follow-up to the React app. Its separate [release verification](../docs/competition-release.md#verification-and-reproduction) covers browser persistence and no mission API writes during training. This report describes the standalone Python engine and its historical reference comparisons.

The implemented score arithmetic and application behavior have been tested. Clinical sensitivity, specificity, false-alert rates and astronaut suitability remain unmeasured. Both the production score implementation and the separately transcribed reference were prepared in this development effort. External clinical review is still required for clinical acceptance.

| Target | Evidence | Outcome |
| --- | --- | --- |
| Published score arithmetic matches the reference | 30,000 Scale 1 and 52,500 Scale 2 complete combinations through the JSON entry point | Zero mismatches |
| All chosen discrete values and trigger vectors behave consistently | 1,137 component comparisons and 8,192 score vectors in the unit suite | Passed |
| Missing inputs never create a complete zero score | All 128 missing-field combinations | Passed |
| Real observations are processed consistently | 10 BIDMC records, 4,810 rows, 9,620 HR/SpO2 trend and availability checks | Zero mismatches |
| Available chart components match the reference | 23,974 arithmetic comparisons including both oxygen scales | Zero mismatches |
| Trend calculations are independent of input ordering | 10,000 seeded cases plus invalid/conflicting-record permutations | Passed |
| Limits and personal deviations match expected arithmetic | 10,004 seeded and exact-boundary cases | Zero mismatches |
| Known implementation faults are detectable | Thirteen deliberate code mutations | All detected by failed assertions |
| Regression suite exercises production logic | 57 test methods, 369 statements and 156 branches across three production modules | All tests passed, all reported statements and branches exercised |
| Backend method is directly usable | Four synthetic examples through evaluate_health_payload | Passed |
| Local evaluation meets stated timing budgets | NEWS2 JSON entry p95 below 10 ms, dense 100,000-record JSON entry p95 below 1,000 ms | Passed on the test machine |

The component and combination counts are software comparisons. They are not counts of independently diagnosed patients. Code coverage describes execution of code paths and gives no clinical accuracy percentage.

## Reproducible evidence

- protocol_verification.json records complete-combination results, per-record replay counts and CSV hashes.
- validation_results.json records seeded numerical comparisons and long-history performance.
- mutation_results.json records the specific faults injected and detected.
- coverage_results.json records statement and branch coverage.
- workload_results.json records JSON entry-point timings.
- DATA_SOURCE.md documents extraction, attribution and sampling limits.
- NEWS2_SOURCES.md maps implemented behavior to primary sources.

The BIDMC sample uses the first ten records from a 53-record dataset. They are short hospital recordings. There are 19 unavailable HR/SpO2 readings in the trend replay and 38 unavailable pulse/respiration/SpO2 components. Missing values were excluded explicitly. Complete NEWS2 patient scores were not inferred from these incomplete records. No outcome labels were available for evaluating ACHA alert correctness.

Published component values and source rules were checked before implementation. The reference tests use an interval implementation while production uses ordered boundaries. This reduces shared implementation errors but retains the possibility of a shared interpretation error. A qualified reviewer should verify the source-to-code mapping.

## Engineering fixes in this revision

- Added optional NEWS2 scoring to the existing assessment entry point, including both oxygen scales, component explanations, incomplete scores and single-parameter escalation.
- Added explicit observation units, source precision checks, context completeness and timestamp-spread controls for NEWS2.
- Added failure events and correct supersession by newer accepted measurements. A suspect replacement cannot clear an unresolved failed measurement.
- Made invalid/conflicting history error precedence independent of record order.
- Added multiple severity bands, inclusive limit comparisons and rule provenance for configurable checks.
- Added engine version, profile version and a configuration hash to results.

The demonstration age/spread settings are engineering choices. Their values require mission-specific agreement. Scale 2 authorization is a trusted input reference whose clinical authenticity is outside the engine.

## Performance interpretation

The current JSON workload benchmark includes parsing, rule evaluation, configuration hashing and JSON-compatible output. The dense history test places every history observation within the two-window lookback, at distinct timestamps. Timing excludes HTTP, database queries, network access and concurrent server load.

The trend algorithm scans n input records and sorts the k retained values for medians. Its time complexity is O(n + k log k), with O(k) auxiliary memory. Constant lookback calculations are outside the scan loop. Input validation remains a major cost for large JSON payloads.

Previous-version comparisons use the original snapshot when available. Additional checks and provenance carry an overhead. Latest parse-plus-evaluation results do not establish a universal end-to-end speedup. Current measured timings are recorded without suppressing slower cases.

## Two-day acceptance plan

The time blocks are planning windows from development start, with completion judged by evidence.

| Window | Work | Acceptance criterion | Current state |
| --- | --- | --- | --- |
| Day 1, first block | Freeze algorithm contract with Emirhan and Alpagan | Request, response, units, supported population, timing settings and protocol ownership agreed | Draft contract and executable examples ready, team agreement pending |
| Day 1, middle block | Verify source rules and deterministic engine | Exact boundary behavior, component explanations and all complete band combinations checked | Implemented and tested, external content review pending |
| Day 1, final block | Integrate backend and persist assessment evidence | Actual API accepts examples, saves input/profile/result and handles malformed or missing data | Repository access required |
| Day 2, first block | Exercise real data and failure workflows in the application | All measured failures remain visible, confirmed urgent findings survive unrelated missing data | Python tests passed, application scenarios pending |
| Day 2, middle block | Verify mission/offline behavior and cross-runtime parity | Same captured inputs and profile give the same result offline and online | Python runs offline, browser parity pending |
| Day 2, final block | Freeze and demonstrate | Reviewed rule version, reproducible demo, passing integration suite, published limitations and representative load results | Package prepared for integration |

## Remaining limits

The module accepts personal baselines as numbers. Their age, measurement context, sample count and reliability are the caller's responsibility. Custom trend deltas are configurable and require their own evidence. Symptom combinations and branching questionnaires need an agreed protocol.

Explicit units help detect formatting errors, but cannot prove sensor calibration or identify every mislabeled value. Generic measurement validity rules are supplemented by device-specific bounds. Pregnancy and age scope are explicit. Special patient circumstances and clinician concern still require assessment independent of the score.

The GitHub repository returned 404 in this session. Its actual models and conventions could not be reviewed. FastAPI is absent from the local runtime, so HTTP integration is unverified. The Python engine runs locally without network access. Client-side React execution remains unimplemented.

Clinical approval needs representative labeled cases, independent content review and mission-specific evaluation. The current release is a research prototype with verified arithmetic and documented engineering limits.

## Current JSON entry-point latency

| Workload | Median ms | p95 ms | Repetitions |
| --- | --- | --- | --- |
| single_news2_json | 0.091 | 0.107 | 1000 |
| sequential_20_news2_json | 1.829 | 2.186 | 100 |
| dense_100000_trend_json | 370.744 | 399.499 | 10 |
