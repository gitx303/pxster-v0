import os
import tempfile
from pathlib import Path

_directory = tempfile.TemporaryDirectory(prefix="pxster-tests-")
test_url = os.getenv("TEST_DATABASE_URL", "sqlite:///" + str(Path(_directory.name) / "test.db"))
if not test_url.startswith("sqlite") and not test_url.endswith("/pxster_test"):
    raise RuntimeError("External test database must be named pxster_test; tests erase its tables.")
os.environ.update(DATABASE_URL=test_url, DEMO_MODE="true", ALLOW_REGISTRATION="true", ENVIRONMENT="development", STORAGE_DRIVER="local", APP_ORIGIN="http://localhost:5173")

import pytest
from fastapi.testclient import TestClient
from pxster.api import app, auth_requests
from pxster.models import Base, engine


@pytest.fixture(autouse=True)
def clean_database(monkeypatch):
    monkeypatch.chdir(_directory.name)
    auth_requests.clear()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def client():
    with TestClient(app, headers={"Origin": "http://localhost:5173"}) as client:
        yield client


@pytest.fixture
def creator(client):
    assert client.post("/auth/register", json={"email": "creator@example.com", "password": "test-password-1234"}).status_code == 201
    return client
