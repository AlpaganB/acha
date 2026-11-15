# ACHA competition release handoff

15 November 2026. The local release candidate is on `codex/mission-health-command-center`. Open the Overview and choose **Try a 90-second training scenario**. For a clean launch at the pulse review, open `/?scenario=lunar-fatigue&step=3` on the candidate preview. [Judge script and draft submission](../demo/SUBMISSION.md)

## Submission checklist

| Status | Requirement and evidence |
| --- | --- |
| Verified | Official challenge: Create Health Monitoring Software for Astronauts on Space Missions. It asks for software to gather indicators and support evaluation and action. ACHA demonstrates recorded observations, an explained review item, and a documented repeat. The challenge’s separate Resources tab was inaccessible during verification. [Challenge details](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/) |
| Verified | Global portal closes on Sunday, **15 November 2026 at 23:59 in the applicable local event time**. The event site directs teams to their **Project** tab and lists a maximum of six members. [Official schedule and instructions](https://www.spaceappschallenge.org/2026/) |
| Team action | Confirm every member’s registration, assigned event, team count and any earlier local submission or presentation deadline. The workspace time zone is Europe/Istanbul. It does not identify the registered event. If registered in Istanbul, check the event communications and confirm the judging schedule with the local lead. [Istanbul event page](https://www.spaceappschallenge.org/2026/local-events/istanbul/) |
| Team action | Open the authenticated Team → **Project** tab, confirm the required fields, demo format and length, link access and AI disclosure. Use the draft summary and references, and test the final demo URL from a signed-out browser. The project form and judge links remain unverified. |
| Release blocker | GitHub reports `AlpaganB/acha` is private and has no license field. The local root contains no `LICENSE`. The team must select and document a compatible release license, authorize sharing, and approve how judges access the materials. Test access externally and audit source history and artifacts for credentials, personal data and assets without release rights before changing visibility. [2026 Participant Terms](https://www.spaceappschallenge.org/legal/) |
| Release blocker | Cite every resource and record the applicable permissions. Confirm original ownership or redistribution rights for the existing anatomical artwork, lunar backdrop, application mark and any team names or likenesses used in media. No new visual artwork was generated for this candidate. Keep media rights and required attribution with the demo. [2026 Participant Terms](https://www.spaceappschallenge.org/legal/) |
| Draft AI disclosure | “OpenAI Codex assisted with frontend implementation, regression tests and release documentation. The scenario observations and events are synthetic training fixtures. NASA archive results come from the cited OSDR endpoints.” The team should complete this statement with any other AI-assisted assets and use the portal’s requested format. |
| Team action | Approve final text, links, media and release. Submit through the authenticated **Project** tab and save the submission confirmation. Source control and hosting do not submit the project. |

## Demo modes

| Mode | Data and evaluation | Offline behavior |
| --- | --- | --- |
| Public mission service | Shared example workspace with intermittent spot measurements. Remote FastAPI submits check-ins to the Python engine. Reference and rule coverage depend on the inputs. Use sample data only. | A cached app shell can display previously cached records and queue supported assessments. Measurement saving and server evaluation require the service. |
| Browser training | Three scripted replays with simulated clocks. Lunar follow-up stores fictional records on this device after explicit actions. Card comparisons are descriptive and event labels are part of the exercise. | Works after one successful shell install. No mission writes, Python evaluation, NEWS2 score or real transmissions. |
| Standalone onboard demo | Separate Python assessment engine, SQLite records, training procedures and simulated ground inbox. Its NEWS2 arithmetic references terrestrial adult acute illness. Missing inputs stay incomplete. | Local evaluation works without internet while the Python service runs. A cached browser can queue supported actions when that service stops. |
| Restricted operations | Authorized mission roles and a separate build/API for protected monitoring and documented reviews. Smoke tests use disposable data. | Permissions and service availability govern access. The public replay does not read or change protected records. |

The candidate is a research and training prototype. It makes no clinical validation, NASA endorsement, clinical clearance or flight-readiness claim. The pressure analysis boundary is an exercise parameter. Total pressure does not determine inspired oxygen. The solar replay distinguishes fixed absorbed dose rate (µGy/h) and personal accumulated absorbed dose (µGy). Neither reading establishes effective dose or an astronaut’s actual exposure.

## Provenance and licensing

| Source | Actual use and publication evidence |
| --- | --- |
| NASA OSDR Environmental Data Application, RR-6 | Research requests historical ISS cabin temperature (°C), relative humidity (%) and CO₂ (ppm) collected in support of rodent research. The 15–16 December 2017 day capture has 288 samples, first at 00:01 UTC and last at 00:00 UTC. Archive only, outside crew histories and scenarios. Credit OSDR and EDA. The project does not bundle the source JSON. A dataset-specific license and portal version were not established. [RR-6 payload](https://osdr.nasa.gov/bio/repo/data/payloads/RR-6), [exact day export](https://visualization.osdr.nasa.gov/eda/api/missions/RR-6/telemetry_data/?start=2017-12-15T00%3A00%3A00Z&end=2017-12-16T00%3A00%3A00Z&format=json), [OSDR terms](https://science.nasa.gov/reference/osdr-help-terms-and-conditions/) |
| NASA OSDR RadLab, DORELI DosTel1 | Research plots archived absorbed dose rate (µGy/h) from the fixed instrument in the ISS Columbus module, and labels the separate dose equivalent rate field (µSv/h). The short capture has 84 observations from 1 Apr 2022 23:00:00 to 2 Apr 01:04:40, with no source timezone offset and no dose equivalent rate available in that sample. ACHA does not bundle the source CSV. Credit RadLab, OSDR and the instrument team. A dataset-specific license and portal version were not established. [Instrument metadata](https://visualization.osdr.nasa.gov/radlab/gui/knowledgebase/dostel1), [exact export](https://visualization.osdr.nasa.gov/radlab/api/?instrument_id=DosTel1&timestamp%3E=2022-04-01T23%3A00&timestamp%3C2022-04-02T01%3A05&absorbed_dose_rate&dose_equivalent_rate&format=csv), [OSDR citation guidance](https://science.nasa.gov/reference/osdr-faq/) |
| NASA HRP, Spaceflight Standard Measures, Fatigue Countermeasures Laboratory, Crew Systems and Artemis solar monitoring | Design references for choosing observations and explaining instrument context. The fictional replay supplies its own observations and review events. No NASA-STD-3001 clause is implemented as an action threshold by this candidate. [HRP risks](https://www.nasa.gov/hrp/risks/), [HRR evidence](https://humanresearchroadmap.nasa.gov/Evidence/), [Standard Measures](https://www.nasa.gov/reference/standard-measures/), [fatigue](https://www.nasa.gov/human-systems-integration-division/human-performance/fatigue-countermeasures-laboratory/), [crew systems](https://www.nasa.gov/reference/crew-systems/), [solar monitoring](https://science.nasa.gov/missions/artemis/artemis-2/to-protect-artemis-ii-astronauts-nasa-experts-keep-eyes-on-sun/) |
| PhysioNet BIDMC and Sleep-EDF | Terrestrial hospital spot/monitor observations and adult sleep annotations. Both use ODC Attribution 1.0. The project cites the originals, and documents the derived Sleep-EDF clipping and relative times. [BIDMC attribution](../demo/DATA_SOURCE.md), [Sleep-EDF license](https://physionet.org/content/sleep-edfx/view-license/1.0.0/) |
| PhysioNet QoL_Stress | Controlled terrestrial tasks, displayed as derived group summaries. CC BY 4.0. Cite Calvo, Cejudo and Martín Andonegui, dataset version 1.0.0, and describe aggregation. [Dataset](https://doi.org/10.13026/vqtz-pm70), [license](https://www.physionet.org/content/qol-stress/view-license/1.0.0/) |
| Royal College of Physicians NEWS2 | Terrestrial reference arithmetic. The RCP requires attribution and restricts modifications or incorrect reproduction of its materials. Keep the published charts linked and preserve required credit. Do not claim that copying the arithmetic validates the app. [RCP terms](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/), [source-to-code notes](../demo/NEWS2_SOURCES.md) |
| Libraries, fonts, artwork and branding | React and Vite use MIT, `lucide-react` 0.468.0 uses ISC, and Geist and Instrument Sans carry SIL OFL 1.1 notices. Preserve dependency notices in distributions and review the lockfile and backend requirements for the full inventory. The existing four anatomy illustrations were converted to lossless WebP with a pixel equality check. Their original author and distribution rights remain a team action, as do the backdrop and media assets. The home UI uses the ACHA mark. NASA links are attribution and research references. [React license](https://github.com/facebook/react/blob/main/LICENSE), [Vite license](https://github.com/vitejs/vite/blob/main/LICENSE), [Lucide license](https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE), [Geist](https://github.com/vercel/geist-font), [Instrument Sans](https://github.com/Instrument/instrument-sans) |

The existing [scientific source registry](health-monitoring.md#scientific-source-registry) contains additional experiment, dataset and method citations. Preserve the source record’s timestamps, missing fields and calibration limits when presenting archive results.

## Verification and reproduction

| Check | 15 November result |
| --- | --- |
| Locked frontend build | `npm ci` succeeded in a clean temporary copy after an existing Windows process locked the checkout’s `node_modules` binding. The production Vite build and type check passed in the checkout. Four lossless WebP illustrations reduced bundled anatomy assets from 9.18 MB to 6.22 MB. |
| Frontend | 29 Node tests passed, including playback state, frame synchronization, stable events, missing samples, rewind, relay status, and service worker routing. |
| FastAPI and PostgreSQL 15 | 69 tests and 9 subtests passed. The test fixture applied migrations and checked schema drift. A disposable database was migrated to `0009`. From the browser, a recorded measurement and an evaluated assessment linked to it both persisted against that isolated API. |
| Standalone Python | 62 tests and 951 subtests passed. The standalone JavaScript harness passed queue, cache, guide and replay checks. |
| Browser | Fresh Edge at 1440 and 390 px with reduced motion verified desktop controls in the viewport, keyboard scrubbing, all three replays, shared Home/full-page state with autoplay paused on route change, follow-up persistence, no mission API writes or browser exceptions, and offline reload of Home, a deep link and `/monitoring`. A deliberately stalled service connection timed out and left Retry and training available. |
| NASA data fallback | Local Research fetched 288 RR-6 records and 84 DosTel1 records through the API. Captures below show an earlier successful local fetch. Archive network access remains necessary to refresh. |
| Published smoke | `acha.tr` and the lunar deep link returned 200 in a fresh browser. The deployed page still calls itself Astronaut health console. Direct `/monitoring` returned 404. Health, crew and profiles responded, and the three crew histories were empty. Both NASA archive endpoints returned 404 through Vercel and directly through Railway. Railway OpenAPI only advertised BIDMC under Research. Published backend migration and commit identifiers were unavailable. |

Captures from the local candidate: [Desktop Lunar](assets/screenshots/release/command-center-desktop.png), [390 px Lunar](assets/screenshots/release/command-center-mobile.png), [Solar handover](assets/screenshots/release/solar-handover.png), [RR-6 archive](assets/screenshots/release/nasa-rr6-archive.png), [DosTel1 archive](assets/screenshots/release/nasa-dostel1-archive.png).

From a clean checkout with Node 24, npm, Python dependencies from `backend/requirements-dev.txt`, and a disposable PostgreSQL URL in `TEST_DATABASE_URL`, run `./scripts/check_release.ps1` in PowerShell. It installs locked packages, builds, and runs all three suites. Use `-Python` to point at the project virtual environment.

For a browser rehearsal, migrate and seed a local sample service and start Uvicorn on loopback port 8000, then run `npm run preview -- --host 127.0.0.1 --port 4179` from `frontend`. Run the following from the repository root with Playwright and either Chromium or a locally installed Edge channel.

```powershell
python -m pip install playwright
python scripts/check_replay_browser.py --channel msedge --research --screenshots docs/assets/screenshots/release
```

The `--test-api http://127.0.0.1:8009` option adds a connected measurement and assessment write against an independently migrated, disposable API/database. It creates its own test crew. Shell and playback checks can run with the service down by omitting `--research` and `--test-api`.

## Release manifest

| Item | Value |
| --- | --- |
| Date and branch | 15 November 2026, `codex/mission-health-command-center` |
| Starting commit | `f4aa68c503631a30e7a4e68d1e7ba6dfb9826bf6` |
| Application code commit | `77c830142be103cfa7d9d9af23c4657b51e98ff2` |
| Candidate build | Vite 8.3.8 public build in `frontend/dist`, cache version `253a0aea2a91`. Verified against PostgreSQL migration `0009` locally. |
| Published URL | [acha.tr](https://acha.tr/) runs the earlier `index-DN0-kCJv.js` frontend. The candidate was built locally. |
| Pending | Team approval for licensing, access, deployment and submission. After approval, align Railway and Vercel versions, verify the database migration and NASA endpoints, and repeat the judge workflow from the published URL. Confirm video access and the final portal receipt separately. |
