<p align="center">
  <img src="frontend/public/acha.svg" width="80" height="80" alt="ACHA application mark">
</p>

<h1 align="center">ACHA</h1>

<p align="center">
  <strong>Autonomous Crew Health Assistant</strong><br>
  Crew health check-ins for long-duration space missions.
</p>

<p align="center">
  <a href="https://acha.tr/">Open the live demo</a> ·
  <a href="#run-locally">Run locally</a> ·
  <a href="https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/">NASA Space Apps 2026</a>
</p>

<p align="center">
  <img src="docs/assets/screenshots/crew-workspace.png" width="100%" alt="ACHA crew health workspace with the lunar horizon, latest measurements, and assessment history">
</p>

When a crew is far from Earth, they may need to assess a change in health before a flight surgeon can respond. ACHA gives them one place to log a reading, compare it with their own recent history, and see what prompted an assessment and which training guide to open.

The web app records and evaluates measurements through a live API. A standalone onboard demo runs the assessment engine on a local workstation so the crew can complete a check-in during a simulated loss of the Earth link.

## How a check-in works

1. **Choose a crew member.** A mission profile supplies equipment, constraints, and guidance for the current environment.
2. **Record a reading.** Save heart rate, blood oxygen saturation, blood pressure, or body temperature. Each reading has a unit and a timestamp and stays in that crew member's history.
3. **Submit an assessment.** Select saved readings, report symptoms, or combine both. The engine evaluates the available inputs and reports missing information.
4. **Review the result.** Read the rationale and suggested next step, then open the training guide when one is linked. Previous assessments preserve the mission profile and inputs used at the time.

### How the engine evaluates a check-in

The web app applies symptom rules and checks available vital signs against the NEWS2 reference. It saves the inputs, result, and rules used. For each evaluated reading with enough history, it shows the difference from the median of at least five earlier readings of the same kind for the same crew member from the previous 30 days. Blood pressure comparisons use systolic values. The comparison is descriptive.

The standalone demo covers the full terrestrial NEWS2 reference calculation in its test scenarios. The web form displays incomplete scoring when required observations are missing. The mission profiles and response mappings are training settings. [NEWS2 sources and scope](demo/NEWS2_SOURCES.md)

## Data and evidence

| Source | How ACHA uses it |
| --- | --- |
| Crew entries | The API stores entered measurements and symptoms in PostgreSQL. The seed provides a crew roster and mission profiles with empty histories. |
| PhysioNet BIDMC | The Research page parses 481 published hospital observations and calculates the medians. **Fetch from PhysioNet** downloads the original record and recalculates them. This dataset has its own research view. [Data source and attribution](demo/DATA_SOURCE.md) |
| NASA Human Research Program | Spaceflight hazards and Earth-independent medical operations inform the choice of measurements and the onboard workflow. [NASA hazards](https://www.nasa.gov/hrp/hazards/) · [NASA risks](https://www.nasa.gov/hrp/risks/) · [NASA medical operations research](https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/) |

<details>
<summary>See the live research fetch</summary>

<p align="center">
  <img src="docs/assets/screenshots/physionet-research.png" width="100%" alt="ACHA Research page showing 481 observations and calculated medians after downloading BIDMC 01 from PhysioNet">
</p>

</details>

ACHA is a training and research prototype. Use sample readings in the public demo because its records are accessible without authentication. The BIDMC replay verifies calculations on hospital data. Astronaut telemetry and flight clinical validation remain outside the current release. [Engine verification](demo/VALIDATION.md)

## Architecture

~~~mermaid
flowchart LR
    Crew["Crew workspace<br/>React · Vite · Vercel"]
    API["FastAPI<br/>Railway"]
    Engine["Python assessment engine"]
    DB[("PostgreSQL")]
    Research["PhysioNet BIDMC"]
    Onboard["Standalone onboard demo<br/>Python · SQLite"]

    Crew -->|"/api/v1"| API
    API <--> DB
    API --> Engine
    API -->|"On-demand research fetch"| Research
    Onboard --> Engine
~~~

The web app caches guides and previously loaded context. It queues assessments during a service interruption and evaluates them when the API is reachable again. Saving new measurements uses the API. The standalone demo can save and evaluate a check-in offline while its local server is running, and can simulate a handover to ground control.

## Run locally

### Standalone onboard demo

Use Python 3.10 or later. Once Pydantic is installed, this demo runs without internet access.

~~~sh
cd demo
python -m pip install "pydantic>=2,<3"
python serve_demo.py
~~~

Open [localhost:8765](http://127.0.0.1:8765/). Load **Routine check-in**, then try **Pulse change** or **Chest pain + missing data**. [Full demo walkthrough](demo/START_HERE.md)

### Web app and API

Use Node.js 22.12 or later, Python 3.12 or later, and Docker Compose. From the repository root, start PostgreSQL.

~~~sh
docker compose up -d db
cd backend
python -m venv .venv
~~~

Activate the environment and set the database URL in the backend terminal.

<details>
<summary>Shell commands</summary>

**PowerShell**

~~~powershell
.\.venv\Scripts\Activate.ps1
$env:DATABASE_URL = 'postgresql+psycopg://acha:acha_dev@127.0.0.1:5432/acha'
~~~

**Bash**

~~~bash
source .venv/bin/activate
export DATABASE_URL='postgresql+psycopg://acha:acha_dev@127.0.0.1:5432/acha'
~~~

</details>

Install the backend dependencies, apply the migrations, and start the API.

~~~sh
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m app.seed
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
~~~

From the repository root in a second terminal, start Vite.

~~~sh
cd frontend
npm ci
npm run dev
~~~

Open [the web app](http://localhost:5173/) or [the API explorer](http://127.0.0.1:8000/docs). Vite forwards `/api` to the local backend. To try the service worker locally, use `npm run build` and `npm run preview`, then open the preview once while connected so it can cache the app and guides.

## API and hosting

| Entry point | Purpose |
| --- | --- |
| [Swagger UI](http://127.0.0.1:8000/docs) · [OpenAPI JSON](http://127.0.0.1:8000/openapi.json) | Request schemas, status codes, and interactive API calls |
| [Live health check](https://acha.tr/api/v1/health) | API and PostgreSQL connectivity |
| [Research page](https://acha.tr/research) | Published observations and the live PhysioNet fetch |

<details>
<summary>Integration notes</summary>

- Measurement writes use client-generated UUIDs and timestamps with a time zone. For blood pressure, send the systolic reading as `value` and the diastolic reading as `diastolic`.
- Send measurements before assessments that reference them. Use `POST /api/v1/crew-members/{crew_id}/assessments?evaluate=true` to calculate and persist an assessment. Without that query parameter, the record starts pending for later evaluation.
- A new record returns `201`. An identical retry returns the existing record with `200`. Reusing the identifier for different input returns `409`.
- Histories support `since`, `until`, `limit`, and `offset`. Measurement history also accepts `kind`.

</details>

<details>
<summary>Deployment and integration tests</summary>

- **Railway** uses the repository root so the [Dockerfile](Dockerfile) can copy the shared engine from `demo/`. Set `DATABASE_URL` to the PostgreSQL service reference, such as `${{Postgres.DATABASE_URL}}`. The [startup script](backend/start.sh) runs migrations and seeds the roster before serving requests. Set the health check to `/api/v1/health` or apply the [Railway configuration](.railway/railway.ts) to the linked `acha-api` service.
- **Vercel** uses the Vite preset with `frontend` as its root and **Include source files outside of the Root Directory in the Build Step** enabled. The [rewrite configuration](frontend/vercel.json) forwards API requests to Railway and serves the app on direct route visits. Update the rewrite when using a different Railway domain. If calling the API across origins, set `VITE_API_URL` at build time and allow the frontend origin through the backend's `CORS_ORIGINS`.
- **Integration tests** run from `backend/`. Install `requirements-dev.txt`, set `TEST_DATABASE_URL` to a development database whose role can create schemas, and run `python -m pytest`. The suite uses a temporary schema.

</details>

## Documentation

| Document | Scope |
| --- | --- |
| [Onboard demo](demo/START_HERE.md) | Setup, offline scenarios, and simulated handover |
| [Assessment engine](demo/README.md) | Inputs, outputs, and rule behavior |
| [Verification report](demo/VALIDATION.md) | Rule comparisons, dataset replay, and limits |
| [NASA Space Apps submission](demo/SUBMISSION.md) | Challenge mapping, research sources, and demo narration |
