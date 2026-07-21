import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

TEST_DATABASE = Path(__file__).parent / "test.sqlite3"
os.environ["WORKTRACE_DATABASE_URL"] = f"sqlite:///{TEST_DATABASE.as_posix()}"
os.environ["WORKTRACE_RECORDING_STORAGE_PATH"] = str(Path(__file__).parent / "data" / "recordings")
os.environ["WORKTRACE_AI_PROVIDER"] = "local"
os.environ["WORKTRACE_ALLOWED_DOMAINS"] = "example.test"
os.environ["WORKTRACE_REDIS_URL"] = "redis://127.0.0.1:1/0"

import pytest
from fastapi.testclient import TestClient

from worktrace_api.auth import hash_access_token, hash_password
from worktrace_api.database import (
    AccessTokenRecord,
    Base,
    SessionLocal,
    TenantAccountRecord,
    UserRecord,
    engine,
)
from worktrace_api.main import app

TEST_TENANT_ID = "00000000-0000-4000-8000-000000000099"
TEST_USER_ID = "00000000-0000-4000-8000-000000000098"
TEST_TOKEN = "test-api-token"


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        db.add(
            TenantAccountRecord(
                id=TEST_TENANT_ID,
                name="Test Company",
            )
        )
        db.flush()
        db.add(
            UserRecord(
                id=TEST_USER_ID,
                tenant_id=TEST_TENANT_ID,
                email="owner@example.test",
                password_hash=hash_password("test-password-123"),
                role="owner",
                is_active=True,
            )
        )
        db.flush()
        db.add(
            AccessTokenRecord(
                id="00000000-0000-4000-8000-000000000097",
                tenant_id=TEST_TENANT_ID,
                user_id=TEST_USER_ID,
                token_hash=hash_access_token(TEST_TOKEN),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        db.commit()
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    TEST_DATABASE.unlink(missing_ok=True)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
