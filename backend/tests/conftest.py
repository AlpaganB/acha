import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.schema import CreateSchema, DropSchema

from app.database import database_url, make_engine
from app.main import create_app


@pytest.fixture(scope="session")
def test_database_url():
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.exit(
            "Set TEST_DATABASE_URL to a PostgreSQL database with CREATE SCHEMA privileges.", returncode=2
        )

    schema = f"acha_test_{uuid4().hex}"
    admin = make_engine(value)
    url = database_url(value)
    options = f"{url.query.get('options', '')} -c search_path={schema}".strip()
    test_url = url.update_query_dict({"options": options}).render_as_string(hide_password=False)
    config = Config(Path(__file__).resolve().parents[1] / "alembic.ini")
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        with pytest.MonkeyPatch.context() as patch:
            patch.setenv("DATABASE_URL", test_url)
            command.upgrade(config, "head")
            command.check(config)
        yield test_url
    finally:
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True, if_exists=True))
        admin.dispose()


@pytest.fixture
def client(test_database_url):
    with TestClient(create_app(test_database_url), base_url="http://testserver/api/v1/") as client:
        yield client


@pytest.fixture
def crew(client):
    profile = client.post("mission-profiles", json={"name": "Test Station", "environment": "orbital_station"})
    assert profile.status_code == 201, profile.text
    member = client.post(
        "crew-members", json={"display_name": "Test Crew", "mission_profile_id": profile.json()["id"]}
    )
    assert member.status_code == 201, member.text
    return member.json()
