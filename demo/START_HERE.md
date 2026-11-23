# Standalone onboard demo

This demo runs ACHA’s Python assessment engine, a browser interface and a SQLite record store on one workstation. After installing Pydantic, the workflow runs without an internet connection as long as the local server is running.

## Start the local server

With Python 3.10 or newer and an active virtual environment, run the following from the repository root.

```bash
python -m pip install "pydantic>=2,<3"
python demo/serve_demo.py
```

Open [the onboard workspace](http://127.0.0.1:8765/) and keep the terminal running.

## Practice a check-in

1. Select **Orbital station**, load **Routine check-in** and select **Save and evaluate**.
2. Save **Pulse change** and open the observation history to compare the two entries.
3. Load **Chest pain + missing data** to see how the exercise presents an urgent result and missing measurements together.
4. Switch to **Deep-space transit** to see how unavailable instruments affect the result.
5. Select **Send to simulated ground inbox**. Send again to see how duplicate receipts are handled.

To simulate losing the Earth link, disconnect from the internet and leave the local server running. To simulate losing the local server, let the browser load its cached resources, stop the server and submit a sample. The browser queues the observation and retains the emergency guide. Restart the server to process the queue.

## FastAPI adapter

The standalone service also has a separate FastAPI adapter using PostgreSQL. Run these commands from `demo/` with `ACHA_DATABASE_URL` set to a disposable database connection URL.

```bash
python -m pip install -r requirements-api.txt
python -m uvicorn fastapi_app:app --host 127.0.0.1 --port 8765
```

For the React workspace and its mission API, see [local development](../docs/development.md). For the engine’s inputs and results, see the [engine contract](README.md) and [verification report](VALIDATION.md).
