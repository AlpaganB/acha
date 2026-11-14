import os
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.orm import Session


def database_url(value: str | URL | None = None) -> URL:
    value = value or os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("Set DATABASE_URL to a PostgreSQL connection URL.")
    url = make_url(value)
    if url.drivername == "postgresql":
        return url.set(drivername="postgresql+psycopg")
    if url.drivername != "postgresql+psycopg":
        raise RuntimeError("DATABASE_URL must use PostgreSQL with psycopg.")
    return url


def make_engine(value: str | URL | None = None) -> Engine:
    return create_engine(database_url(value), pool_pre_ping=True)


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine, expire_on_commit=False) as session:
        yield session


DbSession = Annotated[Session, Depends(get_session)]
