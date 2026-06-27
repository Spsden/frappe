import json
import struct
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid5

from worktrace_api.privacy import sanitize_session
from worktrace_api.recordings import ChunkStorage, chunk_extension
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    CaptureSource,
    ChunkContentType,
    EventType,
    RecordingStatus,
    RecordingTranscript,
    Screenshot,
    SessionEvent,
    WorkflowSession,
)
from worktrace_api.services import generate_sop


class RecordingProcessor:
    """Converts durable raw chunks into the structured session used by SOP generation."""

    def __init__(self, storage: ChunkStorage, allowed_domains: list[str] | None = None):
        self.storage = storage
        self.allowed_domains = allowed_domains or []

    def process(self, recording_id: UUID, repo: Repository):
        recording = repo.get_recording(recording_id)
        if not recording:
            raise LookupError("Recording not found")

        try:
            chunks = repo.list_recording_chunks(recording_id)
            if not chunks:
                raise ValueError("Recording contains no evidence chunks")

            transcript = None
            if recording.has_audio:
                repo.set_recording_status(recording_id, RecordingStatus.TRANSCRIBING_AUDIO)
                transcript = self._transcript(chunks)

            repo.set_recording_status(recording_id, RecordingStatus.PROCESSING_SCREENSHOTS)
            session_id = uuid5(recording_id, "workflow-session")
            (
                screenshots,
                screenshot_ids,
                after_screenshot_by_event,
                after_screenshot_metadata_by_event,
            ) = self._screenshots(recording_id, session_id, chunks)
            if not screenshots:
                raise ValueError("Recording contains no valid screenshots")

            repo.set_recording_status(recording_id, RecordingStatus.ALIGNING_EVIDENCE)
            events = self._events(
                recording.source_type,
                recording_id,
                chunks,
                screenshot_ids,
                after_screenshot_by_event,
                after_screenshot_metadata_by_event,
                repo.tenant_id,
            )
            if not events:
                raise ValueError("Recording contains no valid workflow events")

            duration_ms = max((chunk.timestamp_end_ms for chunk in chunks), default=0)
            session = sanitize_session(
                WorkflowSession(
                    id=session_id,
                    tenant_id=repo.tenant_id,
                    source_type=recording.source_type,
                    recording_id=recording_id,
                    workflow_name=recording.workflow_name,
                    duration_ms=duration_ms,
                    transcript=transcript,
                    events=events,
                ),
                self.allowed_domains,
            )
            repo.save_session(session)
            repo.save_screenshots(screenshots)

            repo.set_recording_status(recording_id, RecordingStatus.GENERATING_SOP)
            repo.save_sop(generate_sop(session, repo.next_sop_version(session.id)))
            recording_result = repo.link_recording_session(
                recording_id, session.id, RecordingStatus.READY_FOR_REVIEW
            )

            # Trigger the Celery orchestration pipeline AFTER the session is linked
            from worktrace_api.tasks.pipeline import process_recording
            process_recording.delay(str(recording_id), str(session.id), str(repo.tenant_id))

            return recording_result
        except Exception as exc:
            repo.set_recording_status(recording_id, RecordingStatus.FAILED, str(exc))
            raise

    def _transcript(self, chunks: list) -> RecordingTranscript:
        audio_chunks = [
            chunk for chunk in chunks if chunk.content_type == ChunkContentType.AUDIO
        ]
        audio_chunk_count = len(audio_chunks)
        if audio_chunk_count == 0:
            return RecordingTranscript(status="not_recorded", audio_chunk_count=0)

        media_types = {chunk.media_type for chunk in audio_chunks}
        if len(media_types) > 1:
            raise ValueError("Audio chunks must use one media type")

        media_type = next(iter(media_types))
        extension = chunk_extension(ChunkContentType.AUDIO, media_type)
        audio_reference, _, _ = self.storage.assemble(
            UUID(audio_chunks[0].tenant_id),
            UUID(audio_chunks[0].recording_id),
            audio_chunks,
            f"audio{extension}",
        )
        return RecordingTranscript(
            status="pending_transcription",
            audio_chunk_count=audio_chunk_count,
            audio_reference=audio_reference,
            segments=[],
        )

    def _screenshots(
        self, recording_id: UUID, session_id: UUID, chunks: list
    ) -> tuple[list[Screenshot], dict[str, UUID], dict[str, UUID], dict[str, dict[str, Any]]]:
        screenshots: list[Screenshot] = []
        screenshot_ids: dict[str, UUID] = {}
        after_screenshot_by_event: dict[str, UUID] = {}
        after_screenshot_metadata_by_event: dict[str, dict[str, Any]] = {}

        for chunk in chunks:
            if chunk.content_type != ChunkContentType.SCREENSHOTS:
                continue

            metadata = chunk.metadata_json or {}
            screenshot_id = _uuid_or_default(
                metadata.get("id"),
                uuid5(recording_id, f"screenshot:{chunk.chunk_index}:{chunk.checksum_sha256}"),
            )
            original_id = metadata.get("id")
            if original_id:
                screenshot_ids[str(original_id)] = screenshot_id

            payload = self.storage.read(chunk.storage_key)
            detected_width, detected_height = _image_dimensions(payload)
            declared_width = metadata.get("width")
            declared_height = metadata.get("height")
            if declared_width is not None and int(declared_width) != detected_width:
                raise ValueError("Screenshot width does not match the uploaded image")
            if declared_height is not None and int(declared_height) != detected_height:
                raise ValueError("Screenshot height does not match the uploaded image")
            declared_hash = metadata.get("contentHash") or metadata.get("content_hash")
            if declared_hash and declared_hash != chunk.checksum_sha256:
                raise ValueError("Screenshot content hash does not match the uploaded image")
            captured_at = _parse_datetime(
                metadata.get("capturedAt") or metadata.get("captured_at")
            ) or datetime.now(UTC)
            screenshot = Screenshot(
                tenant_id=UUID(chunk.tenant_id),
                id=screenshot_id,
                recording_id=recording_id,
                session_id=session_id,
                sequence=int(metadata.get("sequence") or len(screenshots) + 1),
                captured_at=captured_at,
                storage_key=chunk.storage_key,
                media_type=chunk.media_type,
                width=detected_width,
                height=detected_height,
                change_score=float(
                    metadata.get("changeScore") or metadata.get("change_score") or 0
                ),
                content_hash=chunk.checksum_sha256,
                redaction_status="pending",
            )
            screenshots.append(screenshot)

            event_ids = metadata.get("eventIds") or metadata.get("event_ids") or []
            if isinstance(event_ids, list):
                for event_id in event_ids:
                    after_screenshot_by_event[str(event_id)] = screenshot_id
                    after_screenshot_metadata_by_event[str(event_id)] = metadata

        return (
            screenshots,
            screenshot_ids,
            after_screenshot_by_event,
            after_screenshot_metadata_by_event,
        )

    def _events(
        self,
        source_type: CaptureSource,
        recording_id: UUID,
        chunks: list,
        screenshot_ids: dict[str, UUID],
        after_screenshot_by_event: dict[str, UUID],
        after_screenshot_metadata_by_event: dict[str, dict[str, Any]],
        tenant_id: UUID,
    ) -> list[SessionEvent]:
        events: list[SessionEvent] = []

        for chunk in chunks:
            if chunk.content_type != ChunkContentType.EVENTS:
                continue
            payload = self.storage.read(chunk.storage_key)
            for raw in _decode_events(payload):
                event = _normalize_event(
                    raw,
                    source_type,
                    recording_id,
                    tenant_id,
                    len(events) + 1,
                    screenshot_ids,
                    after_screenshot_by_event,
                    after_screenshot_metadata_by_event,
                )
                events.append(event)

        return events


def _decode_events(payload: bytes) -> list[dict[str, Any]]:
    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError:
        decoded = [
            json.loads(line)
            for line in payload.decode("utf-8").splitlines()
            if line.strip()
        ]

    if isinstance(decoded, dict) and isinstance(decoded.get("events"), list):
        decoded = decoded["events"]
    elif isinstance(decoded, dict):
        decoded = [decoded]

    if not isinstance(decoded, list) or not all(isinstance(item, dict) for item in decoded):
        raise ValueError("Event chunk must contain a JSON event object or event list")
    return decoded


def _normalize_event(
    raw: dict[str, Any],
    source_type: CaptureSource,
    recording_id: UUID,
    tenant_id: UUID,
    fallback_sequence: int,
    screenshot_ids: dict[str, UUID],
    after_screenshot_by_event: dict[str, UUID],
    after_screenshot_metadata_by_event: dict[str, dict[str, Any]],
) -> SessionEvent:
    data = dict(raw.get("data")) if isinstance(raw.get("data"), dict) else {}
    raw_type = str(raw.get("type") or raw.get("event_type") or "").replace("-", "_")
    event_type = {
        "key": EventType.KEY_BURST,
        "key_burst": EventType.KEY_BURST,
        "app_switch": EventType.APP_SWITCH,
    }.get(raw_type)
    if event_type is None:
        event_type = EventType(raw_type)
    sequence = int(raw.get("sequence") or fallback_sequence)
    raw_id = raw.get("id")
    event_id = _uuid_or_default(raw_id, uuid5(recording_id, f"event:{sequence}"))
    before_id = _mapped_uuid(
        raw.get("beforeScreenshotId") or raw.get("before_screenshot_id"), screenshot_ids
    )
    after_id = _mapped_uuid(
        raw.get("afterScreenshotId") or raw.get("after_screenshot_id"), screenshot_ids
    ) or after_screenshot_by_event.get(str(raw_id))
    annotation = _pointer_annotation(
        event_type,
        event_id,
        after_id,
        raw.get("x") if raw.get("x") is not None else data.get("x"),
        raw.get("y") if raw.get("y") is not None else data.get("y"),
        data,
        after_screenshot_metadata_by_event.get(str(raw_id)),
    )
    if annotation:
        data["evidenceAnnotation"] = annotation

    page_url = raw.get("page_url") or raw.get("pageUrl") or data.get("url")
    application = (
        raw.get("application")
        or data.get("application")
        or ("Desktop" if source_type == CaptureSource.DESKTOP else None)
    )
    timestamp = _parse_datetime(raw.get("timestamp")) or datetime.now(UTC)
    duration_ms = raw.get("duration_ms") or data.get("durationMs")
    target_label = (
        raw.get("target_label")
        or raw.get("element_text")
        or data.get("targetLabel")
        or data.get("label")
    )

    return SessionEvent(
        tenant_id=tenant_id,
        id=event_id,
        sequence=sequence,
        timestamp=timestamp,
        event_type=event_type,
        page_url=page_url,
        application=application,
        window_title=raw.get("window_title") or data.get("windowTitle"),
        x=raw.get("x") if raw.get("x") is not None else data.get("x"),
        y=raw.get("y") if raw.get("y") is not None else data.get("y"),
        modifiers=raw.get("modifiers") or data.get("modifiers") or [],
        target_role=raw.get("target_role") or data.get("targetRole"),
        target_label=target_label,
        target_bounds=raw.get("target_bounds") or data.get("targetBounds"),
        safe_selector=raw.get("safe_selector"),
        element_text=raw.get("element_text"),
        before_screenshot_id=before_id,
        after_screenshot_id=after_id,
        screenshot_reference=after_id,
        duration_ms=duration_ms,
        event_data=data,
    )


def _pointer_annotation(
    event_type: EventType,
    event_id: UUID | None,
    screenshot_id: UUID | None,
    x_value: Any,
    y_value: Any,
    data: dict[str, Any],
    screenshot_metadata: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if event_type not in {EventType.CLICK, EventType.SCROLL} or event_id is None:
        return None
    if x_value is None or y_value is None:
        return None

    try:
        center_x = float(x_value)
        center_y = float(y_value)
    except (TypeError, ValueError):
        return None

    image_width: float | None = None
    image_height: float | None = None
    coordinate_space = "global_screen"
    confidence = 0.45
    source = "fallback_coordinate"

    mapped = _map_pointer_to_screenshot(data.get("pointer"), screenshot_metadata)
    if mapped:
        center_x = mapped["x"]
        center_y = mapped["y"]
        image_width = mapped["image_width"]
        image_height = mapped["image_height"]
        coordinate_space = "screenshot_pixels"
        confidence = 0.82
        source = "event_pointer"

    width = 96.0 if event_type == EventType.CLICK else 160.0
    height = 72.0 if event_type == EventType.CLICK else 110.0
    bounds = _centered_bounds(center_x, center_y, width, height, image_width, image_height)

    return {
        "type": "click_rectangle" if event_type == EventType.CLICK else "scroll_focus",
        "event_id": str(event_id),
        "screenshot_reference": str(screenshot_id) if screenshot_id else None,
        "coordinate_space": coordinate_space,
        "bounds": bounds,
        "confidence": confidence,
        "source": source,
    }


def _map_pointer_to_screenshot(
    pointer: Any, screenshot_metadata: dict[str, Any] | None
) -> dict[str, float] | None:
    if not isinstance(pointer, dict) or not isinstance(screenshot_metadata, dict):
        return None

    capture = screenshot_metadata.get("capture")
    if not isinstance(capture, dict):
        return None

    display = capture.get("display")
    point = pointer.get("pointOnDisplay")
    image_size = capture.get("imageSize")
    if (
        not isinstance(display, dict)
        or not isinstance(point, dict)
        or not isinstance(image_size, dict)
    ):
        return None

    if str(pointer.get("displayId")) != str(display.get("id")):
        return None

    display_bounds = display.get("bounds")
    if not isinstance(display_bounds, dict):
        return None

    try:
        display_scale = float(pointer.get("displayScaleFactor") or display.get("scaleFactor") or 1)
        display_width = float(display_bounds["width"]) * display_scale
        display_height = float(display_bounds["height"]) * display_scale
        image_width = float(image_size["width"])
        image_height = float(image_size["height"])
        x = float(point["x"]) * display_scale
        y = float(point["y"]) * display_scale
    except (KeyError, TypeError, ValueError):
        return None

    if display_width <= 0 or display_height <= 0 or image_width <= 0 or image_height <= 0:
        return None

    return {
        "x": x * (image_width / display_width),
        "y": y * (image_height / display_height),
        "image_width": image_width,
        "image_height": image_height,
    }


def _centered_bounds(
    center_x: float,
    center_y: float,
    width: float,
    height: float,
    image_width: float | None,
    image_height: float | None,
) -> dict[str, float]:
    x = center_x - width / 2
    y = center_y - height / 2

    if image_width is not None:
        x = min(max(0, x), max(0, image_width - width))
    if image_height is not None:
        y = min(max(0, y), max(0, image_height - height))

    return {
        "x": round(x, 2),
        "y": round(y, 2),
        "width": width,
        "height": height,
    }


def _mapped_uuid(value: Any, mapping: dict[str, UUID]) -> UUID | None:
    if not value:
        return None
    return mapping.get(str(value))


def _uuid_or_default(value: Any, default: UUID | None) -> UUID | None:
    if value:
        try:
            return UUID(str(value))
        except ValueError:
            pass
    return default


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _image_dimensions(payload: bytes) -> tuple[int, int]:
    if payload.startswith(b"\x89PNG\r\n\x1a\n") and len(payload) >= 24:
        return struct.unpack(">II", payload[16:24])
    if payload.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(payload):
            if payload[index] != 0xFF:
                index += 1
                continue
            marker = payload[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(payload):
                break
            segment_length = int.from_bytes(payload[index : index + 2], "big")
            if marker in {
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
            } and index + 7 <= len(payload):
                height = int.from_bytes(payload[index + 3 : index + 5], "big")
                width = int.from_bytes(payload[index + 5 : index + 7], "big")
                return width, height
            index += max(segment_length, 2)
    raise ValueError("Screenshot chunk is not a supported PNG or JPEG image")
