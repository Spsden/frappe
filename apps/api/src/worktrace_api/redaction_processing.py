"""Recording-level orchestration for screenshot privacy redaction."""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from worktrace_api.annotation_render import render_annotated_png
from worktrace_api.recordings import ChunkStorage
from worktrace_api.redaction import PrivacyRedactor
from worktrace_api.repository import Repository
from worktrace_api.schemas import Screenshot, WorkflowSession
from worktrace_api.settings import Settings


def _atomic_write(storage: ChunkStorage, storage_key: str, payload: bytes) -> None:
    destination = storage.resolve_storage_key(storage_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.tmp")
    temporary.write_bytes(payload)
    temporary.replace(destination)


def _redacted_key(storage_key: str) -> str:
    path = Path(storage_key)
    return str(path.with_name(f"{path.stem}-redacted.png")).replace("\\", "/")


def _annotated_key(storage_key: str) -> str:
    path = Path(storage_key)
    return str(path.with_name(f"{path.stem}-annotated.png")).replace("\\", "/")


def _effective_annotations(
    screenshot: Screenshot,
    session: WorkflowSession,
) -> list[dict]:
    if screenshot.annotations is not None:
        return list(screenshot.annotations)

    annotations: list[dict] = []
    for event in session.events:
        annotation = (event.event_data or {}).get("evidenceAnnotation")
        if not isinstance(annotation, dict) or "bounds" not in annotation:
            continue
        target = event.screenshot_reference or event.after_screenshot_id
        if target != screenshot.id or annotation.get("coordinate_space") != "screenshot_pixels":
            continue
        annotations.append(
            {
                **annotation,
                "label": event.target_label,
                "role": event.target_role,
            }
        )
    return annotations


class RecordingRedactionProcessor:
    def __init__(
        self,
        repo: Repository,
        settings: Settings,
        redactor: PrivacyRedactor | None = None,
    ):
        self.repo = repo
        self.storage = ChunkStorage(
            root=settings.recording_storage_path,
            max_chunk_bytes=settings.max_chunk_bytes,
        )
        self.redactor = redactor or PrivacyRedactor(
            model=settings.redaction_model,
            hf_token=settings.hf_token,
            score_threshold=settings.redaction_score_threshold,
            blur_radius=settings.redaction_blur_radius,
            max_dimension_px=settings.redaction_max_dimension_px,
        )

    def process(self, run_id: UUID) -> None:
        run = self.repo.get_redaction_run(run_id)
        if not run:
            raise LookupError("Redaction run not found")
        recording = self.repo.get_recording(run.recording_id)
        if not recording or not recording.session_id:
            raise LookupError("Recording session not found")
        session = self.repo.get_session(recording.session_id)
        if not session:
            raise LookupError("Recording session not found")

        self.repo.start_redaction_run(run_id)
        screenshots = self.repo.get_screenshots_for_recording(run.recording_id)
        detector_mode = "model_and_rules"
        warning_message: str | None = None

        for screenshot in screenshots:
            self.repo.start_screenshot_redaction(run_id, screenshot.id)
            try:
                original_bytes = self.storage.read(screenshot.storage_key)
                result = self.redactor.redact(original_bytes)
                detector_mode = result.detector_mode
                warning_message = result.warning_message or warning_message

                privacy_key = _redacted_key(screenshot.storage_key)
                _atomic_write(self.storage, privacy_key, result.image_bytes)

                annotated_key: str | None = None
                if screenshot.redaction_status == "redacted":
                    annotated_key = screenshot.annotated_storage_key or _annotated_key(
                        screenshot.storage_key
                    )
                    annotated = render_annotated_png(
                        result.image_bytes,
                        _effective_annotations(screenshot, session),
                    )
                    _atomic_write(self.storage, annotated_key, annotated)

                self.repo.finish_screenshot_redaction(
                    run_id,
                    screenshot.id,
                    status="redacted" if result.regions else "clear",
                    redaction_count=len(result.regions),
                    storage_key=privacy_key,
                    annotated_storage_key=annotated_key,
                )
            except Exception:
                self.repo.finish_screenshot_redaction(
                    run_id,
                    screenshot.id,
                    status="failed",
                    redaction_count=0,
                    storage_key=None,
                    annotated_storage_key=None,
                )

        self.repo.finish_redaction_run(
            run_id,
            detector_mode=detector_mode,
            warning_message=warning_message,
        )
