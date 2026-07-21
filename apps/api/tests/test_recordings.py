import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from conftest import TEST_TENANT_ID
from sqlalchemy.exc import IntegrityError
from test_api import auth_headers

from worktrace_api.database import RecordingRecord, SessionLocal
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    CaptureSource,
    EventType,
    RecordingStatus,
    SessionEvent,
    WorkflowSession,
)


def create_recording(
    client,
    has_audio=True,
    recording_id=None,
    workflow_name="Approve invoice",
    manual_mode=False,
):
    payload = {
        "workflow_name": workflow_name,
        "has_audio": has_audio,
        "manual_mode": manual_mode,
    }
    if recording_id:
        payload["id"] = str(recording_id)
    response = client.post(
        "/recordings",
        headers=auth_headers(),
        json=payload,
    )
    assert response.status_code == 201
    assert response.json()["source_type"] == "desktop"
    assert response.json()["manual_mode"] is manual_mode
    if recording_id:
        assert response.json()["id"] == str(recording_id)
    return response.json()


def upload_chunk(
    client,
    recording_id,
    index,
    payload=b"chunk",
    checksum=None,
    idempotency_key=None,
    content_type=None,
    metadata=None,
    media_type="application/octet-stream",
    filename=None,
):
    checksum = checksum or hashlib.sha256(payload).hexdigest()
    return client.put(
        f"/recordings/{recording_id}/chunks/{index}",
        headers=auth_headers(),
        data={
            "content_type": content_type or ("audio" if index == 0 else "events"),
            "timestamp_start_ms": index * 10_000,
            "timestamp_end_ms": (index + 1) * 10_000,
            "checksum_sha256": checksum,
            "idempotency_key": idempotency_key or f"{recording_id}:{index}",
            "payload_size": len(payload),
            "metadata_json": json.dumps(metadata or {}),
        },
        files={"file": (filename or f"chunk-{index}.bin", payload, media_type)},
    )


def test_create_recording_accepts_client_supplied_id(client):
    recording_id = uuid4()
    recording = create_recording(client, recording_id=recording_id)

    assert recording["id"] == str(recording_id)

    retry = client.post(
        "/recordings",
        headers=auth_headers(),
        json={
            "id": str(recording_id),
            "workflow_name": "Approve invoice",
            "has_audio": True,
        },
    )
    assert retry.status_code == 200
    assert retry.json()["id"] == str(recording_id)

    conflict = client.post(
        "/recordings",
        headers=auth_headers(),
        json={
            "id": str(recording_id),
            "workflow_name": "Different workflow",
            "has_audio": True,
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == (
        "Recording id already exists with different metadata"
    )


def test_recording_statuses_are_loaded_in_one_request(client):
    first = create_recording(client, has_audio=False)
    second = create_recording(client, has_audio=True, workflow_name="Review refund")

    response = client.post(
        "/recordings/statuses",
        headers=auth_headers(),
        json={
            "recording_ids": [
                first["id"],
                str(uuid4()),
                second["id"],
            ]
        },
    )

    assert response.status_code == 200
    statuses = {item["recording"]["id"]: item for item in response.json()}
    assert set(statuses) == {first["id"], second["id"]}
    assert "transcribing_audio" not in statuses[first["id"]]["stages"]
    assert "transcribing_audio" in statuses[second["id"]]["stages"]


def test_resumable_chunk_upload_and_status_pipeline(client):
    recording = create_recording(client, has_audio=False)
    before_screenshot_id = str(uuid4())
    after_screenshot_id = str(uuid4())
    event_id = str(uuid4())
    before_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"\x00\x00\x05\x00\x00\x00\x02\xd0"
    after_png = before_png + b"changed"
    event_payload = json.dumps(
        {
            "id": event_id,
            "sequence": 1,
            "timestamp": "2026-06-19T10:00:00Z",
            "type": "click",
            "data": {
                "x": 480,
                "y": 320,
                "button": "left",
                "application": "ERP Desktop",
                "targetLabel": "Approve invoice",
            },
            "beforeScreenshotId": before_screenshot_id,
        }
    ).encode()

    first = upload_chunk(
        client,
        recording["id"],
        0,
        before_png,
        content_type="screenshots",
        metadata={
            "id": before_screenshot_id,
            "sequence": 1,
            "capturedAt": "2026-06-19T09:59:59Z",
            "changeScore": 0,
        },
        media_type="image/png",
    )
    second = upload_chunk(
        client,
        recording["id"],
        1,
        event_payload,
        content_type="events",
        media_type="application/x-ndjson",
    )
    third = upload_chunk(
        client,
        recording["id"],
        2,
        after_png,
        content_type="screenshots",
        metadata={
            "id": after_screenshot_id,
            "sequence": 2,
            "capturedAt": "2026-06-19T10:00:01Z",
            "eventIds": [event_id],
            "changeScore": 0.24,
        },
        media_type="image/png",
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200

    duplicate = upload_chunk(
        client,
        recording["id"],
        0,
        before_png,
        content_type="screenshots",
        metadata={
            "id": before_screenshot_id,
            "sequence": 1,
            "capturedAt": "2026-06-19T09:59:59Z",
            "changeScore": 0,
        },
        media_type="image/png",
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True

    completed = client.post(
        f"/recordings/{recording['id']}/complete",
        headers=auth_headers(),
        json={"expected_chunk_count": 3},
    )
    assert completed.status_code == 200
    completed_recording = completed.json()
    assert completed_recording["status"] == "sop_failed"
    assert completed_recording["session_id"]
    late = upload_chunk(client, recording["id"], 3, b"late")
    assert late.status_code == 409

    current = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())
    assert current.status_code == 200
    assert current.json()["recording"]["status"] == "sop_failed"
    assert current.json()["stages"] == [
        "recording",
        "uploading",
        "validating",
        "processing_screenshots",
        "aligning_evidence",
        "awaiting_manual_review",
        "generating_sop",
        "sop_failed",
        "ready_for_review",
        "completed",
    ]
    repeated = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())
    assert repeated.json()["recording"]["status"] == "sop_failed"

    session = client.get(
        f"/sessions/{completed_recording['session_id']}", headers=auth_headers()
    )
    assert session.status_code == 200
    event = session.json()["events"][0]
    assert session.json()["source_type"] == "desktop"
    assert session.json()["recording_id"] == recording["id"]
    assert event["event_type"] == "click"
    assert event["before_screenshot_id"] == before_screenshot_id
    assert event["after_screenshot_id"] == after_screenshot_id
    annotation = event["event_data"]["evidenceAnnotation"]
    assert annotation["type"] == "click_rectangle"
    assert annotation["screenshot_reference"] == before_screenshot_id
    assert event["screenshot_reference"] == before_screenshot_id
    assert annotation["coordinate_space"] == "global_screen"
    assert annotation["bounds"] == {"x": 432.0, "y": 284.0, "width": 96.0, "height": 72.0}

    export = client.get(
        f"/exports/{completed_recording['session_id']}", headers=auth_headers()
    )
    assert export.status_code == 200
    assert export.json()["sops"] == []


def test_audio_recording_keeps_transcript_placeholder(client):
    recording = create_recording(client, has_audio=True)
    screenshot_id = str(uuid4())
    event_id = str(uuid4())
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"\x00\x00\x05\x00\x00\x00\x02\xd0"
    event_payload = json.dumps(
        {
            "id": event_id,
            "sequence": 1,
            "timestamp": "2026-06-19T10:00:00Z",
            "type": "click",
            "data": {"x": 320, "y": 240, "button": "left"},
        }
    ).encode()

    assert (
        upload_chunk(
            client,
            recording["id"],
            0,
            b"audio-bytes",
            content_type="audio",
            media_type="audio/webm",
        ).status_code
        == 200
    )
    assert (
        upload_chunk(
            client,
            recording["id"],
            1,
            event_payload,
            content_type="events",
            media_type="application/x-ndjson",
        ).status_code
        == 200
    )
    assert (
        upload_chunk(
            client,
            recording["id"],
            2,
            png,
            content_type="screenshots",
            metadata={
                "id": screenshot_id,
                "sequence": 1,
                "capturedAt": "2026-06-19T10:00:01Z",
                "eventIds": [event_id],
            },
            media_type="image/png",
        ).status_code
        == 200
    )

    completed = client.post(
        f"/recordings/{recording['id']}/complete",
        headers=auth_headers(),
        json={"expected_chunk_count": 3},
    )

    assert completed.status_code == 200
    current = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())
    assert "transcribing_audio" in current.json()["stages"]
    session = client.get(f"/sessions/{completed.json()['session_id']}", headers=auth_headers())
    transcript = session.json()["transcript"]
    assert transcript == {
        "status": "pending_transcription",
        "text": None,
        "segments": [],
        "audio_chunk_count": 1,
        "audio_reference": f"{TEST_TENANT_ID}/{recording['id']}/assembled/audio.webm",
    }
    assembled_audio = (
        Path(__file__).parent
        / "data"
        / "recordings"
        / TEST_TENANT_ID
        / recording["id"]
        / "assembled"
        / "audio.webm"
    )
    assert assembled_audio.read_bytes() == b"audio-bytes"


def test_rejects_checksum_mismatch_and_missing_chunks(client):
    recording = create_recording(client, has_audio=False)
    bad = upload_chunk(client, recording["id"], 0, b"payload", checksum="0" * 64)
    assert bad.status_code == 409

    assert upload_chunk(client, recording["id"], 1, b"events").status_code == 200
    completed = client.post(
        f"/recordings/{recording['id']}/complete",
        headers=auth_headers(),
        json={"expected_chunk_count": 2},
    )
    assert completed.status_code == 409
    assert "missing chunks" in completed.json()["detail"]


def test_failed_processing_is_visible_in_recording_status(client):
    recording = create_recording(client, has_audio=False)
    invalid_events = upload_chunk(
        client,
        recording["id"],
        0,
        b"not-json",
        content_type="events",
    )
    assert invalid_events.status_code == 200

    completed = client.post(
        f"/recordings/{recording['id']}/complete",
        headers=auth_headers(),
        json={"expected_chunk_count": 1},
    )

    assert completed.status_code == 409
    current = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())
    assert current.status_code == 200
    assert current.json()["recording"]["status"] == "failed"
    assert current.json()["recording"]["error_message"] == (
        "Recording contains no valid screenshots"
    )


def test_status_marks_recording_failed_when_uploaded_files_are_missing(client):
    recording = create_recording(client, has_audio=False)
    uploaded = upload_chunk(
        client,
        recording["id"],
        0,
        b'{"type":"click","data":{"x":1,"y":2}}\n',
        content_type="events",
        media_type="application/x-ndjson",
    )
    assert uploaded.status_code == 200

    stored_chunk = (
        Path(__file__).parent
        / "data"
        / "recordings"
        / TEST_TENANT_ID
        / recording["id"]
        / "00000000-events.jsonl"
    )
    stored_chunk.unlink()

    current = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())

    assert current.status_code == 200
    assert current.json()["recording"]["status"] == "failed"
    assert current.json()["recording"]["error_message"] == (
        "Recording evidence files are missing for 1 uploaded chunk(s)."
    )


def test_rejects_invalid_index_and_declared_size(client):
    recording = create_recording(client)
    negative = upload_chunk(client, recording["id"], -1)
    assert negative.status_code == 422
    wrong_size = client.put(
        f"/recordings/{recording['id']}/chunks/0",
        headers=auth_headers(),
        data={
            "content_type": "events",
            "timestamp_start_ms": 0,
            "timestamp_end_ms": 10_000,
            "checksum_sha256": hashlib.sha256(b"chunk").hexdigest(),
            "idempotency_key": f"{recording['id']}:0",
            "payload_size": 99,
        },
        files={"file": ("chunk.bin", b"chunk", "application/octet-stream")},
    )
    assert wrong_size.status_code == 409


def test_uploaded_chunks_keep_readable_file_extensions(client):
    recording = create_recording(client, has_audio=True)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"\x00\x00\x00\x10\x00\x00\x00\x10"
    events = b'{"type":"click","data":{"x":1,"y":2}}\n'

    screenshot = upload_chunk(
        client,
        recording["id"],
        0,
        png,
        content_type="screenshots",
        media_type="application/octet-stream",
        filename="captured-screen.webp",
    )
    event = upload_chunk(
        client,
        recording["id"],
        1,
        events,
        content_type="events",
        media_type="application/octet-stream",
        filename="events.jsonl",
    )
    audio = upload_chunk(
        client,
        recording["id"],
        2,
        b"audio-bytes",
        content_type="audio",
        media_type="application/octet-stream",
        filename="voice-note.ogg",
    )

    assert screenshot.status_code == 200
    assert event.status_code == 200
    assert audio.status_code == 200

    recording_dir = (
        Path(__file__).parent / "data" / "recordings" / TEST_TENANT_ID / recording["id"]
    )
    assert (recording_dir / "00000000-screenshots.webp").exists()
    assert (recording_dir / "00000001-events.jsonl").exists()
    assert (recording_dir / "00000002-audio.ogg").exists()


def test_rejects_conflicting_duplicate(client):
    recording = create_recording(client)
    assert upload_chunk(client, recording["id"], 0, b"first").status_code == 200
    conflict = upload_chunk(client, recording["id"], 0, b"second")
    assert conflict.status_code == 409
    key_conflict = upload_chunk(
        client, recording["id"], 0, b"first", idempotency_key="different-key"
    )
    assert key_conflict.status_code == 409
    forged_retry = upload_chunk(
        client,
        recording["id"],
        0,
        b"not-first",
        checksum=hashlib.sha256(b"first").hexdigest(),
    )
    assert forged_retry.status_code == 409


def test_rejects_reused_idempotency_key_on_different_chunk(client):
    recording = create_recording(client)
    assert (
        upload_chunk(
            client,
            recording["id"],
            0,
            b"first",
            idempotency_key=f"{recording['id']}:shared-key",
        ).status_code
        == 200
    )

    conflict = upload_chunk(
        client,
        recording["id"],
        1,
        b"second",
        idempotency_key=f"{recording['id']}:shared-key",
    )

    assert conflict.status_code == 409
    assert "idempotency key" in conflict.json()["detail"]


def test_recording_foreign_keys_are_enforced():
    with SessionLocal() as db:
        db.add(
            RecordingRecord(
                id=str(uuid4()),
                tenant_id=TEST_TENANT_ID,
                session_id=str(uuid4()),
                source_type="desktop",
                workflow_name="Broken session link",
                status="recording",
                uploaded_chunk_count=0,
                uploaded_bytes=0,
                has_audio=False,
                created_at=datetime.now(UTC),
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        db.add(
            RecordingRecord(
                id=str(uuid4()),
                tenant_id=str(uuid4()),
                source_type="desktop",
                workflow_name="Broken tenant link",
                status="recording",
                uploaded_chunk_count=0,
                uploaded_bytes=0,
                has_audio=False,
                created_at=datetime.now(UTC),
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_delete_recording_removes_metadata_and_raw_chunks(client):
    recording = create_recording(client)
    assert upload_chunk(client, recording["id"], 0, b"raw-evidence").status_code == 200

    deleted = client.delete(f"/recordings/{recording['id']}", headers=auth_headers())

    assert deleted.status_code == 204
    missing = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())
    assert missing.status_code == 404
    repeated = client.delete(f"/recordings/{recording['id']}", headers=auth_headers())
    assert repeated.status_code == 404


def test_complete_recording_without_broker_leaves_pipeline_processing(client):
    """With no Redis/worker running, /complete must build the durable session
    and evidence metadata, but it must not create a fallback SOP or pretend the
    recording is ready for review."""
    recording = create_recording(client, has_audio=False)
    before_screenshot_id = str(uuid4())
    after_screenshot_id = str(uuid4())
    event_id = str(uuid4())
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"\x00\x00\x05\x00\x00\x00\x02\xd0"  # 1280x720
    after_png = png + b"changed"

    event_payload = json.dumps(
        {
            "id": event_id,
            "sequence": 1,
            "timestamp": "2026-06-19T10:00:00Z",
            "type": "click",
            "data": {
                "x": 480,
                "y": 320,
                "button": "left",
                "application": "ERP Desktop",
                "targetLabel": "Approve",
                "pointer": {
                    "coordinateSpace": "global-screen",
                    "x": 480,
                    "y": 320,
                    "displayId": "1",
                    "displayScaleFactor": 1,
                    "pointOnDisplay": {"x": 480, "y": 320},
                },
            },
            "beforeScreenshotId": before_screenshot_id,
        }
    ).encode()

    assert (
        upload_chunk(
            client,
            recording["id"],
            0,
            png,
            content_type="screenshots",
            metadata={
                "id": before_screenshot_id,
                "sequence": 1,
                "capturedAt": "2026-06-19T09:59:59Z",
                "changeScore": 0,
                "capture": {
                    "imageSize": {"width": 1280, "height": 720},
                    "display": {
                        "id": "1",
                        "scaleFactor": 1,
                        "bounds": {"x": 0, "y": 0, "width": 1280, "height": 720},
                    },
                },
            },
            media_type="image/png",
        ).status_code
        == 200
    )
    assert (
        upload_chunk(
            client,
            recording["id"],
            1,
            event_payload,
            content_type="events",
            media_type="application/x-ndjson",
        ).status_code
        == 200
    )
    assert (
        upload_chunk(
            client,
            recording["id"],
            2,
            after_png,
            content_type="screenshots",
            metadata={
                "id": after_screenshot_id,
                "sequence": 2,
                "capturedAt": "2026-06-19T10:00:01Z",
                "eventIds": [event_id],
                "changeScore": 0.24,
                "capture": {
                    "imageSize": {"width": 1280, "height": 720},
                    "display": {
                        "id": "1",
                        "scaleFactor": 1,
                        "bounds": {"x": 0, "y": 0, "width": 1280, "height": 720},
                    },
                },
            },
            media_type="image/png",
        ).status_code
        == 200
    )

    completed = client.post(
        f"/recordings/{recording['id']}/complete",
        headers=auth_headers(),
        json={"expected_chunk_count": 3},
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "sop_failed"
    session_id = completed.json()["session_id"]

    session = client.get(f"/sessions/{session_id}", headers=auth_headers())
    assert session.status_code == 200
    event = session.json()["events"][0]
    assert event["event_type"] == "click"
    assert event["target_label"] == "Approve"
    assert event["before_screenshot_id"] == before_screenshot_id
    assert event["after_screenshot_id"] == after_screenshot_id
    assert event["screenshot_reference"] == before_screenshot_id
    annotation = event["event_data"]["evidenceAnnotation"]
    assert annotation["screenshot_reference"] == before_screenshot_id
    assert annotation["coordinate_space"] == "screenshot_pixels"
    assert annotation["bounds"] == {"x": 432.0, "y": 284.0, "width": 96.0, "height": 72.0}

    screenshots = client.get(f"/sessions/{session_id}/screenshots", headers=auth_headers())
    assert screenshots.status_code == 200
    screenshots_by_id = {item["id"]: item for item in screenshots.json()}
    assert len(screenshots_by_id[before_screenshot_id]["annotations"]) == 1
    assert screenshots_by_id[before_screenshot_id]["annotations"][0]["bounds"] == {
        "x": 432.0,
        "y": 284.0,
        "width": 96.0,
        "height": 72.0,
    }
    assert screenshots_by_id[after_screenshot_id]["annotations"] == []

    export = client.get(f"/exports/{session_id}", headers=auth_headers())
    assert export.status_code == 200
    assert export.json()["sops"] == []


def test_retry_sop_is_recoverable_but_requires_background_queue(client):
    recording = create_recording(client, has_audio=False)
    screenshot_id = str(uuid4())
    event_id = str(uuid4())
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"\x00\x00\x05\x00\x00\x00\x02\xd0"
    event_payload = json.dumps(
        {
            "id": event_id,
            "sequence": 1,
            "timestamp": "2026-06-19T10:00:00Z",
            "type": "click",
            "data": {"x": 480, "y": 320, "button": "left", "application": "ERP Desktop"},
        }
    ).encode()

    assert (
        upload_chunk(
            client,
            recording["id"],
            0,
            event_payload,
            content_type="events",
            media_type="application/x-ndjson",
        ).status_code
        == 200
    )
    assert (
        upload_chunk(
            client,
            recording["id"],
            1,
            png,
            content_type="screenshots",
            metadata={
                "id": screenshot_id,
                "sequence": 1,
                "capturedAt": "2026-06-19T10:00:01Z",
                "eventIds": [event_id],
            },
            media_type="image/png",
        ).status_code
        == 200
    )

    completed = client.post(
        f"/recordings/{recording['id']}/complete",
        headers=auth_headers(),
        json={"expected_chunk_count": 2},
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "sop_failed"
    assert "queue is offline" in completed.json()["error_message"]

    retry = client.post(
        f"/recordings/{recording['id']}/retry",
        headers=auth_headers(),
        json={"target": "sop"},
    )

    assert retry.status_code == 409
    assert "queue is offline" in retry.json()["detail"]
    current = client.get(f"/recordings/{recording['id']}/status", headers=auth_headers())
    assert current.status_code == 200
    assert current.json()["recording"]["status"] == "sop_failed"


def test_manual_review_saves_transcript_and_prompt(client):
    tenant_id = UUID(TEST_TENANT_ID)
    recording_id = uuid4()
    session_id = uuid4()
    event = SessionEvent(
        tenant_id=tenant_id,
        event_type=EventType.CLICK,
        application="ERP Desktop",
        x=10,
        y=20,
    )

    with SessionLocal() as db:
        repo = Repository(db, tenant_id)
        recording = repo.create_recording(
            "Manual invoice review",
            CaptureSource.DESKTOP,
            has_audio=True,
            recording_id=recording_id,
            manual_mode=True,
        )
        session = WorkflowSession(
            tenant_id=tenant_id,
            id=session_id,
            recording_id=recording.id,
            source_type=CaptureSource.DESKTOP,
            workflow_name="Manual invoice review",
            duration_ms=15_000,
            events=[event],
        )
        repo.save_session(session)
        repo.link_recording_session(
            recording.id,
            session.id,
            RecordingStatus.AWAITING_MANUAL_REVIEW,
        )

    saved = client.put(
        f"/recordings/{recording_id}/manual-review",
        headers=auth_headers(),
        json={
            "transcript_text": "Click approve only after checking the vendor total.",
            "custom_instruction": "Use short checklist language.",
        },
    )

    assert saved.status_code == 200
    assert saved.json()["manual_mode"] is True
    assert saved.json()["custom_sop_instruction"] == "Use short checklist language."

    session = client.get(f"/sessions/{session_id}", headers=auth_headers())
    assert session.status_code == 200
    transcript = session.json()["transcript"]
    assert transcript["status"] == "completed"
    assert transcript["text"] == "Click approve only after checking the vendor total."
    assert transcript["segments"] == [
        {
            "start_ms": 0,
            "end_ms": 15000,
            "text": "Click approve only after checking the vendor total.",
            "speaker": None,
        }
    ]


def test_manual_generate_sop_queues_only_sop_stage(client):
    tenant_id = UUID(TEST_TENANT_ID)
    recording_id = uuid4()
    session_id = uuid4()
    event = SessionEvent(
        tenant_id=tenant_id,
        event_type=EventType.CLICK,
        application="ERP Desktop",
        x=10,
        y=20,
    )

    with SessionLocal() as db:
        repo = Repository(db, tenant_id)
        recording = repo.create_recording(
            "Generate reviewed SOP",
            CaptureSource.DESKTOP,
            has_audio=False,
            recording_id=recording_id,
            manual_mode=True,
        )
        session = WorkflowSession(
            tenant_id=tenant_id,
            id=session_id,
            recording_id=recording.id,
            source_type=CaptureSource.DESKTOP,
            workflow_name="Generate reviewed SOP",
            events=[event],
        )
        repo.save_session(session)
        repo.link_recording_session(
            recording.id,
            session.id,
            RecordingStatus.AWAITING_MANUAL_REVIEW,
        )

    response = client.post(
        f"/recordings/{recording_id}/generate-sop",
        headers=auth_headers(),
        json={"custom_instruction": "Mention audit evidence."},
    )

    assert response.status_code == 409
    assert "queue is offline" in response.json()["detail"]
    current = client.get(f"/recordings/{recording_id}/status", headers=auth_headers())
    assert current.status_code == 200
    assert current.json()["recording"]["status"] == "sop_failed"
    assert current.json()["recording"]["custom_sop_instruction"] == (
        "Mention audit evidence."
    )


def test_broker_available_returns_false_for_unreachable_host():
    from worktrace_api.core.celery_app import broker_available

    assert broker_available("redis://127.0.0.1:1/0", timeout=0.5) is False


def test_service_status_reports_redis_down_without_broker():
    from worktrace_api.core.celery_app import service_status

    assert service_status("redis://127.0.0.1:1/0", timeout=0.5) == {
        "redis": "down",
        "worker": "down",
    }


def test_health_reports_services(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["services"]["redis"] in {"up", "down"}
    assert body["services"]["worker"] in {"up", "down", "unknown"}
