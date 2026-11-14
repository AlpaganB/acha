import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from .api import router
from .database import make_engine
from .observation_access import load_observation_access
from .observations import router as observation_router
from .research import router as research_router


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
    public_workspace = os.getenv("ACHA_PUBLIC_WORKSPACE", "enabled") != "disabled"
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
        if not public_workspace and path.split("/")[1:4] in (
            ["api", "v1", "crew-members"], ["api", "v1", "mission-profiles"],
        ):
            return JSONResponse(status_code=404, content={"detail": "The public workspace is disabled."})
        response = await call_next(request)
        if path.startswith("/api/v1/observations/"):
            response.headers["Cache-Control"] = "private, no-store"
        return response

    app.include_router(router)
    app.include_router(observation_router)
    app.include_router(research_router, prefix="/api/v1")
    return app


app = create_app()
