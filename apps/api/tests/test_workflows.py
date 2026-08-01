from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from conftest import TEST_TENANT_ID, TEST_USER_ID
from test_api import auth_headers

from worktrace_api.auth import hash_access_token
from worktrace_api.backfill import group_recordings_into_workflows
from worktrace_api.database import (
    AccessTokenRecord,
    RecordingRecord,
    SessionLocal,
    TenantAccountRecord,
    UserRecord,
)
from worktrace_api.repository import Repository
from worktrace_api.schemas import CaptureSource, RecordingStatus

OTHER_TENANT_ID = "00000000-0000-4000-8000-000000000077"
OTHER_USER_ID = "00000000-0000-4000-8000-000000000076"
OTHER_TOKEN = "test-api-token-other-tenant"


def _other_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {OTHER_TOKEN}"}


def _seed_other_tenant() -> None:
    """Stand up a second tenant + user + token for isolation checks."""
    with SessionLocal() as db:
        db.add(TenantAccountRecord(id=OTHER_TENANT_ID, name="Other Co"))
        db.flush()
        db.add(
            UserRecord(
                id=OTHER_USER_ID,
                tenant_id=OTHER_TENANT_ID,
                email="other@example.test",
                password_hash="x",
                role="owner",
                is_active=True,
            )
        )
        db.flush()
        db.add(
            AccessTokenRecord(
                id=str(uuid4()),
                tenant_id=OTHER_TENANT_ID,
                user_id=OTHER_USER_ID,
                token_hash=hash_access_token(OTHER_TOKEN),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        db.commit()


def _create_recording(
    client,
    *,
    workflow_name=None,
    workflow_id=None,
    reference=None,
    has_audio=False,
    recording_id=None,
):
    payload: dict = {"has_audio": has_audio}
    if workflow_id is not None:
        payload["workflow_id"] = str(workflow_id)
    else:
        payload["workflow_name"] = workflow_name or "Expense reimbursement"
    if reference is not None:
        payload["reference"] = reference
    if recording_id is not None:
        payload["id"] = str(recording_id)
    response = client.post("/recordings", headers=auth_headers(), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_workflow_and_tenant_isolation(client):
    _seed_other_tenant()

    created = client.post(
        "/workflows",
        headers=auth_headers(),
        json={"name": "Expense reimbursement", "description": "Monthly expenses"},
    )
    assert created.status_code == 201
    workflow = created.json()
    assert workflow["name"] == "Expense reimbursement"
    assert workflow["recording_count"] == 0
    assert workflow["created_by"] == TEST_USER_ID

    # Duplicate name in the SAME tenant is rejected and points the user at the
    # existing workflow instead of producing a near-duplicate.
    duplicate = client.post(
        "/workflows", headers=auth_headers(), json={"name": "Expense reimbursement"}
    )
    assert duplicate.status_code == 409

    # The other tenant cannot see this workflow...
    other_list = client.get("/workflows", headers=_other_headers())
    assert other_list.status_code == 200
    assert other_list.json() == []

    # ...and cannot fetch it directly either.
    leaked = client.get(f"/workflows/{workflow['id']}", headers=_other_headers())
    assert leaked.status_code == 404

    own = client.get("/workflows", headers=auth_headers())
    assert own.status_code == 200
    assert [w["name"] for w in own.json()] == ["Expense reimbursement"]


def test_assign_recording_to_new_workflow(client):
    recording = _create_recording(client, workflow_name="Onboarding buddy")
    assert recording["workflow_id"]
    assert recording["recorded_by"] == TEST_USER_ID

    workflows = client.get("/workflows", headers=auth_headers()).json()
    assert len(workflows) == 1
    workflow = workflows[0]
    assert workflow["name"] == "Onboarding buddy"
    assert workflow["recording_count"] == 1
    assert workflow["user_count"] == 1
    assert workflow["last_recording_at"] is not None


def test_assign_recording_to_existing_workflow(client):
    workflow = client.post(
        "/workflows", headers=auth_headers(), json={"name": "Quarterly close"}
    ).json()

    recording = _create_recording(client, workflow_id=workflow["id"])
    assert recording["workflow_id"] == workflow["id"]

    fetched = client.get(f"/workflows/{workflow['id']}", headers=auth_headers()).json()
    assert fetched["recording_count"] == 1

    # Attaching to a workflow that does not exist (in this tenant) fails cleanly.
    response = client.post(
        "/recordings",
        headers=auth_headers(),
        json={"workflow_id": str(uuid4()), "has_audio": False},
    )
    assert response.status_code == 404


def test_recording_saves_reference_and_recorded_by(client):
    recording = _create_recording(
        client,
        workflow_name="Vendor onboarding",
        reference="Ticket #482 — Acme Corp",
    )
    assert recording["reference"] == "Ticket #482 — Acme Corp"
    assert recording["recorded_by"] == TEST_USER_ID

    fetched = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())
    assert fetched.status_code == 200
    assert fetched.json()["recording"]["reference"] == "Ticket #482 — Acme Corp"


def test_workflow_list_counts_are_grouped_without_n_plus_one(client):
    tenant_id = UUID(TEST_TENANT_ID)
    second_user = str(uuid4())
    with SessionLocal() as db:
        db.add(
            UserRecord(
                id=second_user,
                tenant_id=TEST_TENANT_ID,
                email="payroll@example.test",
                password_hash="x",
                role="member",
                is_active=True,
            )
        )
        db.commit()
        repo = Repository(db, tenant_id)
        workflow = repo.create_workflow("Payroll run")
        # Two recordings by the auth user, one by a second user, then flip the
        # oldest recording to ready_for_review so the processing/ready split is
        # exercised in a single grouped query.
        recording_ids = []
        for _ in range(2):
            rec = repo.create_recording(
                workflow_id=workflow.id,
                workflow_name=workflow.name,
                source_type=CaptureSource.DESKTOP,
                has_audio=False,
                recorded_by=UUID(TEST_USER_ID),
            )
            recording_ids.append(rec.id)
        repo.create_recording(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            source_type=CaptureSource.DESKTOP,
            has_audio=False,
            recorded_by=UUID(second_user),
        )
        repo.set_recording_status(recording_ids[0], RecordingStatus.READY_FOR_REVIEW)

    workflows = client.get("/workflows", headers=auth_headers()).json()
    assert len(workflows) == 1
    workflow = workflows[0]
    assert workflow["recording_count"] == 3
    assert workflow["user_count"] == 2
    assert workflow["processing_count"] == 2
    assert workflow["ready_count"] == 1


def test_duplicate_workflow_name_collapses_on_save(client):
    first = _create_recording(client, workflow_name="Desk setup")
    second = _create_recording(client, workflow_name="Desk setup")

    assert first["workflow_id"] == second["workflow_id"]

    workflows = client.get("/workflows", headers=auth_headers()).json()
    assert [w["name"] for w in workflows] == ["Desk setup"]
    assert workflows[0]["recording_count"] == 2


def test_failed_recording_save_leaves_no_empty_workflow(client):
    """Creating a workflow + recording must be atomic: if the recording insert
    fails (duplicate id under a different workflow), a newly created workflow
    is rolled back so the tenant is never left with an empty workflow."""
    shared_recording_id = uuid4()

    # First, successfully create workflow A and a recording with that id.
    _create_recording(client, workflow_name="Workflow A", recording_id=shared_recording_id)

    # Now try to create workflow B reusing the SAME recording id — the workflow
    # must be created and then rolled back together with the failed recording.
    response = client.post(
        "/recordings",
        headers=auth_headers(),
        json={"workflow_name": "Workflow B", "id": str(shared_recording_id)},
    )
    assert response.status_code == 409

    workflows = {w["name"]: w for w in client.get("/workflows", headers=auth_headers()).json()}
    assert set(workflows) == {"Workflow A"}
    assert workflows["Workflow A"]["recording_count"] == 1


def test_workflow_recordings_list_includes_reference_and_recorded_by(client):
    workflow = client.post(
        "/workflows", headers=auth_headers(), json={"name": "Release deploy"}
    ).json()
    recording = _create_recording(
        client, workflow_id=workflow["id"], reference="v2.4.0 hotfix"
    )

    rows = client.get(
        f"/workflows/{workflow['id']}/recordings", headers=auth_headers()
    ).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == recording["id"]
    assert row["reference"] == "v2.4.0 hotfix"
    assert row["recorded_by"] == TEST_USER_ID
    assert row["recorded_by_email"] == "owner@example.test"


def test_deleting_a_recording_updates_workflow_counts(client):
    recording = _create_recording(client, workflow_name="Solo flow")
    workflow_id = recording["workflow_id"]

    deleted = client.delete(f"/recordings/{recording['id']}", headers=auth_headers())
    assert deleted.status_code == 204

    workflow = client.get(f"/workflows/{workflow_id}", headers=auth_headers()).json()
    assert workflow["recording_count"] == 0


def test_resumable_retry_reuses_existing_workflow(client):
    """The resumable upload path re-POSTs the same recording id + workflow name.
    It must converge on the existing recording/workflow, not create duplicates."""
    recording_id = uuid4()
    first = _create_recording(client, workflow_name="Retry flow", recording_id=recording_id)

    retry = client.post(
        "/recordings",
        headers=auth_headers(),
        json={"workflow_name": "Retry flow", "id": str(recording_id)},
    )
    assert retry.status_code == 200
    assert retry.json()["id"] == first["id"]
    assert retry.json()["workflow_id"] == first["workflow_id"]

    workflows = client.get("/workflows", headers=auth_headers()).json()
    assert len(workflows) == 1
    assert workflows[0]["recording_count"] == 1


def test_backfill_groups_legacy_recordings_by_workflow_name():
    """Pre-existing recordings (workflow_name only, no workflow_id) are folded
    under one workflow per (tenant, name) without deleting any data."""
    tenant_id = UUID(TEST_TENANT_ID)
    with SessionLocal() as db:
        for name in ("Legacy flow", "Legacy flow", "Other legacy flow"):
            db.add(
                RecordingRecord(
                    id=str(uuid4()),
                    tenant_id=TEST_TENANT_ID,
                    workflow_name=name,
                    source_type="desktop",
                    status="ready_for_review",
                    uploaded_chunk_count=0,
                    uploaded_bytes=0,
                    has_audio=False,
                    created_at=datetime.now(UTC),
                )
            )
        db.commit()

    with SessionLocal() as db:
        group_recordings_into_workflows(db.connection())
        db.commit()

    with SessionLocal() as db:
        repo = Repository(db, tenant_id)
        workflows = {w.name: w for w in repo.list_workflows()}
    assert set(workflows) == {"Legacy flow", "Other legacy flow"}
    assert workflows["Legacy flow"].recording_count == 2
    assert workflows["Other legacy flow"].recording_count == 1

    # Idempotent: running it again changes nothing.
    with SessionLocal() as db:
        group_recordings_into_workflows(db.connection())
        db.commit()
    with SessionLocal() as db:
        again = Repository(db, tenant_id).list_workflows()
    assert sum(w.recording_count for w in again) == 3
