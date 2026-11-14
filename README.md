# ACHA

The Autonomous Crew Health Assistant backend stores crew, mission profiles, measurements, and assessment records for the prototype.

## Run the onboard demo

The [onboard demo](demo/START_HERE.md) includes observation entry, assessment, local history, cached guidance, and simulated ground handover. Run `python serve_demo.py` from `demo/` after installing Pydantic 2.

## Run the crew health frontend

Start the backend and seed the demo database, then run the following from `frontend/` using Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open [the development app](http://localhost:5173). Development and preview proxy `/api` to the backend at `127.0.0.1:8000`. For a deployed frontend, serve `/api/v1` on the same origin or set `VITE_API_URL` at build time and configure the backend's allowed origins.

To verify offline guides, run `npm run build` and `npm run preview`. Open the preview once while connected, wait for “Demo guides saved on this device,” then go offline and reload an emergency guide. The app bundles the demonstration guides from `demo/mission_demo.json` and labels them as training content.

The frontend can save an assessment locally and evaluate it when the app is open and the service returns. Use synthetic data with the prototype, which stores that data in the current browser. When FastAPI is reachable, the app displays the onboard engine result and its associated demo guide immediately.

## Run the backend

Use Python 3.12 or later and PostgreSQL 15. From the repository root, `docker compose up -d db` starts the development database. An existing PostgreSQL database also works with its own connection URL.

Create a virtual environment and run the following from `backend/`. Set `DATABASE_URL` in the same shell. With the Compose database, use `postgresql+psycopg://acha:acha_dev@127.0.0.1:5432/acha`.

```sh
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m app.seed
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

For PowerShell, set a variable with `$env:DATABASE_URL = 'postgresql+psycopg://acha:acha_dev@127.0.0.1:5432/acha'`. In Bash, use `export DATABASE_URL='postgresql+psycopg://acha:acha_dev@127.0.0.1:5432/acha'`.

The seed creates workspaces for Alpagan, Asım, and Emirhan and two mission profiles. Their measurement and assessment histories start empty. The seed can be rerun without overwriting measurements or assessments. Use sample readings in the public deployment, which exposes its routes without authentication.

## Deploy the public demo

1. On Railway, add a PostgreSQL service and a GitHub service for `AlpaganB/acha` in the same project. Leave the backend service's Root Directory at the repository root so its image can include the shared code in `demo/`.
2. Name the Railway backend service `acha-api` and set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` (use the name of your database service). From the linked repository root, install the Railway SDK with `npm install --no-save --no-package-lock railway`. Run `railway config plan` and `railway config apply` to configure the health check. The container applies migrations and loads synthetic demo records before it begins serving requests. Generate a public domain for the backend and check that `https://<railway-domain>/api/v1/health` returns HTTP 200.
3. In Vercel, import `AlpaganB/acha` with the Vite preset and Root Directory `frontend`. Enable **Include source files outside of the Root Directory in the Build Step** so Vite can read `demo/mission_demo.json`. The rewrite in `frontend/vercel.json` forwards `/api/v1` to Railway. Update its destination if you deploy to a different Railway hostname.
4. Add `acha.tr` in the Vercel project's Domains settings. At the authoritative DNS provider, set the apex `A` record to the value shown for that domain in Vercel. After HTTPS is active, open `https://acha.tr`, confirm the synthetic crew loads, and submit a demo assessment.

Use only synthetic data in this public demo. The API exposes its records without authentication.

## API integration

Open [Swagger UI](http://127.0.0.1:8000/docs) or fetch the [OpenAPI JSON](http://127.0.0.1:8000/openapi.json) from a running server. The initial API contract uses `/api/v1`. By default, CORS allows the Vite development origins at `localhost:5173` and `127.0.0.1:5173`. Set `CORS_ORIGINS` to a comma-separated list to configure other origins.

| Method | Path relative to `/api/v1` | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check PostgreSQL connectivity |
| `GET`, `POST` | `/mission-profiles` | List or create profiles |
| `GET` | `/mission-profiles/{profile_id}` | Read equipment, constraints, schedules, and guidance references |
| `GET`, `POST` | `/crew-members` | List or create crew members |
| `GET` | `/crew-members/{crew_id}` | Read the crew member's active mission profile ID |
| `PATCH` | `/crew-members/{crew_id}/mission-profile` | Set the active `mission_profile_id` |
| `GET`, `POST` | `/crew-members/{crew_id}/measurements` | Browse history or record a reading |
| `GET` | `/crew-members/{crew_id}/measurements/{measurement_id}` | Read one measurement |
| `GET`, `POST` | `/crew-members/{crew_id}/assessments` | Browse history or submit an assessment |
| `GET` | `/crew-members/{crew_id}/assessments/{assessment_id}` | Read assessment inputs and result |
| `POST` | `/crew-members/{crew_id}/assessments/{assessment_id}/evaluate` | Run the demonstration engine for a pending record |
| `PUT` | `/crew-members/{crew_id}/assessments/{assessment_id}/result` | Store the assessment engine's result |

### Measurements

Supply `id`, `kind`, `value`, and `recorded_at` with a time zone. Responses include the canonical `unit` and return timestamps in UTC. For `blood_pressure`, `value` is systolic and `diastolic` is required.

| `kind` | `unit` |
| --- | --- |
| `heart_rate` | `bpm` |
| `spo2` | `%` |
| `blood_pressure` | `mmHg` |
| `body_temperature` | `°C` |

```json
{
  "id": "bb6ea16e-7eb7-4693-b1b5-dfb15a903210",
  "kind": "blood_pressure",
  "value": 118,
  "diastolic": 76,
  "recorded_at": "2026-11-14T10:00:00Z"
}
```

### Assessments

Supply `id`, `assessed_at`, and the `mission_profile_id` active at capture time, plus `symptoms` or `measurement_ids`. Each symptom has a `code` and an optional integer `severity` from 0 to 10. Measurement references must belong to the crew member. Optional `notes` can record context. A profile change leaves prior assessment records associated with their capture-time profile.

The React app creates records using `POST /assessments?evaluate=true`. This evaluates the attached observations against the synthetic rules for the capture-time mission environment and saves the result with the record. The response preserves the existing `status`, `rationale`, `next_step` and `protocol_id` fields and includes the structured `engine_result`. The database also keeps the engine inputs and rules used.

Record a measurement in the React app at `/measurements` and use **Assess saved measurement** to attach it to a new assessment. The API supports heart rate, blood oxygen, blood pressure, and temperature. The result can show the difference from the median of at least five prior readings of the same kind for the same crew member, within 30 days of the attached reading. The comparison is descriptive. Systolic pressure is used for the blood pressure comparison.

The `/research` page reads `/api/v1/research/bidmc-01`, which parses the published PhysioNet hospital record and computes medians. **Fetch from PhysioNet** downloads the original public file again and repeats the calculation. Research data is kept separate from crew histories. [Dataset and attribution](demo/DATA_SOURCE.md)

Creating without `evaluate=true` still produces a pending record. Clients can then run the built-in engine via `/evaluate` or store an external result via `/result`. Retries return the stored result. Existing `demo_reviewed` examples remain available.

The integrated form lacks several NEWS2 inputs, including a measured pulse rate distinct from heart rate, respiratory rate, and crew context. It reports incomplete data where appropriate and still evaluates configured symptom rules. The full synthetic NEWS2, baseline and trend scenarios are available in the standalone demo.

The application teams can use `guidance_protocol_ids` and `protocol_id` to resolve protocol content from their guidance catalog. Mission profiles store reminder intervals in `measurement_schedules` with `kind` and `interval_minutes`.

### History, offline writes, and errors

Measurement and assessment history is sorted by capture time newest first, with UUID as a stable tie-breaker. Both support `since` (inclusive), `until` (exclusive), `limit` (default 50, max 200), and `offset` (default 0). Measurements also support `kind`. Crew and mission profile lists support `limit` and `offset`.

Generate a UUID once when recording a measurement or assessment, for example with the browser's `crypto.randomUUID()`. Keep that UUID and payload in the client queue. Send measurements before assessments that reference them. A new record returns `201`. An identical retry returns the existing record with `200`. Reusing an ID for a different valid record returns `409`.

Unknown records return `404`. Invalid requests return `422`. An unavailable database returns `503`. Error responses have a `detail` field containing a message or validation issues with `loc`, `msg`, and `type`.

## Integration tests

From `backend/`, install `requirements-dev.txt`, set `TEST_DATABASE_URL` to a PostgreSQL database where the role can create schemas, and run `python -m pytest`. The tests apply the migrations in a new schema and remove that schema after the run. Use a development or test database.
