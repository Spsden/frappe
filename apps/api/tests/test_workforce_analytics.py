from uuid import UUID, uuid4

import pytest
from conftest import TEST_TENANT_ID, TEST_USER_ID
from test_api import auth_headers
from test_workflow_analytics import _add_recording

from worktrace_api.database import SessionLocal, TenantAccountRecord
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    SOP,
    AnalyticsRunMode,
    CaptureSource,
    EventType,
    RecordingStatus,
    SessionEvent,
    SOPStatus,
    SOPStep,
    WorkflowSession,
)

TENANT_ID = UUID(TEST_TENANT_ID)
USER_ID = UUID(TEST_USER_ID)
OTHER_TENANT_ID = "00000000-0000-4000-8000-000000000077"


def _ensure_other_tenant(db) -> None:
    if db.get(TenantAccountRecord, OTHER_TENANT_ID) is None:
        db.add(TenantAccountRecord(id=OTHER_TENANT_ID, name="Other Co"))
        db.flush()


def _seed_eligible(repo, workflow, count, *, start_index=0):
    pairs = []
    for offset in range(count):
        recording_id, session_id, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference=f"R{start_index + offset}",
            duration_ms=3_000 + offset * 500,
        )
        pairs.append((recording_id, session_id))
    return pairs


def _seed_eligible_for_tenant(repo, tenant_id, workflow, count):
    """Tenant-aware variant: ``_add_recording`` hardcodes the test owner tenant,
    so cross-tenant isolation tests need recordings built with the other tenant.
    """
    pairs = []
    for offset in range(count):
        recording = repo.create_recording(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            source_type=CaptureSource.DESKTOP,
            has_audio=False,
            reference=f"Other R{offset}",
            recorded_by=None,
        )
        session = WorkflowSession(
            tenant_id=tenant_id,
            recording_id=recording.id,
            source_type=CaptureSource.DESKTOP,
            workflow_name=workflow.name,
            duration_ms=4_000 + offset * 500,
            events=[
                SessionEvent(
                    tenant_id=tenant_id,
                    event_type=EventType.CLICK,
                    application="WorkTrace test",
                    target_label="Save",
                    duration_ms=4_000,
                )
            ],
        )
        repo.save_session(session)
        repo.link_recording_session(recording.id, session.id, RecordingStatus.READY_FOR_REVIEW)
        repo.save_sop(
            SOP(
                tenant_id=tenant_id,
                source_session_id=session.id,
                status=SOPStatus.APPROVED,
                title=workflow.name,
                steps=[
                    SOPStep(
                        position=1,
                        title="Save the form",
                        instruction="Select Save.",
                        observed_duration_ms=4_000,
                    )
                ],
            )
        )
        pairs.append((recording.id, session.id))
    return pairs


def test_workforce_run_freezes_every_eligible_recording():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Onboard employee", created_by=USER_ID)
        _seed_eligible(repo, workflow, 8)

        run = repo.create_analytics_run(
            workflow.id,
            mode=AnalyticsRunMode.WORKFORCE,
            created_by=USER_ID,
            embedding_model="text-embedding-3-small",
            algorithm_version="workforce-v1",
        )

    assert run.mode == AnalyticsRunMode.WORKFORCE
    assert run.input_count == 8
    with SessionLocal() as db:
        snapshots = Repository(db, TENANT_ID).get_analytics_input_snapshots(run.id)
    assert [item["position"] for item in snapshots] == list(range(1, 9))
    # Identity is preserved locally for UI display, never sent to the provider.
    assert all(item.get("reference") for item in snapshots)


def test_workforce_below_minimum_returns_selected_comparison_hint():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Tiny workflow", created_by=USER_ID)
        _seed_eligible(repo, workflow, 3)

        with pytest.raises(ValueError) as exc:
            repo.create_analytics_run(
                workflow.id,
                mode=AnalyticsRunMode.WORKFORCE,
                created_by=USER_ID,
                embedding_model="text-embedding-3-small",
                algorithm_version="workforce-v1",
            )
    assert "at least 6" in str(exc.value)
    assert "Selected comparison" in str(exc.value)


def test_workforce_caps_at_fifty_recordings():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Big workflow", created_by=USER_ID)
        _seed_eligible(repo, workflow, 60)

        run = repo.create_analytics_run(
            workflow.id,
            mode=AnalyticsRunMode.WORKFORCE,
            created_by=USER_ID,
            embedding_model="text-embedding-3-small",
            algorithm_version="workforce-v1",
        )
    assert run.input_count == 50


def test_workforce_ignores_drafts_and_uses_latest_approved():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Drafts excluded", created_by=USER_ID)
        pairs = _seed_eligible(repo, workflow, 6)
        first_session = pairs[0][1]
        # A session with only a draft (no approval) must not be picked up.
        _draft_recording_id, draft_session_id, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Only draft",
            duration_ms=9_000,
            approved=False,
        )
        # A newer draft for an already-approved session must not displace it.
        repo.save_sop(
            SOP(
                tenant_id=TENANT_ID,
                source_session_id=first_session,
                status=SOPStatus.DRAFT,
                title="Regen draft",
                steps=[SOPStep(position=1, title="Step", instruction="Do it")],
                version=2,
            )
        )

        run = repo.create_analytics_run(
            workflow.id,
            mode=AnalyticsRunMode.WORKFORCE,
            created_by=USER_ID,
            embedding_model="text-embedding-3-small",
            algorithm_version="workforce-v1",
        )
    assert run.input_count == 6
    involved_sessions = {str(item.session_id) for item in run.inputs}
    assert str(draft_session_id) not in involved_sessions


def test_other_tenant_recordings_are_invisible_to_workforce():
    other_tenant = UUID(OTHER_TENANT_ID)
    with SessionLocal() as db:
        _ensure_other_tenant(db)
        owner_repo = Repository(db, TENANT_ID)
        other_repo = Repository(db, other_tenant)
        owner_workflow = owner_repo.create_workflow("Owner flow", created_by=USER_ID)
        other_workflow = other_repo.create_workflow("Owner flow", created_by=None)
        _seed_eligible(owner_repo, owner_workflow, 6)
        _seed_eligible_for_tenant(other_repo, other_tenant, other_workflow, 6)

        # Other tenant cannot see owner's eligible recordings.
        assert other_repo.list_analytics_eligible_recordings(owner_workflow.id) == []
        # And cannot create a workforce run over the owner's workflow (404 path).
        with pytest.raises(LookupError):
            other_repo.create_analytics_run(
                owner_workflow.id,
                mode=AnalyticsRunMode.WORKFORCE,
                created_by=None,
                embedding_model="text-embedding-3-small",
                algorithm_version="workforce-v1",
            )
        # Owner likewise cannot reach the other tenant's workflow.
        with pytest.raises(LookupError):
            owner_repo.create_analytics_run(
                other_workflow.id,
                mode=AnalyticsRunMode.WORKFORCE,
                created_by=USER_ID,
                embedding_model="text-embedding-3-small",
                algorithm_version="workforce-v1",
            )


def test_workforce_run_api_rejects_explicit_ids_and_accepts_mode(client, monkeypatch):
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Api workforce", created_by=USER_ID)
        _seed_eligible(repo, workflow, 6)

    monkeypatch.setattr(
        "worktrace_api.main.service_status",
        lambda _url: {"redis": "up", "worker": "up"},
    )
    queued = []
    monkeypatch.setattr(
        "worktrace_api.main.process_workflow_analytics.delay",
        lambda run_id, tenant_id: queued.append((run_id, tenant_id)),
    )

    # Explicit recording_ids are rejected for workforce mode.
    rejected = client.post(
        f"/workflows/{workflow.id}/analytics-runs",
        headers=auth_headers(),
        json={"mode": "workforce", "recording_ids": [str(uuid4())]},
    )
    assert rejected.status_code == 422

    accepted = client.post(
        f"/workflows/{workflow.id}/analytics-runs",
        headers=auth_headers(),
        json={"mode": "workforce"},
    )
    assert accepted.status_code == 202
    run = accepted.json()
    assert run["mode"] == "workforce"
    assert run["input_count"] == 6
    assert queued and queued[0][0] == run["id"]


def test_workforce_run_api_reports_minimum_as_conflict(client, monkeypatch):
    monkeypatch.setattr(
        "worktrace_api.main.service_status",
        lambda _url: {"redis": "up", "worker": "up"},
    )
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Too small", created_by=USER_ID)
        _seed_eligible(repo, workflow, 4)

    response = client.post(
        f"/workflows/{workflow.id}/analytics-runs",
        headers=auth_headers(),
        json={"mode": "workforce"},
    )
    assert response.status_code == 409
    assert "at least 6" in response.json()["detail"]
    assert "Selected comparison" in response.json()["detail"]
