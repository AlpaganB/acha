# Frontend API coverage

All 34 HTTP operations registered by `backend/app/main.py` have a frontend client and a UI consumer. This is source-level coverage; it does not claim that every live deployment enables every operation.

Public workspace routes are enabled only in the public demo. Personal radiation, health review, device ingestion and radiation-window review require the restricted deployment and their existing server authorization. The UI does not alter these controls. Device keys are never stored in localStorage or sessionStorage.

The external result form stores a result supplied by an assessment engine; it does not calculate or replace clinical results. It is shown only for an existing pending assessment.

Device registration, key rotation and policy administration remain backend CLI operations; they are not HTTP endpoints. Device upload requires an already registered channel, matching mission clock and firmware, and the channel's device key.

| HTTP operation | Screen / action | Availability | Client |
| --- | --- | --- | --- |
| `GET /api/v1/health` | Service check | Public / restricted | `observationsApi.deployment` |
| `GET /api/v1/crew-members/{crew_id}/monitoring` | /monitoring | Public | `api.monitoring` |
| `POST /api/v1/mission-profiles` | /mission — Create mission profile | Public | `api.createProfile` |
| `GET /api/v1/mission-profiles` | /mission and /crew | Public | `api.profiles` |
| `GET /api/v1/mission-profiles/{profile_id}` | /mission — Measurement schedule | Public | `api.profile` |
| `POST /api/v1/crew-members` | /crew — Add crew member | Public | `api.createCrew` |
| `GET /api/v1/crew-members` | /crew and crew selector | Public | `api.crew` |
| `GET /api/v1/crew-members/{crew_id}` | /crew — Selected crew member | Public | `api.crewMember` |
| `PATCH /api/v1/crew-members/{crew_id}/mission-profile` | /mission — Use this profile | Public | `api.setProfile` |
| `POST /api/v1/crew-members/{crew_id}/measurements` | /measurements — Record | Public | `api.recordMeasurement` |
| `GET /api/v1/crew-members/{crew_id}/measurements` | /measurements and dashboard | Public | `api.measurements` |
| `GET /api/v1/crew-members/{crew_id}/measurements/{measurement_id}` | /measurements/:id — click a reading | Public | `api.measurement` |
| `POST /api/v1/crew-members/{crew_id}/assessments` | /assessment | Public | `api.submit` |
| `GET /api/v1/crew-members/{crew_id}/assessments` | /assessments | Public | `api.assessments` |
| `GET /api/v1/crew-members/{crew_id}/assessments/{assessment_id}` | /assessments/:id | Public | `api.assessment` |
| `POST /api/v1/crew-members/{crew_id}/assessments/{assessment_id}/evaluate` | /assessments/:id — Run assessment | Public | `api.evaluate` |
| `PUT /api/v1/crew-members/{crew_id}/assessments/{assessment_id}/result` | /assessments/:id — Import external engine result (pending only) | Public | `api.storeAssessmentResult` |
| `GET /api/v1/observations/missions/{mission_code}/crew` | Restricted mission log — Crew selector | Bearer access | `observationsApi.crew` |
| `GET /api/v1/observations/missions/{mission_code}/crew/{crew_code}/monitoring` | Restricted mission log — Personal indicators | Medical bearer access | `observationsApi.monitoring` |
| `GET /api/v1/observations/missions/{mission_code}/crew/{crew_code}/radiation` | Restricted workspace — Crew radiation | Medical bearer access | `observationsApi.radiation` |
| `GET /api/v1/observations/missions/{mission_code}/crew/{crew_code}/health-review` | Restricted workspace — Health review | Medical bearer access | `observationsApi.healthReview` |
| `POST /api/v1/observations/missions/{mission_code}/crew/{crew_code}/health-review/acknowledgments` | Restricted workspace — Health review acknowledgment | Medical bearer access | `observationsApi.acknowledgeHealthReview` |
| `GET /api/v1/observations/parameters` | Restricted mission log — Observation fields | Parameter registry | `observationsApi.parameters` |
| `GET /api/v1/observations/access` | Restricted mission log — Sign in | Bearer access | `observationsApi.access` |
| `GET /api/v1/observations/missions/{mission_code}` | Restricted mission log — History and trends | Bearer access | `observationsApi.list` |
| `POST /api/v1/observations/missions/{mission_code}` | Restricted mission log — Record observation | Bearer access | `observationsApi.save` |
| `POST /api/v1/observations/missions/{mission_code}/radiation/review` | Restricted mission log — Device data quality / Radiation window | Bearer access | `observationsApi.reviewRadiation` |
| `GET /api/v1/research/nasa-dostel1` | /research — Radiation archive | Public research | `api.doseResearchRecord` |
| `GET /api/v1/research/nasa-rr6-iss` | /research — ISS environment | Public research | `api.issResearchRecord` |
| `GET /api/v1/research/bidmc-01` | /research — BIDMC observations | Public research | `api.researchRecord` |
| `GET /api/v1/research/bidmc-01-waveforms` | /research — Measurement research / Waveforms | Public research | `api.waveforms` |
| `GET /api/v1/research/osdr-assays/{study}` | /research — Measurement research / OSD assay coverage | Public research | `api.assayCoverage` |
| `GET /api/v1/observations/missions/{mission_code}/devices` | Restricted mission log — Device data quality | Bearer access | `observationsApi.channels` |
| `POST /api/v1/observations/missions/{mission_code}/devices/{channel_code}/samples` | Restricted workspace — Device integration; /mission/devices checks deployment | Device key; restricted deployment | `observationsApi.ingestSample` |

## Validation

- `node --test frontend/test/apiCoverage.test.mjs frontend/test/apiRequests.test.mjs`: compares actual FastAPI route declarations with TypeScript client calls and UI consumers; checks request bodies, scoping, device authorization, and validation/conflict responses with mocked fetch.
- `npm run build --prefix frontend`
- `npm run build:restricted --prefix frontend` with a valid `VITE_API_URL`; checked using the loopback API URL in the build process environment. No deployment configuration is changed.

No real crew, mission profile, device sample or assessment result is created by these automated checks.
