from uuid import UUID, uuid4

import pytest
from conftest import TEST_TENANT_ID, TEST_USER_ID
from test_api import auth_headers

from worktrace_api.database import SessionLocal
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    SOP,
    AnalyticsRunStatus,
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


def _add_recording(
    repo: Repository,
    workflow_id: UUID,
    workflow_name: str,
    *,
    reference: str,
    duration_ms: int,
    approved: bool = True,
) -> tuple[UUID, UUID, SOP]:
    recording = repo.create_recording(
        workflow_id=workflow_id,
        workflow_name=workflow_name,
        source_type=CaptureSource.DESKTOP,
        has_audio=False,
        reference=reference,
        recorded_by=USER_ID,
    )
    session = WorkflowSession(
        tenant_id=TENANT_ID,
        recording_id=recording.id,
        source_type=CaptureSource.DESKTOP,
        workflow_name=workflow_name,
        duration_ms=duration_ms,
        events=[
            SessionEvent(
                tenant_id=TENANT_ID,
                event_type=EventType.CLICK,
                application="WorkTrace test",
                target_label="Save",
                duration_ms=duration_ms,
            )
        ],
    )
    repo.save_session(session)
    repo.link_recording_session(
        recording.id,
        session.id,
        RecordingStatus.READY_FOR_REVIEW,
    )
    sop = repo.save_sop(
        SOP(
            tenant_id=TENANT_ID,
            source_session_id=session.id,
            status=SOPStatus.APPROVED if approved else SOPStatus.DRAFT,
            title=workflow_name,
            steps=[
                SOPStep(
                    position=1,
                    title="Save the form",
                    instruction="Select Save.",
                    observed_duration_ms=duration_ms,
                )
            ],
        )
    )
    return recording.id, session.id, sop


def test_eligibility_uses_latest_approved_sop_not_latest_draft(client):
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Close a ticket", created_by=USER_ID)
        first_id, first_session, approved = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Alice",
            duration_ms=4_000,
        )
        _, _, draft = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Not ready",
            duration_ms=9_000,
            approved=False,
        )
        second_id, _, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Bob",
            duration_ms=6_000,
        )
        # A regenerated draft for the first recording must not replace the
        # approved version used by analytics.
        repo.save_sop(
            draft.model_copy(
                update={
                    "id": uuid4(),
                    "source_session_id": first_session,
                    "version": 2,
                }
            )
        )

    response = client.get(
        f"/workflows/{workflow.id}/analytics/eligible-recordings",
        headers=auth_headers(),
    )
    assert response.status_code == 200
    eligible = {row["recording_id"]: row for row in response.json()}
    assert set(eligible) == {str(first_id), str(second_id)}
    assert eligible[str(first_id)]["sop_id"] == str(approved.id)
    assert eligible[str(first_id)]["sop_version"] == 1


def test_analytics_runs_snapshot_inputs_and_increment_versions():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Approve expenses", created_by=USER_ID)
        first_id, _, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Fast path",
            duration_ms=3_000,
        )
        second_id, _, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Careful path",
            duration_ms=7_000,
        )

        first = repo.create_analytics_run(
            workflow.id,
            [first_id, second_id],
            created_by=USER_ID,
            embedding_model="text-embedding-3-small",
            algorithm_version="1.0",
        )
        second = repo.create_analytics_run(
            workflow.id,
            [second_id, first_id],
            created_by=USER_ID,
            embedding_model="text-embedding-3-small",
            algorithm_version="1.0",
        )

        assert first.version == 1
        assert second.version == 2
        assert second.supersedes_run_id == first.id
        assert [item.recording_id for item in first.inputs] == [first_id, second_id]
        snapshots = repo.get_analytics_input_snapshots(first.id)
        assert snapshots[0]["reference"] == "Fast path"
        assert snapshots[0]["sop"]["steps"][0]["title"] == "Save the form"
        assert len(snapshots[0]["sop"]["steps"]) == 1


def test_analytics_run_rejects_unapproved_or_foreign_recordings():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Provision account", created_by=USER_ID)
        approved_id, _, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Approved",
            duration_ms=5_000,
        )
        draft_id, _, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Draft",
            duration_ms=6_000,
            approved=False,
        )

        with pytest.raises(ValueError, match="approved SOP"):
            repo.create_analytics_run(
                workflow.id,
                [approved_id, draft_id],
                created_by=USER_ID,
                embedding_model="text-embedding-3-small",
                algorithm_version="1.0",
            )


def test_analytics_run_api_queues_lists_and_retries(client, monkeypatch):
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        workflow = repo.create_workflow("Reconcile payment", created_by=USER_ID)
        first_id, _, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Path A",
            duration_ms=4_000,
        )
        second_id, _, _ = _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference="Path B",
            duration_ms=7_000,
        )

    queued = []
    monkeypatch.setattr(
        "worktrace_api.main.service_status",
        lambda _url: {"redis": "up", "worker": "up"},
    )
    monkeypatch.setattr(
        "worktrace_api.main.process_workflow_analytics.delay",
        lambda run_id, tenant_id: queued.append((run_id, tenant_id, "full")),
    )
    response = client.post(
        f"/workflows/{workflow.id}/analytics-runs",
        headers=auth_headers(),
        json={"recording_ids": [str(first_id), str(second_id)]},
    )
    assert response.status_code == 202
    run = response.json()
    assert run["status"] == "queued"
    assert run["version"] == 1
    assert queued == [(run["id"], TEST_TENANT_ID, "full")]

    listed = client.get(
        f"/workflows/{workflow.id}/analytics-runs", headers=auth_headers()
    )
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [run["id"]]
    fetched = client.get(f"/analytics-runs/{run['id']}", headers=auth_headers())
    assert fetched.status_code == 200
    assert len(fetched.json()["inputs"]) == 2

    # A summary-only retry is impossible before deterministic metrics exist.
    summary_retry = client.post(
        f"/analytics-runs/{run['id']}/retry",
        headers=auth_headers(),
        json={"target": "summary"},
    )
    assert summary_retry.status_code == 409

    with SessionLocal() as db:
        Repository(db, TENANT_ID).set_analytics_run_status(
            UUID(run["id"]),
            AnalyticsRunStatus.FAILED,
            failure_stage="embedding",
            error_message="failed",
        )
    full_retry = client.post(
        f"/analytics-runs/{run['id']}/retry",
        headers=auth_headers(),
        json={"target": "full_run"},
    )
    assert full_retry.status_code == 202
    assert full_retry.json()["status"] == "queued"
    assert queued[-1] == (run["id"], TEST_TENANT_ID, "full")
