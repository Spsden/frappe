from uuid import UUID, uuid4

from conftest import TEST_TENANT_ID
from test_api import auth_headers
from test_sop_pipeline import _seed

from worktrace_api.database import SessionLocal
from worktrace_api.repository import Repository
from worktrace_api.schemas import SOP, SOPStatus, SOPStep

TENANT_ID = UUID(TEST_TENANT_ID)


def _draft_sop():
    recording_id, session_id, screenshot_id = uuid4(), uuid4(), uuid4()
    _seed(recording_id, session_id, screenshot_id)
    with SessionLocal() as db:
        sop = Repository(db, TENANT_ID).save_sop(
            SOP(
                tenant_id=TENANT_ID,
                source_session_id=session_id,
                status=SOPStatus.DRAFT,
                title="Submit an invoice",
                document="Send a reviewed invoice for approval.",
                steps=[
                    SOPStep(
                        position=1,
                        title="Submit invoice",
                        instruction="Select Submit.",
                        screenshot_reference=screenshot_id,
                        observed_duration_ms=1_500,
                    )
                ],
            )
        )
    return sop, screenshot_id


def _update_payload(sop, *, expected_revision=None, screenshot_id=None):
    step = sop.steps[0].model_copy(
        update={
            "title": "Review and submit",
            "instruction": "Review the total, then select Submit.",
            "screenshot_reference": screenshot_id or sop.steps[0].screenshot_reference,
        }
    )
    return {
        "expected_revision": expected_revision or sop.revision,
        "title": "Submit a reviewed invoice",
        "document": "Review the invoice before sending it for approval.",
        "steps": [step.model_dump(mode="json")],
        "change_summary": "Clarified the review step",
    }


def test_draft_edit_creates_revision_history(client):
    sop, _ = _draft_sop()

    response = client.patch(
        f"/sops/{sop.id}", headers=auth_headers(), json=_update_payload(sop)
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["revision"] == 2
    assert updated["title"] == "Submit a reviewed invoice"
    assert updated["steps"][0]["title"] == "Review and submit"

    history = client.get(f"/sops/{sop.id}/revisions", headers=auth_headers())
    assert history.status_code == 200
    assert [item["revision"] for item in history.json()] == [2, 1]
    assert history.json()[0]["change_summary"] == "Clarified the review step"


def test_stale_edit_is_rejected_without_overwriting_newer_content(client):
    sop, _ = _draft_sop()
    first = client.patch(
        f"/sops/{sop.id}", headers=auth_headers(), json=_update_payload(sop)
    )
    assert first.status_code == 200

    stale = client.patch(
        f"/sops/{sop.id}",
        headers=auth_headers(),
        json=_update_payload(sop, expected_revision=1),
    )

    assert stale.status_code == 409
    assert "current revision 2" in stale.json()["detail"]
    current = client.get(f"/sops/{sop.id}", headers=auth_headers()).json()
    assert current["title"] == "Submit a reviewed invoice"


def test_screenshot_reference_must_belong_to_the_source_session(client):
    sop, _ = _draft_sop()

    response = client.patch(
        f"/sops/{sop.id}",
        headers=auth_headers(),
        json=_update_payload(sop, screenshot_id=uuid4()),
    )

    assert response.status_code == 422
    assert "screenshot reference" in response.json()["detail"]


def test_approved_sop_is_immutable_and_clones_to_a_new_draft(client):
    sop, _ = _draft_sop()
    approved_response = client.post(
        f"/sops/{sop.id}/approval",
        headers=auth_headers(),
        json={"approved": True},
    )
    assert approved_response.status_code == 200
    approved = approved_response.json()
    assert approved["status"] == "approved"

    edit = client.patch(
        f"/sops/{sop.id}", headers=auth_headers(), json=_update_payload(sop)
    )
    assert edit.status_code == 409
    unapprove = client.post(
        f"/sops/{sop.id}/approval",
        headers=auth_headers(),
        json={"approved": False},
    )
    assert unapprove.status_code == 409

    cloned_response = client.post(
        f"/sops/{sop.id}/new-draft", headers=auth_headers()
    )
    assert cloned_response.status_code == 201
    cloned = cloned_response.json()
    assert cloned["status"] == "draft"
    assert cloned["version"] == approved["version"] + 1
    assert cloned["parent_sop_id"] == approved["id"]
    assert cloned["steps"][0]["id"] != approved["steps"][0]["id"]


def test_other_tenant_cannot_read_or_edit_sop_history():
    sop, _ = _draft_sop()
    other_tenant = UUID("00000000-0000-4000-8000-000000000077")
    with SessionLocal() as db:
        repo = Repository(db, other_tenant)
        assert repo.get_sop(sop.id) is None
        try:
            repo.list_sop_revisions(sop.id)
        except LookupError:
            pass
        else:
            raise AssertionError("Other tenant unexpectedly read SOP history")
