"""Tests for the cross-entity search endpoint (GET /search?q=).

Covers:
  - title / document / step text matches on SOPs
  - workflow_name matches on sessions
  - matched_field reporting (title vs document vs step vs workflow_name)
  - tenant isolation: another tenant never sees another tenant's hits
  - empty query returns an empty result set
  - auth required
"""

from datetime import UTC, datetime
from uuid import uuid4

from conftest import TEST_TENANT_ID
from fastapi.testclient import TestClient

from worktrace_api.database import (
    SessionLocal,
    SOPRecord,
    TenantAccountRecord,
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
    db.add(TenantAccountRecord(id=tenant_id, name=f"Tenant {tenant_id[:8]}"))
    db.flush()


def _seed_session(db, tenant_id: str = TENANT, workflow_name: str = "Library flow") -> str:
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
            duration_ms=125000,
            transcript=None,
            events=[],
            created_at=datetime.now(UTC),
        )
    )
    db.flush()
    return session_id


def _make_sop(
    *,
    tenant_id: str = TENANT,
    session_id: str,
    title: str = "Library SOP",
    document: str | None = None,
    steps: list[dict] | None = None,
    status: str = "draft",
    version: int = 1,
) -> SOPRecord:
    return SOPRecord(
        id=str(uuid4()),
        tenant_id=tenant_id,
        source_session_id=session_id,
        version=version,
        status=status,
        title=title,
        document=document,
        steps=steps
        or [
            {"position": 1, "title": "Open the app", "instruction": "Launch it."},
        ],
        created_at=datetime.now(UTC),
    )


def _titles(response_json, kind=None):
    return [
        item["title"]
        for item in response_json["results"]
        if kind is None or item["kind"] == kind
    ]


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


def test_repo_search_matches_sop_title():
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(_make_sop(session_id=session_id, title="Invoice approval flow"))
    db.add(_make_sop(session_id=session_id, title="Onboarding checklist", version=2))
    db.commit()

    results = Repository(db, TENANT).search("invoice")
    db.close()

    assert [r.title for r in results.results] == ["Invoice approval flow"]
    assert results.results[0].kind == "sop"
    assert results.results[0].matched_field == "title"


def test_repo_search_matches_sop_document():
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(
        _make_sop(
            session_id=session_id,
            title="Quarterly close",
            document="Covers the invoice reconciliation step in detail.",
        )
    )
    db.commit()

    results = Repository(db, TENANT).search("reconciliation")
    db.close()

    assert len(results.results) == 1
    assert results.results[0].matched_field == "document"


def test_repo_search_matches_sop_step_text():
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(
        _make_sop(
            session_id=session_id,
            title="Generic procedure",
            document=None,
            steps=[
                {"position": 1, "title": "Start", "instruction": "Do something."},
                {
                    "position": 2,
                    "title": "Export the ledger",
                    "instruction": "Choose File then Export.",
                },
            ],
        )
    )
    db.commit()

    results = Repository(db, TENANT).search("ledger")
    db.close()

    assert len(results.results) == 1
    assert results.results[0].title == "Generic procedure"
    assert results.results[0].matched_field == "step"
    assert "ledger" in (results.results[0].subtitle or "")


def test_repo_search_matches_session_workflow_name():
    db = SessionLocal()
    _seed_session(db, workflow_name="Payroll run")
    _seed_session(db, workflow_name="Expenses")
    db.commit()

    results = Repository(db, TENANT).search("payroll")
    db.close()

    assert len(results.results) == 1
    assert results.results[0].kind == "session"
    assert results.results[0].title == "Payroll run"
    assert results.results[0].matched_field == "workflow_name"


def test_repo_search_dedupes_sop_across_title_and_step():
    """A SOP matching on title AND a step should be returned once, as a title hit."""
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(
        _make_sop(
            session_id=session_id,
            title="Invoice workflow",
            steps=[
                {
                    "position": 1,
                    "title": "Invoice entry",
                    "instruction": "Type the invoice number.",
                },
            ],
        )
    )
    db.commit()

    results = Repository(db, TENANT).search("invoice")
    db.close()

    assert len(results.results) == 1
    assert results.results[0].matched_field == "title"


def test_repo_search_empty_query_returns_nothing():
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(_make_sop(session_id=session_id, title="Anything"))
    db.commit()

    results = Repository(db, TENANT).search("   ")
    db.close()

    assert results.results == []


def test_repo_search_is_tenant_isolated():
    db = SessionLocal()
    owner_session = _seed_session(db, tenant_id=TENANT, workflow_name="Owner flow")
    other_session = _seed_session(db, tenant_id=OTHER_TENANT, workflow_name="Other flow")
    db.add(_make_sop(tenant_id=TENANT, session_id=owner_session, title="Owner invoice"))
    db.add(_make_sop(tenant_id=OTHER_TENANT, session_id=other_session, title="Other invoice"))
    db.commit()

    owner = Repository(db, TENANT).search("invoice")
    other = Repository(db, OTHER_TENANT).search("invoice")
    db.close()

    assert [r.title for r in owner.results] == ["Owner invoice"]
    assert [r.title for r in other.results] == ["Other invoice"]


# ---------------------------------------------------------------------------
# HTTP endpoint
# ---------------------------------------------------------------------------


def test_search_endpoint_returns_grouped_hits():
    db = SessionLocal()
    session_id = _seed_session(db, workflow_name="Invoice approval")
    db.add(_make_sop(session_id=session_id, title="Invoice SOP", status="approved"))
    db.commit()
    db.close()

    with TestClient(app) as client:
        response = client.get("/search", headers=AUTH_HEADERS, params={"q": "invoice"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "invoice"
    titles = {item["title"] for item in payload["results"]}
    assert "Invoice SOP" in titles
    assert "Invoice approval" in titles
    kinds = {item["kind"] for item in payload["results"]}
    assert kinds == {"sop", "session"}


def test_search_endpoint_reports_matched_field():
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(_make_sop(session_id=session_id, title="Taxes", document=" mentions GST reconciliation"))
    db.commit()
    db.close()

    with TestClient(app) as client:
        response = client.get("/search", headers=AUTH_HEADERS, params={"q": "gst"})

    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    assert results[0]["matched_field"] == "document"


def test_search_endpoint_empty_query_is_empty():
    with TestClient(app) as client:
        response = client.get("/search", headers=AUTH_HEADERS, params={"q": ""})

    assert response.status_code == 200
    assert response.json()["results"] == []


def test_search_endpoint_requires_auth():
    with TestClient(app) as client:
        response = client.get("/search", params={"q": "anything"})

    assert response.status_code == 401


def test_search_endpoint_sop_hit_carries_source_session_for_routing():
    db = SessionLocal()
    session_id = _seed_session(db)
    db.add(_make_sop(session_id=session_id, title="Reimbursable expenses"))
    db.commit()
    db.close()

    with TestClient(app) as client:
        response = client.get("/search", headers=AUTH_HEADERS, params={"q": "reimbursable"})

    assert response.status_code == 200
    sop_hit = next(r for r in response.json()["results"] if r["kind"] == "sop")
    assert sop_hit["source_session_id"] == session_id
