"""Tests for the production SOP generation pipeline.

These cover the behaviours the refactor guarantees:
  - structured SOP is persisted as a single draft (document + branches)
  - no fake "full document" markdown version is ever stored
  - the reviewer's custom instruction reaches the generation inputs
  - LLM/validation failures land on ``sop_failed`` (never generic ``failed``)
    and are retryable / idempotent
  - tenant isolation is preserved

Pure provider functions are unit-tested directly; the Celery task is exercised
by calling it directly with the provider monkeypatched (no broker / no LLM).
"""

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tests.conftest import TEST_TENANT_ID
from worktrace_api.database import RecordingRecord, ScreenshotRecord, SessionLocal
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    EventType,
    RecordingStatus,
    Screenshot,
    SessionEvent,
    WorkflowSession,
)
from worktrace_api.sop_provider import (
    SOPProviderError,
    build_evidence_bundle,
    build_generation_messages,
    generated_to_sop,
    parse_generated_sop,
)
from worktrace_api.tasks import sop_generation

TENANT = UUID(TEST_TENANT_ID)

VALID_SOP_JSON = json.dumps(
    {
        "title": "Submit invoice",
        "document": "How to submit an invoice for approval.",
        "steps": [
            {
                "position": 1,
                "title": "Open invoices",
                "instruction": "Open the Invoices app.",
                "warning": None,
                "estimated_time_ms": 1200,
                "decision_branches": [],
            },
            {
                "position": 2,
                "title": "Submit",
                "instruction": "Click the Submit button.",
                "warning": "Confirm totals first.",
                "estimated_time_ms": None,
                "decision_branches": [
                    {"condition": "Total > 1000", "action": "Require manager approval"}
                ],
            },
        ],
    }
)


class _FakeProvider:
    """Stand-in for SOPProvider that returns a canned JSON response."""

    def __init__(self, settings, payload=VALID_SOP_JSON, available=True, error=None):
        self._payload = payload
        self._available = available
        self._error = error

    @property
    def available(self) -> bool:
        return self._available

    def complete(self, messages, **kwargs) -> str:
        if self._error is not None:
            raise self._error
        return self._payload


def _seed(recording_id, session_id, screenshot_id, *, custom_instruction=None):
    """Insert a recording + session + one annotated screenshot for TENANT."""
    db = SessionLocal()
    db.add(
        RecordingRecord(
            id=str(recording_id),
            tenant_id=str(TENANT),
            source_type="desktop",
            workflow_name="Submit invoice",
            status=RecordingStatus.GENERATING_SOP,
            uploaded_chunk_count=0,
            uploaded_bytes=0,
            has_audio=False,
            manual_mode=False,
            custom_sop_instruction=custom_instruction,
            created_at=datetime.now(UTC),
        )
    )
    db.commit()
    repo = Repository(db, TENANT)
    repo.save_session(
        WorkflowSession(
            tenant_id=TENANT,
            id=session_id,
            recording_id=recording_id,
            workflow_name="Submit invoice",
            duration_ms=2400,
            events=[
                SessionEvent(
                    tenant_id=TENANT,
                    sequence=1,
                    timestamp=datetime.now(UTC),
                    event_type=EventType.CLICK,
                    application="ERP Desktop",
                    window_title="Invoices",
                    target_label="Submit",
                    duration_ms=1500,
                    before_screenshot_id=screenshot_id,
                )
            ],
        )
    )
    db.add(
        ScreenshotRecord(
            id=str(screenshot_id),
            tenant_id=str(TENANT),
            recording_id=str(recording_id),
            session_id=str(session_id),
            sequence=1,
            captured_at=datetime.now(UTC),
            storage_key="raw.png",
            media_type="image/png",
            width=10,
            height=10,
            change_score=0.1,
            content_hash="a" * 64,
            redaction_status="redacted",
            annotated_storage_key="annotated.png",
            created_at=datetime.now(UTC),
        )
    )
    db.commit()
    db.close()


def _patch_provider(monkeypatch, **kwargs):
    fake = _FakeProvider(None, **kwargs)
    monkeypatch.setattr(sop_generation, "SOPProvider", lambda settings: fake)
    # Avoid touching the filesystem during tests.
    monkeypatch.setattr(sop_generation, "encode_evidence_images", lambda bundle, storage: {})
    return fake


# ---------------------------------------------------------------------------
# Pure provider functions
# ---------------------------------------------------------------------------


def _bundle(custom_instruction=None):
    session = WorkflowSession(
        tenant_id=TENANT,
        workflow_name="Submit invoice",
        duration_ms=2400,
        events=[
            SessionEvent(
                tenant_id=TENANT,
                sequence=1,
                timestamp=datetime.now(UTC),
                event_type=EventType.CLICK,
                application="ERP",
                window_title="Invoices",
                target_label="Submit",
                duration_ms=1500,
                before_screenshot_id=UUID("00000000-0000-4000-8000-000000000001"),
            )
        ],
    )
    screenshot = Screenshot(
        tenant_id=TENANT,
        id=UUID("00000000-0000-4000-8000-000000000001"),
        recording_id=UUID("00000000-0000-4000-8000-000000000002"),
        sequence=1,
        captured_at=datetime.now(UTC),
        storage_key="raw.png",
        width=1920,
        height=1080,
        content_hash="a" * 64,
        change_score=0.1,
        redaction_status="redacted",
        annotated_storage_key="annotated.png",
    )
    return build_evidence_bundle(session, [screenshot], custom_instruction)


def test_custom_instruction_reaches_generation_inputs():
    bundle = _bundle(custom_instruction="Keep it concise for finance.")

    assert bundle.custom_instruction == "Keep it concise for finance."

    messages = build_generation_messages(bundle, image_data_uris={})
    prompt = json.dumps(messages)

    # The instruction is framed as bounded reviewer guidance, and the prompt
    # explicitly forbids inventing evidence (privacy/accuracy safeguard).
    assert "Keep it concise for finance." in prompt
    assert "REVIEWER GUIDANCE" in prompt
    assert "Do NOT invent" in prompt


def test_prompt_prefers_labels_over_coordinates():
    bundle = _bundle()
    prompt = json.dumps(build_generation_messages(bundle, image_data_uris={}))

    # Visible label + window title appear; raw coordinates are never requested.
    assert "Submit" in prompt
    assert "Invoices" in prompt
    assert "coordinates" in prompt.lower()


def test_parse_generated_sop_accepts_valid_output():
    generated = parse_generated_sop(VALID_SOP_JSON)
    assert generated.title == "Submit invoice"
    assert generated.document.startswith("How to submit")
    assert len(generated.steps) == 2
    assert generated.steps[1].decision_branches[0].condition == "Total > 1000"


def test_parse_generated_sop_rejects_invalid_json():
    with pytest.raises(ValueError, match="not valid JSON"):
        parse_generated_sop("<<not json>>")


def test_parse_generated_sop_rejects_empty_steps():
    bad = json.dumps({"title": "x", "document": None, "steps": []})
    with pytest.raises(ValueError, match="validation"):
        parse_generated_sop(bad)


def test_generated_to_sop_renumbers_and_maps_screenshots():
    bundle = _bundle()
    generated = parse_generated_sop(VALID_SOP_JSON)
    sop = generated_to_sop(
        generated,
        bundle,
        tenant_id=TENANT,
        session_id=UUID("00000000-0000-4000-8000-000000000003"),
    )

    assert [step.position for step in sop.steps] == [1, 2]
    # Screenshot reference comes from the evidence by position, not invented.
    assert sop.steps[0].screenshot_reference == bundle.steps[0].screenshot_id
    # Ground-truth duration overrides the model's guess for step 1.
    assert sop.steps[0].estimated_time_ms == 1500
    assert sop.steps[1].decision_branches[0].action == "Require manager approval"


# ---------------------------------------------------------------------------
# Task behaviour (provider monkeypatched)
# ---------------------------------------------------------------------------


def test_structured_sop_persisted_as_single_draft(monkeypatch):
    _patch_provider(monkeypatch)
    recording_id, session_id, screenshot_id = uuid4(), uuid4(), uuid4()
    _seed(recording_id, session_id, screenshot_id)

    sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))

    db = SessionLocal()
    repo = Repository(db, TENANT)
    recording = repo.get_recording(recording_id)
    sops = repo.list_sops_for_session(session_id)
    db.close()

    assert recording.status == RecordingStatus.READY_FOR_REVIEW
    assert recording.error_message is None
    assert len(sops) == 1
    sop = sops[0]
    assert sop.document.startswith("How to submit")
    assert sop.steps[0].screenshot_reference == screenshot_id
    assert sop.steps[1].decision_branches[0].condition == "Total > 1000"


def test_no_fake_markdown_version_is_created(monkeypatch):
    _patch_provider(monkeypatch)
    recording_id, session_id, screenshot_id = uuid4(), uuid4(), uuid4()
    _seed(recording_id, session_id, screenshot_id)

    sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))

    db = SessionLocal()
    sops = Repository(db, TENANT).list_sops_for_session(session_id)
    db.close()

    assert len(sops) == 1
    assert not sops[0].title.endswith("Full Document")
    assert not any(step.title == "Full SOP Document" for step in sops[0].steps)


def test_retry_replaces_draft_idempotently(monkeypatch):
    _patch_provider(monkeypatch)
    recording_id, session_id, screenshot_id = uuid4(), uuid4(), uuid4()
    _seed(recording_id, session_id, screenshot_id)

    # Run twice (simulates a retry / regenerate). A single draft replaces the
    # previous one — drafts never stack.
    for _ in range(2):
        sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))

    db = SessionLocal()
    sops = Repository(db, TENANT).list_sops_for_session(session_id)
    db.close()
    assert len(sops) == 1


def test_sop_failure_becomes_sop_failed(monkeypatch):
    _patch_provider(monkeypatch, error=SOPProviderError("boom"))
    recording_id, session_id, screenshot_id = uuid4(), uuid4(), uuid4()
    _seed(recording_id, session_id, screenshot_id)

    # Simulate retries already exhausted so the task fails terminally without
    # calling self.retry (which would need a broker).
    sop_generation.generate_sop_with_ai.push_request(
        retries=sop_generation.generate_sop_with_ai.max_retries
    )
    try:
        sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))
    finally:
        sop_generation.generate_sop_with_ai.pop_request()

    db = SessionLocal()
    repo = Repository(db, TENANT)
    recording = repo.get_recording(recording_id)
    sops = repo.list_sops_for_session(session_id)
    db.close()

    assert recording.status == RecordingStatus.SOP_FAILED
    # Useful, non-sensitive message; no raw provider trace leaked.
    assert recording.error_message is not None
    assert "boom" not in recording.error_message
    # No broken draft left behind on failure.
    assert sops == []


def test_missing_api_key_fails_as_sop_failed(monkeypatch):
    _patch_provider(monkeypatch, available=False)
    recording_id, session_id, screenshot_id = uuid4(), uuid4(), uuid4()
    _seed(recording_id, session_id, screenshot_id)

    sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))

    db = SessionLocal()
    repo = Repository(db, TENANT)
    recording = repo.get_recording(recording_id)
    db.close()

    assert recording.status == RecordingStatus.SOP_FAILED
    assert "API key" in recording.error_message


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------


def test_tenant_isolation_preserved(monkeypatch):
    _patch_provider(monkeypatch)
    recording_id, session_id, screenshot_id = uuid4(), uuid4(), uuid4()
    _seed(recording_id, session_id, screenshot_id)
    sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))

    db = SessionLocal()
    owner_repo = Repository(db, TENANT)
    other_tenant = UUID("00000000-0000-4000-8000-000000000077")
    other_repo = Repository(db, other_tenant)

    owner_sops = owner_repo.list_sops_for_session(session_id)
    other_sops = other_repo.list_sops_for_session(session_id)

    assert len(owner_sops) == 1
    # A different tenant cannot see the SOP, nor fetch it by id.
    assert other_sops == []
    assert other_repo.get_sop(owner_sops[0].id) is None

    # And cannot persist a record that claims to belong to the owner tenant —
    # the repo rejects cross-tenant writes regardless of the caller.
    cross_claim = owner_sops[0].model_copy(update={"id": uuid4()})
    with pytest.raises(ValueError):
        other_repo.replace_session_draft_sop(session_id, cross_claim)
    db.close()
