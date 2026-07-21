"""
SOP Generation — structured LLM Celery task
===========================================
Queue : llm
Retries : 3 (30 s countdown)

Pipeline
--------
1.  Load the WorkflowSession, annotated screenshots, and recording's custom
    SOP instruction (manual mode) from the database.
2.  Build a serializable evidence bundle (metadata + transcript + timing).
3.  Encode the annotated screenshot PNGs as vision inputs.
4.  Ask the LLM ONCE for the whole SOP as strict JSON (multimodal when images
    are available).
5.  Validate the JSON against ``GeneratedSOP``. On failure, make ONE repair
    turn that feeds the validation errors back to the model.
6.  Map the validated output to a single SOP draft and persist it via
    ``replace_session_draft_sop`` (idempotent: retries replace the draft,
    approved SOPs are never touched). No fake "full document" version is ever
    stored.
"""

import logging
from uuid import UUID

from worktrace_api.core.celery_app import celery_app
from worktrace_api.recordings import ChunkStorage
from worktrace_api.schemas import RecordingStatus
from worktrace_api.settings import get_settings
from worktrace_api.sop_provider import (
    SOPProvider,
    SOPProviderError,
    SOPProviderUnavailable,
    build_evidence_bundle,
    build_generation_messages,
    build_repair_messages,
    encode_evidence_images,
    generated_to_sop,
    parse_generated_sop,
)
from worktrace_api.tasks._repo import make_repo

logger = logging.getLogger(__name__)


def _safe_error(exc: Exception) -> str:
    """Short, non-sensitive error string for the recording row.

    Full tracebacks are written to server logs; the persisted message avoids
    raw provider responses (which can include URLs/headers). Structural
    validation errors are safe and useful, so they are kept.
    """
    if isinstance(exc, SOPProviderUnavailable):
        return "No LLM API key is configured for SOP generation."
    if isinstance(exc, SOPProviderError):
        return "The LLM provider could not complete SOP generation."
    if isinstance(exc, ValueError):
        return str(exc)[:300]
    return f"SOP generation failed ({type(exc).__name__})."


@celery_app.task(bind=True, max_retries=3)
def generate_sop_with_ai(self, recording_id: str, session_id: str, tenant_id: str) -> None:
    """Structured SOP generation task (queue: llm).

    Triggered by the chord in pipeline.py after transcription + annotation
    complete, OR by the manual ``/recordings/{id}/generate-sop`` and
    ``/recordings/{id}/retry`` routes.
    """
    settings = get_settings()
    repo = make_repo(tenant_id)
    recording_uuid = UUID(recording_id)
    session_uuid = UUID(session_id)
    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes,
    )

    try:
        repo.set_recording_status(recording_uuid, RecordingStatus.GENERATING_SOP)
        recording = repo.get_recording(recording_uuid)
        session = repo.get_session(session_uuid)
        if not session:
            logger.error("Session %s not found — aborting SOP generation.", session_id)
            repo.set_recording_status(
                recording_uuid,
                RecordingStatus.SOP_FAILED,
                "Session not found for SOP generation",
            )
            return

        custom_instruction = recording.custom_sop_instruction if recording else None
        screenshots = repo.get_screenshots_for_recording(recording_uuid)
        bundle = build_evidence_bundle(session, screenshots, custom_instruction)

        if not bundle.steps:
            logger.warning(
                "No annotated screenshots for recording %s — skipping SOP generation.",
                recording_id,
            )
            repo.set_recording_status(
                recording_uuid,
                RecordingStatus.SOP_FAILED,
                "No annotated screenshots were produced",
            )
            return

        provider = SOPProvider(settings)
        if not provider.available:
            # Missing API key is a configuration problem, not a transient one.
            # Fail cleanly as sop_failed (manually retryable after env is fixed)
            # instead of burning Celery retries that cannot succeed yet.
            repo.set_recording_status(
                recording_uuid,
                RecordingStatus.SOP_FAILED,
                "No LLM API key is configured for SOP generation",
            )
            return

        image_data_uris = encode_evidence_images(bundle, storage)
        messages = build_generation_messages(bundle, image_data_uris)

        raw = provider.complete(messages)
        try:
            generated = parse_generated_sop(raw)
            sop = generated_to_sop(generated, bundle, UUID(tenant_id), session_uuid)
        except ValueError as repair_error:
            # One repair turn: replay the evidence with the specific errors.
            logger.warning("SOP output failed validation, attempting one repair: %s", repair_error)
            repair_messages = build_repair_messages(bundle, image_data_uris, raw, str(repair_error))
            raw = provider.complete(repair_messages)
            generated = parse_generated_sop(raw)  # raises -> outer handler -> retry/sop_failed
            sop = generated_to_sop(generated, bundle, UUID(tenant_id), session_uuid)
        saved = repo.replace_session_draft_sop(session_uuid, sop)

        repo.link_recording_session(recording_uuid, session_uuid, RecordingStatus.READY_FOR_REVIEW)
        logger.info(
            "SOP v%d saved for session %s (%d steps).",
            saved.version,
            session_id,
            len(saved.steps),
        )

    except Exception as exc:
        logger.exception("SOP generation failed for session %s: %s", session_id, exc)
        repo.db.rollback()
        max_retries = int(self.max_retries or 0)
        # Config / availability problems are not worth retrying immediately.
        if isinstance(exc, SOPProviderUnavailable) or int(self.request.retries) >= max_retries:
            repo.set_recording_status(
                recording_uuid,
                RecordingStatus.SOP_FAILED,
                _safe_error(exc),
            )
            return
        repo.set_recording_status(
            recording_uuid,
            RecordingStatus.GENERATING_SOP,
            f"SOP generation failed; retrying: {_safe_error(exc)}",
        )
        raise self.retry(exc=exc, countdown=30) from exc
    finally:
        repo.db.close()
