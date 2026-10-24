from dataclasses import replace
from pathlib import Path
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.core import Settings
from app.main import create_app


def initialize(settings):
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["settings"] = settings
    command.upgrade(config, "head")


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path, maintenance=False)


@pytest.fixture
def app(settings):
    initialize(settings)
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        client.headers["origin"] = "http://127.0.0.1:8787"
        yield client


def signup(client, username="fixture_user"):
    response = client.post("/api/account/register", json={"username": username, "password": "test-password-only"})
    assert response.status_code == 200, response.text
    return response.json()["user"]["id"]
