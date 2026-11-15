import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from .api import health_router, router
from .crew_monitoring import router as crew_monitoring_router
from .crew_radiation import router as crew_radiation_router
from .database import make_engine
from .health_review import router as health_review_router
from .observation_access import load_observation_access
from .observations import router as observation_router
from .radiation_review import router as radiation_router
from .research import router as research_router
from .research_measurements import router as research_measurements_router
from .telemetry import router as telemetry_router
from .workspace import public_workspace_enabled


def create_app(database_url: str | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.observation_access = load_observation_access()
        engine = make_engine(database_url)
        app.state.engine = engine
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="ACHA API", version="1.0.0", lifespan=lifespan)
    app.state.public_workspace_enabled = public_workspace_enabled()
    origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST", "PATCH", "PUT"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{key: error[key] for key in ("loc", "msg", "type")} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.exception_handler(OperationalError)
    async def database_unavailable(_: Request, __: OperationalError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Database is unavailable."})

    @app.middleware("http")
    async def protect_observation_responses(request: Request, call_next):
        path = request.url.path
        response = await call_next(request)
        if path.startswith("/api/v1/observations/"):
            response.headers["Cache-Control"] = "private, no-store"
        return response

    app.include_router(health_router)
    if app.state.public_workspace_enabled:
        app.include_router(router)
    app.include_router(observation_router)
    app.include_router(crew_monitoring_router)
    if not app.state.public_workspace_enabled:
        app.include_router(health_review_router)
        app.include_router(crew_radiation_router)
        app.include_router(telemetry_router)
        app.include_router(radiation_router)
    app.include_router(research_router, prefix="/api/v1")
    app.include_router(research_measurements_router, prefix="/api/v1")
    return app


app = create_app()
