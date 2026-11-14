# ACHA | NASA Space Apps 2026

ACHA is an onboard crew-health monitoring and decision-support prototype. The release contains a local browser interface, the Python assessment engine, persistent observation history, cached response guides and a simulated ground handover.

## Run the demo

Open a terminal in the extracted folder. The local demo requires Python 3.10 or newer and Pydantic 2. Once this dependency is installed, the complete onboard flow runs without internet access.

```bash
python -m pip install "pydantic>=2,<3"
python serve_demo.py
```

Open http://127.0.0.1:8765/ in a browser. Keep the terminal running. To test loss of the Earth link, disconnect the internet while leaving the local server running. To test loss of the onboard server, open the app once, wait for its cached resources to load, stop the server, and submit an example. The browser queues the observation and retains the emergency guide. Restart the server and use the handover button to process the queue.

## Demonstration sequence

1. Select **Orbital station**, load **Routine check-in**, and select **Save and evaluate**. The complete observation gives NEWS2 reference score 0.
2. Load **Pulse change** and save. The result identifies the deviation from the synthetic baseline. Open observation history to see both readings.
3. Load **Chest pain + missing data** and save. The emergency guide remains accessible and the incomplete observation produces an urgent result.
4. Switch to **Deep-space transit**. Its profile has no blood pressure cuff and uses a different reminder interval. The score remains incomplete when required measurements are unavailable.
5. Use **Send to simulated ground inbox**. The receipt is persisted and another send acknowledges zero duplicate records.

## Backend adapter

The same app service can be run under FastAPI with PostgreSQL. The command below assumes a reachable PostgreSQL database, with its connection URL supplied separately using ACHA_DATABASE_URL.

```bash
python -m pip install -r requirements-api.txt
python -m uvicorn fastapi_app:app --host 127.0.0.1 --port 8765
```

The local demo uses SQLite. SQLite and the supplied web UI make this package runnable independently of the team repository. That repository returned HTTP 404. The supplied UI uses native HTML and JavaScript. The JSON contract allows the team's React interface to connect to the same assessment service. See README.md for the engine contract.

## Evidence and scope

- NASA challenge brief defines the gather, evaluate and act workflow. [Official challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)
- NASA Exploration Medical Capability research informs the onboard operation and handover design. [Earth-independent medical operations](https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/)
- The Inspiration4 study informed the use of personal comparisons and recording context. [Published study](https://www.nature.com/articles/s41586-024-07648-x)
- The RCP NEWS2 chart provides an optional terrestrial reference score. See NEWS2_SOURCES.md. The mission profiles, reference values, reminder intervals and response mappings are synthetic demonstration settings.
- BIDMC supplied real hospital time series for arithmetic and missing-data evaluation. See DATA_SOURCE.md. Emergency guidance is adapted to an onboard training workflow from the linked first-aid references. Flight clinical validation and mission-specific treatment procedure approval are outside the evidence in this release.

## Repeatable verification

```bash
python -W error::ResourceWarning -m unittest discover -q
node test_browser_flow.mjs
```

The Python suite verifies the engine and application routes, durable storage, duplicate-safe handover, three observation scenarios and instrument failure. The Node harness executes browser logic against a simulated DOM, storage, network and service worker cache. An actual browser session was attempted, but the test environment blocked its loopback connection. FastAPI/PostgreSQL installation and execution were unavailable because this environment could not reach the package registry and had no PostgreSQL instance.

The prior 82,500 source-rule scenario comparisons and 10-record dataset replay remain in VALIDATION.md and the associated evidence files. The assessment engine files are unchanged by this application release. SUBMISSION.md contains the English submission copy and demo script.
