import hashlib
import io
from datetime import UTC, datetime
from uuid import UUID, uuid4

from conftest import TEST_TENANT_ID
from PIL import Image
from test_api import auth_headers

import worktrace_api.main as api_main
import worktrace_api.redaction as redaction
from worktrace_api.database import SessionLocal
from worktrace_api.recordings import ChunkStorage
from worktrace_api.redaction import PrivacyRedactor, RedactionRegion, RedactionResult
from worktrace_api.redaction_processing import RecordingRedactionProcessor
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    CaptureSource,
    EventType,
    RecordingStatus,
    Screenshot,
    SessionEvent,
    WorkflowSession,
)
from worktrace_api.settings import get_settings

TENANT = UUID(TEST_TENANT_ID)


def test_redaction_model_readiness_marker(tmp_path, monkeypatch):
    marker = tmp_path / "worktrace" / "redaction-model.json"
    monkeypatch.setattr(redaction, "MODEL_READY_PATH", marker)

    assert redaction.redaction_model_ready("test-model") is False

    redaction.mark_redaction_model_ready("test-model")

    assert redaction.redaction_model_ready("test-model") is True
    assert redaction.redaction_model_ready("other-model") is False


def png_bytes(width: int = 240, height: int = 120) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    for x in range(30, 170, 4):
        for y in range(25, 75):
            image.putpixel((x, y), (0, 0, 0) if x % 8 == 0 else (255, 255, 255))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def seed_recording() -> tuple[UUID, UUID, UUID, str, bytes]:
    session_id = uuid4()
    screenshot_id = uuid4()
    payload = png_bytes()
    settings = get_settings()
    storage = ChunkStorage(settings.recording_storage_path, settings.max_chunk_bytes)

    with SessionLocal() as db:
        repo = Repository(db, TENANT)
        workflow = repo.create_workflow("Redaction test")
        recording = repo.create_recording(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            source_type=CaptureSource.DESKTOP,
            has_audio=False,
            manual_mode=True,
        )
        storage_key = f"{TENANT}/{recording.id}/{screenshot_id}.png"
        path = storage.resolve_storage_key(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        repo.save_session(
            WorkflowSession(
                tenant_id=TENANT,
                id=session_id,
                recording_id=recording.id,
                source_type=CaptureSource.DESKTOP,
                workflow_name=workflow.name,
                events=[
                    SessionEvent(
                        tenant_id=TENANT,
                        sequence=1,
                        timestamp=datetime.now(UTC),
                        event_type=EventType.CLICK,
                        application="Test App",
                        screenshot_reference=screenshot_id,
                    )
                ],
            )
        )
        repo.save_screenshots(
            [
                Screenshot(
                    tenant_id=TENANT,
                    id=screenshot_id,
                    recording_id=recording.id,
                    session_id=session_id,
                    sequence=1,
                    captured_at=datetime.now(UTC),
                    storage_key=storage_key,
                    width=240,
                    height=120,
                    change_score=0.2,
                    content_hash=hashlib.sha256(payload).hexdigest(),
                )
            ]
        )
        repo.link_recording_session(
            recording.id,
            session_id,
            RecordingStatus.AWAITING_MANUAL_REVIEW,
        )
        return recording.id, session_id, screenshot_id, storage_key, payload


def test_redactor_combines_model_and_rule_detections():
    box = [[20.0, 20.0], [170.0, 20.0], [170.0, 80.0], [20.0, 80.0]]
    ocr = lambda _image: [  # noqa: E731
        (box, "alex@example.com", 0.99),
    ]
    classifier = lambda _text: [  # noqa: E731
        {"entity_group": "private_person", "score": 0.91}
    ]
    result = PrivacyRedactor(
        model="test-model",
        hf_token=None,
        score_threshold=0.5,
        blur_radius=14,
        max_dimension_px=1600,
        ocr_engine=ocr,
        classifier=classifier,
        classifier_supplied=True,
    ).redact(png_bytes())

    assert len(result.regions) == 1
    assert result.regions[0].labels == ("email", "private_person")
    assert result.detector_mode == "model_and_rules"
    assert result.image_bytes.startswith(b"\x89PNG\r\n\x1a\n")


def test_redactor_maps_resized_ocr_boxes_to_original_pixels():
    box = [[10.0, 10.0], [40.0, 10.0], [40.0, 30.0], [10.0, 30.0]]
    ocr = lambda _image: [(box, "alex@example.com", 0.99)]  # noqa: E731
    result = PrivacyRedactor(
        model="test-model",
        hf_token=None,
        score_threshold=0.5,
        blur_radius=14,
        max_dimension_px=120,
        ocr_engine=ocr,
        classifier=None,
        classifier_supplied=True,
    ).redact(png_bytes(width=240, height=120))

    assert result.regions[0].bounds == (20, 20, 80, 60)
    assert result.detector_mode == "rules_only"


def test_redaction_only_queues_after_explicit_post(client, monkeypatch):
    recording_id, _session_id, _screenshot_id, _storage_key, _payload = seed_recording()
    queued: list[tuple[str, str]] = []
    monkeypatch.setattr(api_main, "service_status", lambda _url: {"worker": "up"})
    monkeypatch.setattr(
        api_main.redact_recording_screenshots,
        "delay",
        lambda run_id, tenant_id: queued.append((run_id, tenant_id)),
    )

    initial = client.get(
        f"/recordings/{recording_id}/redaction",
        headers=auth_headers(),
    )
    assert initial.status_code == 200
    assert initial.json()["status"] == "not_run"
    assert queued == []

    started = client.post(
        f"/recordings/{recording_id}/redaction",
        headers=auth_headers(),
    )
    assert started.status_code == 202
    assert started.json()["status"] == "queued"
    assert len(queued) == 1

    duplicate = client.post(
        f"/recordings/{recording_id}/redaction",
        headers=auth_headers(),
    )
    assert duplicate.status_code == 202
    assert duplicate.json()["id"] == started.json()["id"]
    assert len(queued) == 1


def test_processor_writes_redacted_copy_and_keeps_original():
    recording_id, _session_id, screenshot_id, storage_key, original = seed_recording()
    redacted = png_bytes(width=240, height=120)

    class FakeRedactor:
        def redact(self, _image_bytes: bytes) -> RedactionResult:
            return RedactionResult(
                image_bytes=redacted,
                regions=(
                    RedactionRegion(
                        bounds=(20, 20, 170, 80),
                        labels=("email",),
                        score=1.0,
                    ),
                ),
                detector_mode="model_and_rules",
            )

    settings = get_settings()
    storage = ChunkStorage(settings.recording_storage_path, settings.max_chunk_bytes)
    with SessionLocal() as db:
        repo = Repository(db, TENANT)
        run, _created = repo.create_redaction_run(recording_id)
        assert run.id is not None
        RecordingRedactionProcessor(repo, settings, FakeRedactor()).process(run.id)

        finished = repo.get_redaction_run(run.id)
        screenshot = repo.get_screenshot(_session_id, screenshot_id)
        assert finished is not None
        assert finished.status == "completed"
        assert finished.redaction_count == 1
        assert screenshot is not None
        assert screenshot.privacy_redaction_status == "redacted"
        assert screenshot.privacy_redacted_storage_key is not None
        assert storage.read(storage_key) == original
        assert storage.read(screenshot.privacy_redacted_storage_key) == redacted
