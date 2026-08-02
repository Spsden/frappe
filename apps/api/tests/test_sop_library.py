"""Tests for the tenant-wide SOP library listing.

Covers:
  - ``Repository.list_sops`` returns all SOPs for the tenant, newest first
  - optional status filter narrows the result
  - ``GET /sops`` exposes the same data with pagination + filter query params
  - tenant isolation: another tenant never sees another tenant's SOPs

These complement ``test_sop_pipeline.py`` (single-session behaviour) by
covering the cross-session library view backed by the same ``SOPRecord`` rows.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from conftest import TEST_TENANT_ID, TEST_USER_ID
from fastapi.testclient import TestClient

from worktrace_api.database import (
    RecordingRecord,
    SessionLocal,
    SOPRecord,
    TenantAccountRecord,
    WorkflowRecord,
    WorkflowSessionRecord,
)
from worktrace_api.main import app
from worktrace_api.repository import Repository

TENANT = TEST_TENANT_ID
OTHER_TENANT = "00000000-0000-4000-8000-000000000077"

AUTH_HEADERS = {"X-Tenant-ID": TENANT, "Authorization": "Bearer test-api-token"}


def _ensure_tenant(db, tenant_id: str) -> None:
    if db.get(TenantAccountRecord, tenant_id) is not None:
        return
    db.add(
        TenantAccountRecord(
            id=tenant_id,
            name=f"Tenant {tenant_id[:8]}",
        )
    )
    db.flush()


def _seed_session(db, tenant_id: str = TENANT, workflow_name: str = "Library flow") -> str:
    """Insert a minimal workflow_sessions row so SOP FK is satisfied."""
    _ensure_tenant(db, tenant_id)
    session_id = str(uuid4())
    db.add(
        WorkflowSessionRecord(
            id=session_id,
            tenant_id=tenant_id,
            recording_id=None,
            source_type="desktop",
            workflow_name=workflow_name,
            status="completed",
            typed_text_consent=True,
            consent_actor="Test Operator",
            consent_statement_version="2026-06",
            consented_at=datetime.now(UTC),
            external_ai_approved=False,
            duration_ms=1000,
            transcript=None,
            events=[],
            created_at=datetime.now(UTC),
        )
    )
    db.flush()
    return session_id


def _make_sop_record(
    *,
    tenant_id: str = TENANT,
    session_id: str,
    version: int = 1,
    status: str = "draft",
    title: str = "Library SOP",
    document: str | None = None,
    created_at: datetime | None = None,
) -> SOPRecord:
    return SOPRecord(
        id=str(uuid4()),
        tenant_id=tenant_id,
        source_session_id=session_id,
        version=version,
        status=status,
        title=title,
        document=document,
        steps=[
            {
                "position": 1,
                "title": "Open the app",
                "instruction": "Launch the target application.",
            }
        ],
        created_at=created_at or datetime.now(UTC),
    )


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


def test_list_sops_returns_all_tenant_sops_newest_first():
    db = SessionLocal()
    session_id = _seed_session(db)
    base = datetime.now(UTC)
    db.add(
        _make_sop_record(
            session_id=session_id,
            version=1,
            status="approved",
            title="Oldest",
            created_at=base - timedelta(hours=2),
        )
    )
    db.add(
        _make_sop_record(
            session_id=session_id,
            version=2,
            status="draft",
            title="Newest",
            created_at=base,
        )
    )
    db.commit()

    sops = Repository(db, TENANT).list_sops()
    db.close()

    assert [sop.title for sop in sops] == ["Newest", "Oldest"]


def test_list_sops_status_filter_narrows_results():
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(_make_sop_record(session_id=session_id, version=1, status="approved"))
    db.add(_make_sop_record(session_id=session_id, version=2, status="draft"))
    db.add(_make_sop_record(session_id=session_id, version=3, status="archived"))
    db.commit()

    repo = Repository(db, TENANT)
    approved = repo.list_sops(status="approved")
    drafts = repo.list_sops(status="draft")
    archived = repo.list_sops(status="archived")
    db.close()

    assert len(approved) == 1 and approved[0].status == "approved"
    assert len(drafts) == 1 and drafts[0].status == "draft"
    assert len(archived) == 1 and archived[0].status == "archived"


def test_list_sops_respects_limit_and_offset():
    db = SessionLocal()
    session_id = _seed_session(db)
    base = datetime.now(UTC)
    for index in range(5):
        db.add(
            _make_sop_record(
                session_id=session_id,
                version=index + 1,
                title=f"SOP {index}",
                created_at=base + timedelta(seconds=index),
            )
        )
    db.commit()

    repo = Repository(db, TENANT)
    page_one = repo.list_sops(limit=2, offset=0)
    page_two = repo.list_sops(limit=2, offset=2)
    db.close()

    assert [sop.title for sop in page_one] == ["SOP 4", "SOP 3"]
    assert [sop.title for sop in page_two] == ["SOP 2", "SOP 1"]


def test_list_sops_is_tenant_isolated():
    db = SessionLocal()
    owner_session = _seed_session(db, tenant_id=TENANT)
    other_session = _seed_session(db, tenant_id=OTHER_TENANT)
    db.add(_make_sop_record(tenant_id=TENANT, session_id=owner_session, title="Owner SOP"))
    db.add(
        _make_sop_record(tenant_id=OTHER_TENANT, session_id=other_session, title="Other SOP")
    )
    db.commit()

    owner_sops = Repository(db, TENANT).list_sops()
    other_sops = Repository(db, OTHER_TENANT).list_sops()
    db.close()

    assert [sop.title for sop in owner_sops] == ["Owner SOP"]
    assert [sop.title for sop in other_sops] == ["Other SOP"]


# ---------------------------------------------------------------------------
# HTTP endpoint
# ---------------------------------------------------------------------------


def test_get_sops_endpoint_returns_all_for_tenant():
    db = SessionLocal()
    approved_session = _seed_session(db)
    draft_session = _seed_session(db)
    db.add(_make_sop_record(session_id=approved_session, status="approved", title="Approved SOP"))
    db.add(_make_sop_record(session_id=draft_session, status="draft", title="Draft SOP"))
    db.commit()
    db.close()

    with TestClient(app) as client:
        response = client.get("/sops", headers=AUTH_HEADERS)

    assert response.status_code == 200
    titles = {item["title"] for item in response.json()}
    assert titles == {"Approved SOP", "Draft SOP"}


def test_get_sops_endpoint_includes_recording_context():
    db = SessionLocal()
    now = datetime.now(UTC)
    workflow_id = str(uuid4())
    recording_id = str(uuid4())
    session_id = str(uuid4())
    db.add(
        WorkflowRecord(
            id=workflow_id,
            tenant_id=TENANT,
            name="Expense approval",
            description=None,
            created_by=TEST_USER_ID,
            created_at=now,
            updated_at=now,
        )
    )
    db.flush()
    db.add(
        RecordingRecord(
            id=recording_id,
            tenant_id=TENANT,
            session_id=None,
            workflow_id=workflow_id,
            source_type="desktop",
            workflow_name="Expense approval",
            reference="Sydney finance team",
            recorded_by=TEST_USER_ID,
            status="completed",
            expected_chunk_count=1,
            uploaded_chunk_count=1,
            uploaded_bytes=1024,
            has_audio=False,
            manual_mode=False,
            custom_sop_instruction=None,
            error_message=None,
            created_at=now,
            completed_at=now,
        )
    )
    db.flush()
    db.add(
        WorkflowSessionRecord(
            id=session_id,
            tenant_id=TENANT,
            recording_id=recording_id,
            source_type="desktop",
            workflow_name="Expense approval",
            status="completed",
            typed_text_consent=True,
            consent_actor="Test Operator",
            consent_statement_version="2026-06",
            consented_at=now,
            external_ai_approved=False,
            duration_ms=42_000,
            transcript=None,
            events=[],
            created_at=now,
        )
    )
    db.flush()
    db.add(
        _make_sop_record(
            session_id=session_id,
            status="approved",
            title="Approve an expense",
            created_at=now,
        )
    )
    db.commit()
    db.close()

    with TestClient(app) as client:
        response = client.get("/sops", headers=AUTH_HEADERS)

    assert response.status_code == 200
    [item] = response.json()
    assert item["workflow_id"] == workflow_id
    assert item["workflow_name"] == "Expense approval"
    assert item["recording_id"] == recording_id
    assert item["recording_reference"] == "Sydney finance team"
    assert item["recorded_by"] == TEST_USER_ID
    assert item["recorded_by_email"] == "owner@example.test"
    assert item["recording_created_at"] is not None
    assert item["session_duration_ms"] == 42_000


def test_get_sops_endpoint_supports_status_filter():
    db = SessionLocal()
    approved_session = _seed_session(db)
    draft_session = _seed_session(db)
    db.add(_make_sop_record(session_id=approved_session, status="approved", title="Approved SOP"))
    db.add(_make_sop_record(session_id=draft_session, status="draft", title="Draft SOP"))
    db.commit()
    db.close()

    with TestClient(app) as client:
        response = client.get("/sops", headers=AUTH_HEADERS, params={"status": "approved"})

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["title"] == "Approved SOP"
    assert payload[0]["status"] == "approved"


def test_get_sops_endpoint_rejects_invalid_status():
    with TestClient(app) as client:
        response = client.get("/sops", headers=AUTH_HEADERS, params={"status": "bogus"})

    assert response.status_code == 422


def test_get_sops_endpoint_requires_auth():
    with TestClient(app) as client:
        response = client.get("/sops")

    assert response.status_code == 401
