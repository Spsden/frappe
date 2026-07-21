"""Tests for the per-tenant SOP generation guardrails (``/settings/sop-limits``).

Covers: env-default fallback, set/clear/omit semantics, bounds validation, and
that an override actually flows through into the generation task.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from conftest import TEST_TENANT_ID

from worktrace_api.database import RecordingRecord, ScreenshotRecord, SessionLocal
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    SOP_LIMIT_FIELDS,
    EventType,
    RecordingStatus,
    SessionEvent,
    SopLimitsSettingsUpdate,
    WorkflowSession,
)
from worktrace_api.settings import get_settings
from worktrace_api.tasks import sop_generation

TENANT = UUID(TEST_TENANT_ID)

VALID_SOP_JSON = (
    '{"title": "Submit invoice", "document": null, "steps": ['
    '{"position": 1, "evidence_position": 1, "title": "Open", "instruction": "Open the app.", '
    '"warning": null, "estimated_time_ms": 100, "decision_branches": []}'
    "]}"
)


def auth_headers():
    return {"Authorization": "Bearer test-api-token"}


def _defaults() -> dict[str, int]:
    settings = get_settings()
    return {field: int(getattr(settings, field)) for field in SOP_LIMIT_FIELDS}


def _seed(recording_id, session_id, screenshot_ids):
    """Insert a recording + session + N annotated screenshots for TENANT."""
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
            created_at=datetime.now(UTC),
        )
    )
    db.commit()
    Repository(db, TENANT).save_session(
        WorkflowSession(
            tenant_id=TENANT,
            id=session_id,
            recording_id=recording_id,
            workflow_name="Submit invoice",
            duration_ms=1000,
            events=[
                SessionEvent(
                    tenant_id=TENANT,
                    sequence=1,
                    timestamp=datetime.now(UTC),
                    event_type=EventType.CLICK,
                    application="ERP",
                    before_screenshot_id=screenshot_ids[0],
                )
            ],
        )
    )
    for index, screenshot_id in enumerate(screenshot_ids, start=1):
        db.add(
            ScreenshotRecord(
                id=str(screenshot_id),
                tenant_id=str(TENANT),
                recording_id=str(recording_id),
                session_id=str(session_id),
                sequence=index,
                captured_at=datetime.now(UTC),
                storage_key=f"raw-{index}.png",
                media_type="image/png",
                width=10,
                height=10,
                change_score=0.1,
                content_hash=f"{index:x}".rjust(64, "0"),
                redaction_status="redacted",
                annotated_storage_key=f"a-{index}.png",
                created_at=datetime.now(UTC),
            )
        )
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# /settings/sop-limits API
# ---------------------------------------------------------------------------


def test_get_returns_env_defaults_when_no_override(client):
    body = client.get("/settings/sop-limits", headers=auth_headers()).json()

    for field in SOP_LIMIT_FIELDS:
        assert body[field] == body["defaults"][field]
    assert all(value is False for value in body["overridden"].values())
    assert body["updated_at"] is None


def test_put_sets_override_and_marks_overridden(client):
    body = client.put(
        "/settings/sop-limits",
        headers=auth_headers(),
        json={"sop_max_vision_frames": 5},
    ).json()

    assert body["sop_max_vision_frames"] == 5
    assert body["overridden"]["sop_max_vision_frames"] is True
    # Untouched fields stay at their default and are not marked overridden.
    assert body["overridden"]["sop_max_evidence_steps"] is False
    assert body["sop_max_evidence_steps"] == body["defaults"]["sop_max_evidence_steps"]
    assert body["updated_at"] is not None

    # Persisted on a fresh GET.
    again = client.get("/settings/sop-limits", headers=auth_headers()).json()
    assert again["sop_max_vision_frames"] == 5


def test_put_null_clears_override(client):
    client.put(
        "/settings/sop-limits", headers=auth_headers(), json={"sop_max_vision_frames": 5}
    )
    body = client.put(
        "/settings/sop-limits", headers=auth_headers(), json={"sop_max_vision_frames": None}
    ).json()

    assert body["overridden"]["sop_max_vision_frames"] is False
    assert body["sop_max_vision_frames"] == body["defaults"]["sop_max_vision_frames"]


def test_put_omitted_field_is_left_unchanged(client):
    client.put(
        "/settings/sop-limits",
        headers=auth_headers(),
        json={"sop_max_vision_frames": 5, "sop_max_output_tokens": 4000},
    )
    body = client.put(
        "/settings/sop-limits", headers=auth_headers(), json={"sop_max_output_tokens": 6000}
    ).json()

    # sop_max_vision_frames was omitted → unchanged; sop_max_output_tokens updated.
    assert body["sop_max_vision_frames"] == 5
    assert body["sop_max_output_tokens"] == 6000


def test_put_rejects_out_of_range_value(client):
    response = client.put(
        "/settings/sop-limits", headers=auth_headers(), json={"sop_max_evidence_steps": 0}
    )
    assert response.status_code == 422


def test_requires_auth(client):
    assert client.get("/settings/sop-limits").status_code == 401


# ---------------------------------------------------------------------------
# Override flows into the generation task
# ---------------------------------------------------------------------------


class _FakeProvider:
    def __init__(self, settings, **_kwargs):
        pass

    @property
    def available(self):
        return True

    def complete(self, messages, max_tokens=None, **_kwargs):
        return VALID_SOP_JSON


def test_task_uses_overridden_output_tokens(monkeypatch):
    captured: dict[str, int] = {}

    def fake_complete(self, messages, max_tokens=None, **_kwargs):
        captured["max_tokens"] = int(max_tokens)
        return VALID_SOP_JSON

    monkeypatch.setattr(_FakeProvider, "complete", fake_complete)
    monkeypatch.setattr(
        sop_generation,
        "SOPProvider",
        lambda settings, **kw: _FakeProvider(settings),
    )
    monkeypatch.setattr(sop_generation, "encode_evidence_images", lambda *a, **k: {})

    recording_id, session_id = uuid4(), uuid4()
    _seed(recording_id, session_id, [uuid4()])

    db = SessionLocal()
    Repository(db, TENANT).save_sop_limits(
        SopLimitsSettingsUpdate(sop_max_output_tokens=1234), _defaults()
    )
    db.close()

    sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))

    # The override (not the env default) reached the LLM call.
    assert captured["max_tokens"] == 1234


def test_task_honors_evidence_step_override(monkeypatch):
    monkeypatch.setattr(
        sop_generation,
        "SOPProvider",
        lambda settings, **kw: _FakeProvider(settings),
    )
    monkeypatch.setattr(sop_generation, "encode_evidence_images", lambda *a, **k: {})

    recording_id, session_id = uuid4(), uuid4()
    _seed(recording_id, session_id, [uuid4(), uuid4()])  # two evidence steps

    # Force the evidence-step guard to reject (limit 1 < 2 steps).
    db = SessionLocal()
    Repository(db, TENANT).save_sop_limits(
        SopLimitsSettingsUpdate(sop_max_evidence_steps=1), _defaults()
    )
    db.close()

    sop_generation.generate_sop_with_ai(str(recording_id), str(session_id), str(TENANT))

    db = SessionLocal()
    recording = Repository(db, TENANT).get_recording(recording_id)
    db.close()
    assert recording.status == RecordingStatus.SOP_FAILED
    assert "evidence steps" in recording.error_message
