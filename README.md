# ACHA

The Autonomous Crew Health Assistant backend stores crew, mission profiles, measurements, and assessment records for the prototype.

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

The fixtures include two fictional crew members, two mission profiles, vital-sign history, and assessment examples. The seed command can be run again without duplicating or resetting records. Use the API locally with synthetic data. This prototype exposes its routes without authentication.

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

A new record starts with `status: "pending"` and null result fields. The engine writes `status`, `rationale`, `next_step`, and optional `protocol_id` to `/result`. A final status is an engine-defined lowercase code. A stored result can be replayed idempotently. The demo's `demo_reviewed` status and text are synthetic examples for interface testing.

The application teams can use `guidance_protocol_ids` and `protocol_id` to resolve protocol content from their guidance catalog. Mission profiles store reminder intervals in `measurement_schedules` with `kind` and `interval_minutes`.

### History, offline writes, and errors

Measurement and assessment history is sorted by capture time newest first, with UUID as a stable tie-breaker. Both support `since` (inclusive), `until` (exclusive), `limit` (default 50, max 200), and `offset` (default 0). Measurements also support `kind`. Crew and mission profile lists support `limit` and `offset`.

Generate a UUID once when recording a measurement or assessment, for example with the browser's `crypto.randomUUID()`. Keep that UUID and payload in the client queue. Send measurements before assessments that reference them. A new record returns `201`. An identical retry returns the existing record with `200`. Reusing an ID for a different valid record returns `409`.

Unknown records return `404`. Invalid requests return `422`. An unavailable database returns `503`. Error responses have a `detail` field containing a message or validation issues with `loc`, `msg`, and `type`.

## Integration tests

From `backend/`, install `requirements-dev.txt`, set `TEST_DATABASE_URL` to a PostgreSQL database where the role can create schemas, and run `python -m pytest`. The tests apply the migrations in a new schema and remove that schema after the run. Use a development or test database.
