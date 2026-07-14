"""Phase 3: session screenshots + per-frame annotations + image bytes.

These tests set up session/screenshot state directly via the Repository so they
do not depend on Redis/Celery (the recording pipeline's async dispatch does).
They cover the two overlay-rendering endpoints:
  GET /sessions/{id}/screenshots            -> metadata + N annotations/frame
  GET /sessions/{id}/screenshots/{screenshot_id} -> raw PNG bytes
"""

import hashlib
from datetime import UTC, datetime
from uuid import UUID, uuid4

from conftest import TEST_TENANT_ID
from test_api import auth_headers

from worktrace_api.database import SessionLocal
from worktrace_api.recordings import ChunkStorage
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    CaptureSource,
    EventType,
    Screenshot,
    SessionEvent,
    WorkflowSession,
)
from worktrace_api.settings import get_settings

TENANT = UUID(TEST_TENANT_ID)

# A minimal 1280x720 PNG (valid signature + IHDR dimensions at bytes 16..24).
SAMPLE_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"\x00\x00\x05\x00\x00\x00\x02\xd0"


def _seed_session_with_screenshot() -> tuple[UUID, UUID, UUID]:
    """Persist a session + one screenshot + a click event whose evidence
    annotation is already resolved to screenshot-pixel space. Returns
    (session_id, screenshot_id, event_id)."""
    session_id = uuid4()
    screenshot_id = uuid4()
    event_id = uuid4()

    settings = get_settings()
    storage = ChunkStorage(
        root=settings.recording_storage_path, max_chunk_bytes=settings.max_chunk_bytes
    )
    storage_key = f"{TENANT}/{session_id}/{screenshot_id}.png"
    path = storage.resolve_storage_key(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(SAMPLE_PNG)

    event = SessionEvent(
        tenant_id=TENANT,
        id=event_id,
        sequence=1,
        timestamp=datetime.now(UTC),
        event_type=EventType.CLICK,
        application="ERP Desktop",
        x=480,
        y=320,
        target_label="Approve invoice",
        target_role="AXButton",
        screenshot_reference=screenshot_id,
        after_screenshot_id=screenshot_id,
        event_data={
            "evidenceAnnotation": {
                "type": "click_rectangle",
                "event_id": str(event_id),
                "screenshot_reference": str(screenshot_id),
                "coordinate_space": "screenshot_pixels",
                "bounds": {"x": 432.0, "y": 284.0, "width": 96.0, "height": 72.0},
                "confidence": 0.82,
                "source": "event_pointer",
            }
        },
    )
    with SessionLocal() as db:
        repo = Repository(db, TENANT)
        recording = repo.create_recording(
            "Approve invoice", CaptureSource.DESKTOP, has_audio=False
        )
        session = WorkflowSession(
            tenant_id=TENANT,
            id=session_id,
            recording_id=recording.id,
            source_type=CaptureSource.DESKTOP,
            workflow_name="Approve invoice",
            events=[event],
        )
        screenshot = Screenshot(
            tenant_id=TENANT,
            id=screenshot_id,
            recording_id=recording.id,
            session_id=session_id,
            sequence=1,
            captured_at=datetime.now(UTC),
            storage_key=storage_key,
            media_type="image/png",
            width=1280,
            height=720,
            change_score=0.24,
            content_hash=hashlib.sha256(SAMPLE_PNG).hexdigest(),
        )
        repo.save_session(session)
        repo.save_screenshots([screenshot])

    return session_id, screenshot_id, event_id


def test_list_session_screenshots_exposes_annotations(client):
    session_id, screenshot_id, _event_id = _seed_session_with_screenshot()

    response = client.get(f"/sessions/{session_id}/screenshots", headers=auth_headers())

    assert response.status_code == 200
    screenshots = response.json()
    assert len(screenshots) == 1
    screenshot = screenshots[0]
    assert screenshot["id"] == str(screenshot_id)
    assert screenshot["width"] == 1280
    assert screenshot["height"] == 720
    assert screenshot["media_type"] == "image/png"

    # N annotations per frame: here one click highlight, fully resolved.
    assert len(screenshot["annotations"]) == 1
    annotation = screenshot["annotations"][0]
    assert annotation["coordinate_space"] == "screenshot_pixels"
    assert annotation["bounds"] == {"x": 432.0, "y": 284.0, "width": 96.0, "height": 72.0}
    assert annotation["label"] == "Approve invoice"
    assert annotation["role"] == "AXButton"
    assert annotation["source"] == "event_pointer"
    assert annotation["confidence"] == 0.82


def test_list_session_screenshots_skips_unresolved_coordinate_space(client):
    """Annotations still in global-screen space (no pointer mapping) are not
    renderable as overlays, so they must be excluded from the response."""
    session_id = uuid4()
    screenshot_id = uuid4()
    event_id = uuid4()

    event = SessionEvent(
        tenant_id=TENANT,
        id=event_id,
        sequence=1,
        timestamp=datetime.now(UTC),
        event_type=EventType.CLICK,
        application="ERP Desktop",
        x=480,
        y=320,
        screenshot_reference=screenshot_id,
        event_data={
            "evidenceAnnotation": {
                "type": "click_rectangle",
                "event_id": str(event_id),
                "coordinate_space": "global_screen",
                "bounds": {"x": 480.0, "y": 320.0, "width": 96.0, "height": 72.0},
                "confidence": 0.45,
                "source": "fallback_coordinate",
            }
        },
    )
    with SessionLocal() as db:
        repo = Repository(db, TENANT)
        recording = repo.create_recording(
            "Unmapped click", CaptureSource.DESKTOP, has_audio=False
        )
        session = WorkflowSession(
            tenant_id=TENANT,
            id=session_id,
            recording_id=recording.id,
            source_type=CaptureSource.DESKTOP,
            workflow_name="Unmapped click",
            events=[event],
        )
        screenshot = Screenshot(
            tenant_id=TENANT,
            id=screenshot_id,
            recording_id=recording.id,
            session_id=session_id,
            sequence=1,
            captured_at=datetime.now(UTC),
            storage_key=f"{TENANT}/{session_id}/{screenshot_id}.png",
            media_type="image/png",
            width=1280,
            height=720,
            change_score=0.1,
            content_hash=hashlib.sha256(SAMPLE_PNG).hexdigest(),
        )
        repo.save_session(session)
        repo.save_screenshots([screenshot])

    response = client.get(f"/sessions/{session_id}/screenshots", headers=auth_headers())

    assert response.status_code == 200
    assert response.json()[0]["annotations"] == []


def test_get_session_screenshot_image_returns_bytes(client):
    session_id, screenshot_id, _event_id = _seed_session_with_screenshot()

    response = client.get(
        f"/sessions/{session_id}/screenshots/{screenshot_id}", headers=auth_headers()
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == SAMPLE_PNG


def test_get_session_screenshot_image_404_for_unknown(client):
    session_id, _screenshot_id, _event_id = _seed_session_with_screenshot()

    response = client.get(
        f"/sessions/{session_id}/screenshots/{uuid4()}", headers=auth_headers()
    )

    assert response.status_code == 404


def test_session_screenshots_require_auth(client):
    session_id, _screenshot_id, _event_id = _seed_session_with_screenshot()

    response = client.get(f"/sessions/{session_id}/screenshots")

    assert response.status_code == 401
