# Local development

The connected workspace uses Node.js 24 or newer, Python 3.13 and PostgreSQL 15. For a one-process demo without PostgreSQL, start with the [standalone onboard demo](../demo/START_HERE.md).

## Run the connected workspace

From the repository root, create a virtual environment and start the example database. The Compose service binds PostgreSQL to loopback and uses sample credentials.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
docker compose up -d db
```

On Windows PowerShell, create the environment with `py -3.13 -m venv .venv` and activate it with `./.venv/Scripts/Activate.ps1`. A locally installed PostgreSQL instance can also be used by supplying its connection URL.

Once PostgreSQL accepts connections, run the API from `backend/`. The seed adds example crew and synthetic reading histories.

```bash
cd backend
export DATABASE_URL=postgresql://acha:acha_dev@127.0.0.1:5432/acha
python -m alembic upgrade head
python -m app.seed
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In PowerShell, set the URL with `$env:DATABASE_URL = 'postgresql://acha:acha_dev@127.0.0.1:5432/acha'`.

From a second terminal, start the web workspace. Vite forwards `/api` to the local API on port 8000.

```bash
cd frontend
npm ci
npm run dev
```

Open [the local workspace](http://localhost:5173/) or [FastAPI’s API reference](http://127.0.0.1:8000/docs).

## Run the checks

Run each block from the repository root with the virtual environment active. The frontend route inventory test invokes `python` on the active PATH.

```bash
(cd frontend && npm ci && npm run build && node --test test/*.test.mjs)
(cd demo && python -m pytest -q && node test_browser_flow.mjs)
```

Set `TEST_DATABASE_URL` to a disposable PostgreSQL database. The backend suite creates and removes an isolated schema and checks the migrated schema against the models.

```bash
docker compose exec db createdb -U acha acha_test
export TEST_DATABASE_URL=postgresql://acha:acha_dev@127.0.0.1:5432/acha_test
(cd backend && python -m pytest -q)
```

For a browser smoke test, leave the API running and serve the built frontend with `npm run preview -- --host 127.0.0.1 --port 4179` from `frontend/`. Run the following from the root.

```bash
python -m pip install playwright
python -m playwright install chromium
python scripts/check_replay_browser.py
```

Add `--research` to check upstream archive fetches, or `--test-api http://127.0.0.1:8000` to exercise connected writes against a disposable local API. The browser check creates a test crew for the write path. On PowerShell, activate the virtual environment, set `$env:TEST_DATABASE_URL`, and run [the release check script](../scripts/check_release.ps1) for the build and unit suites.

## Service boundaries

The public workspace uses sample records. Browser training stores fictional records locally. The separate restricted workspace uses mission-scoped authorization and its own build configuration. [Restricted workspace setup](health-monitoring.md#restricted-log-setup) · [Frontend API coverage](frontend-api-coverage.md)
