# Release review — 15 November 2026

Reviewed repository: `AlpaganB/acha`, starting at `ae8039b`. This is an implementation review against the supplied ACHA context, not a clinical validation.

## Assessment

The repository has a working foundation: React/TypeScript, FastAPI, PostgreSQL migrations, deterministic Python assessment logic, persisted assessment snapshots, personal-history comparisons and follow-up records. The biggest submission risk is an unclear first-use story across three different execution modes. Preserve the architecture and concentrate the remaining time on one convincing crew workflow.

## Verified evidence

| Check | Result |
| --- | --- |
| Frontend dependency installation | `npm ci` succeeded |
| Production build | `npm run build` succeeded, including after the worker repair |
| Existing frontend suite | 22 tests passed |
| Added offline regression | 1 test passed; cached navigation covers public routes and excludes API/external requests |
| Backend | 69 tests and 9 subtests passed with PostgreSQL 15; fixture applies migrations and checks schema drift |
| Standalone engine/demo | 62 tests and 951 subtests passed when run from `demo/` |
| Browser scenario | Opened scenario, reviewed personal indicators, opened initial check-in and its follow-up section |
| Offline browser navigation after repair | `/`, `/monitoring`, `/measurements`, `/assessment`, `/assessments/scenario-check-in`, `/guides`, `/mission`, `/research`, `/crew` loaded |
| Browser errors and mobile width | No page exceptions during initial scenario inspection; at 390px, document width was 390px |
| Live public service | `https://acha.tr/`, crew roster and mission profiles returned HTTP 200; live overview loaded |

Offline route loading does not establish that every page operation works offline. Repeat-reading entry and follow-up completion were not exercised in this browser pass. Backend behavior is covered by the existing backend suite. Live records were not modified.

Reproduce:

```bash
cd frontend
npm ci
npm run build
node --experimental-strip-types --test test/*.test.mjs
```

```bash
cd backend
TEST_DATABASE_URL=postgresql+psycopg://acha:acha_dev@127.0.0.1:5432/acha python -m pytest -q
```

```bash
cd demo
python -m pytest -q
```

Browser inspection used Chromium against the production preview on port 4173, waited for service worker readiness, reloaded to ensure control, then disabled networking. Captures and inspection scripts are in `/workspace/acha-review/` in this workspace; these are local review artifacts, not submission assets.

## Findings in priority order

### P0 — Offline route failure: repaired locally

`frontend/service-worker.js` omitted `/monitoring` from navigation fallback routes. Reproduced `ERR_INTERNET_DISCONNECTED` when opening that page directly offline after shell installation. Added the route, rebuilt, verified nine routes offline, and added `frontend/test/offlineShell.test.mjs`. This change is not pushed or deployed.

### P0 — Make execution modes understandable

- Mission-service mode caches recent records and queues assessments; saving measurements requires a reachable service (`Measurements.tsx`, `useMission.ts`). The Python evaluation runs remotely in this mode.
- Browser scenario mode stores fictional records locally. Its `localScenario.ts` assessment explicitly uses `local-descriptive-1`, returns `demo_reviewed` and no NEWS2 score. It does not reproduce the Python symptom warning engine.
- Standalone demo runs the Python assessment engine on a local workstation and can work without an Earth connection. Losing that local server queues browser submissions instead of evaluating them immediately.

Do not demonstrate browser-only descriptive review as equivalent to local Python emergency assessment. The remaining offline-engine gap is architectural; changing it in six hours requires a tightly bounded design and medical-rule parity tests.

### P1 — First-use presentation obscures the working flow

The live selected crew member's overview showed no recent measurements and no assessments. The scenario is accessible via Crew monitoring rather than directly from the overview. When the service is unavailable, the overview offers retry but suppresses the synthetic-scenario action (`App.tsx`, `!home`).

Put a clearly labeled sample-scenario entry and one-sentence workflow explanation in the initial viewport. Keep fictional and mission-service records distinct. Avoid inserting unmarked sample readings into live crew histories.

### P1 — Visual hierarchy and mobile polish

The overview devotes most of the desktop viewport to rotating anatomy while actionable readings and recent check-ins sit below it. The 390px capture showed a large blank area inside the anatomy panel and a status badge wrapping "Demo reviewed" awkwardly. `anatomy.css` fixes the mobile stage at 900px. Keep the visual as supporting content and bring readings, changes, missing context and next action forward. Review all three anatomy states before changing heights; they share an absolutely positioned stage.

The four anatomy PNG assets total approximately 9.18 MB uncompressed on disk. All are part of the precached production shell. Optimize the source asset sizes and encoding while preserving transparency and checking visual quality; this improves first load and time to offline readiness. No image conversion was performed during this review.

### P1 — Submission documentation contains stale history

`demo/START_HERE.md` still says the team repository returned HTTP 404 and describes an earlier inability to use a browser or PostgreSQL. These statements describe past tooling conditions and should not be current setup guidance. Rewrite around the integrated repository and clearly distinguish current evidence from historical verification reports. Check README, START_HERE and SUBMISSION together before delivery.

### P2 — Reminder scope is incomplete in the public frontend

Mission schedules exist in API types, profile creation and detail display. No public frontend reminder execution or due-measurement workflow was found in the inspected source. Standalone-demo reminders should not be represented as a public-app capability. In the remaining time, a small last-reading/due summary is more realistic than a new background notification system.

## Six-hour work allocation

| Time | Deliverable | Acceptance |
| --- | --- | --- |
| 0:00–0:45 | Freeze one demo story and fix entry/empty states | Fresh browser reaches labeled scenario from overview in one action |
| 0:45–2:15 | Refine overview hierarchy and mobile anatomy/status layout | 390px and 1440px captures show usable readings/actions without excessive empty space |
| 2:15–3:00 | Optimize anatomy assets and show offline readiness accurately | Compare build asset sizes and first-load behavior; cached shell installs successfully |
| 3:00–4:15 | Rehearse complete check-in and follow-up with network loss | Save repeat reading, link it, close workflow, reload and verify persistence; document mode limits |
| 4:15–5:00 | Align setup, evidence, submission copy and screenshots | No stale environment claims; every capability claim names the applicable mode |
| 5:00–6:00 | Run checks, deploy intended revision and rehearse from clean storage | Production build/tests pass; verify deployed worker, direct-route reloads and offline guides |

Do not expand research pages, add an LLM, introduce new infrastructure or replace the backend during this pass. The strongest submission is a complete, legible gather → evaluate → act → follow-up demonstration with honest offline boundaries.
