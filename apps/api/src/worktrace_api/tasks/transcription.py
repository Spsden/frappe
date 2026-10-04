import contextlib
import os
import tempfile
from pathlib import Path
from typing import Any
from uuid import UUID

from celery.exceptions import SoftTimeLimitExceeded
from faster_whisper import WhisperModel

from worktrace_api.core.celery_app import celery_app
from worktrace_api.database import SessionLocal, WorkflowSessionRecord
from worktrace_api.recordings import LocalChunkStorage, get_chunk_storage, chunk_extension
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    ChunkContentType,
    RecordingStatus,
    RecordingTranscript,
    TranscriptSegment,
)
from worktrace_api.settings import get_settings

_whisper_model: WhisperModel | None = None
_storage = None  # LocalChunkStorage | S3ChunkStorage — resolved lazily

# Recording statuses at which the raw audio chunks are safe to drop: ingestion
# is fully past the upload/validate phases, so the assembled audio + transcript
# are the source of truth from here on.
_AUDIO_CHUNK_SAFE_STATUSES = {
    RecordingStatus.AWAITING_MANUAL_REVIEW,
    RecordingStatus.READY_FOR_REVIEW,
    RecordingStatus.COMPLETED,
}


def get_whisper_model() -> WhisperModel:
    global _whisper_model
    if _whisper_model is None:
        settings = get_settings()
        # CPU + int8: ~75% smaller memory footprint than openai-whisper's
        # default FP16 and noticeably faster on CPU. CTranslate2 backend,
        # so neither torch nor the nvidia-* CUDA wheels are needed.
        _whisper_model = WhisperModel(
            settings.whisper_model_size,
            device="cpu",
            compute_type="int8",
        )
    return _whisper_model


def get_storage():
    """Return the configured chunk storage backend (lazy singleton)."""
    global _storage
    if _storage is None:
        settings = get_settings()
        _storage = get_chunk_storage(settings)
    return _storage


def make_repo(tenant_id: str) -> Repository:
    db = SessionLocal()
    return Repository(db=db, tenant_id=UUID(tenant_id))


def _resolve_audio_file(
    session_record: WorkflowSessionRecord,
    repo: Repository,
    recording_id: UUID,
    storage,
) -> tuple[Path, bool]:
    """Return (path_to_audio_file, is_temp_file).

    - Local backend: resolves to the actual path on disk; is_temp_file=False.
    - S3 backend: downloads the assembled audio to a NamedTemporaryFile and
      returns its path; is_temp_file=True.  The caller is responsible for
      deleting the temp file in a finally block.

    faster-whisper's transcribe() requires a real local file path (it calls the
    CTranslate2 C-extension directly).  It cannot accept bytes or file objects.
    """
    transcript = dict(session_record.transcript or {})
    audio_reference = transcript.get("audio_reference")

    if audio_reference:
        if isinstance(storage, LocalChunkStorage):
            try:
                path = storage.resolve_storage_key(audio_reference)
            except ValueError:
                path = None
            if path and path.exists() and path.stat().st_size > 0:
                return path, False
        else:
            # S3 backend: check existence and download to a temp file.
            if storage.exists(audio_reference):
                data = storage.read(audio_reference)
                suffix = Path(audio_reference).suffix or ".webm"
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
                try:
                    tmp.write(data)
                    tmp.flush()
                finally:
                    tmp.close()
                return Path(tmp.name), True

    # Fallback (defensive / older recordings): assemble from raw audio chunks
    # and persist the reference so future runs use the assembled file.
    chunks = repo.list_recording_chunks(recording_id)
    audio_chunks = [c for c in chunks if c.content_type == ChunkContentType.AUDIO]
    if not audio_chunks:
        return None, False

    media_types = {c.media_type for c in audio_chunks}
    if len(media_types) > 1:
        raise ValueError("Audio chunks must use one media type")
    media_type = next(iter(media_types))
    extension = chunk_extension(ChunkContentType.AUDIO, media_type)
    audio_reference, _, _ = storage.assemble(
        UUID(audio_chunks[0].tenant_id),
        UUID(audio_chunks[0].recording_id),
        audio_chunks,
        f"audio{extension}",
    )
    transcript["audio_reference"] = audio_reference
    session_record.transcript = transcript
    repo.db.commit()

    if isinstance(storage, LocalChunkStorage):
        return storage.resolve_storage_key(audio_reference), False
    else:
        # S3 backend: download assembled file to a temp file for whisper.
        data = storage.read(audio_reference)
        suffix = Path(audio_reference).suffix or ".webm"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            tmp.write(data)
            tmp.flush()
        finally:
            tmp.close()
        return Path(tmp.name), True


def _cleanup_audio_chunks(repo: Repository, recording_id: UUID, storage) -> None:
    # Gate on recording status: only delete once ingestion is past upload/validate.
    # Re-read the recording so we observe the latest status. Idempotent.
    recording = repo.get_recording(recording_id)
    if not recording or recording.status not in _AUDIO_CHUNK_SAFE_STATUSES:
        return
    # Delete rows first, then files. Screenshots/events chunks are untouched.
    storage_keys = repo.delete_audio_chunks(recording_id)
    for key in storage_keys:
        with contextlib.suppress(Exception):
            storage.delete(key)


@celery_app.task(bind=True, max_retries=3, queue="audio")
def transcribe_audio(self: Any, recording_id: str, session_id: str, tenant_id: str) -> None:
    repo = make_repo(tenant_id)
    session_record: WorkflowSessionRecord | None = None
    audio_path: Path | None = None
    is_temp_file: bool = False

    try:
        recording = repo.get_recording(UUID(recording_id))
        if not recording:
            return

        # GUARD: Check if already transcribed to prevent double processing
        session_record = repo.db.query(WorkflowSessionRecord).filter(
            WorkflowSessionRecord.id == session_id
        ).first()

        if not session_record:
            return

        if not recording.has_audio:
            if not session_record.transcript:
                transcript = RecordingTranscript(
                    status="not_recorded",
                    text=None,
                    segments=[],
                    audio_chunk_count=0,
                )
                session_record.transcript = transcript.model_dump(mode="json")
                repo.db.commit()
            return

        if session_record.transcript and session_record.transcript.get("status") == "completed":
            return

        # Preserve the audio chunk count captured during ingestion.
        existing_chunk_count = (session_record.transcript or {}).get("audio_chunk_count", 0)

        repo.set_recording_status(UUID(recording_id), RecordingStatus.TRANSCRIBING_AUDIO)

        storage = get_storage()
        audio_path, is_temp_file = _resolve_audio_file(
            session_record, repo, UUID(recording_id), storage
        )

        if audio_path is None:
            # No audio uploaded.
            transcript = RecordingTranscript(
                status="completed",
                text="",
                segments=[],
                audio_chunk_count=0,
            )
            session_record.transcript = transcript.model_dump(mode="json")
            repo.db.commit()
            return

        model = get_whisper_model()
        # faster-whisper returns a lazy generator: inference only runs as we
        # iterate, so consume it exactly once (no `result["text"]` to fall
        # back on — we join segment texts ourselves).
        segments_iter, _info = model.transcribe(
            str(audio_path),
            vad_filter=True,
            beam_size=5,
        )

        segments: list[TranscriptSegment] = []
        parts: list[str] = []
        for seg in segments_iter:
            text = seg.text.strip()
            segments.append(
                TranscriptSegment(
                    start_ms=int(seg.start * 1000),
                    end_ms=int(seg.end * 1000),
                    text=text,
                )
            )
            if text:
                parts.append(text)

        transcript = RecordingTranscript(
            status="completed",
            text=" ".join(parts),
            segments=segments,
            audio_chunk_count=existing_chunk_count,
        )
        session_record.transcript = transcript.model_dump(mode="json")
        repo.db.commit()

        # The derived transcript is now durable: the raw audio chunks are no
        # longer needed. Drop them (files + rows), gated on recording status.
        # Screenshots/events chunks are intentionally left in place.
        _cleanup_audio_chunks(repo, UUID(recording_id), storage)

    except SoftTimeLimitExceeded:
        repo.set_recording_status(
            UUID(recording_id), RecordingStatus.FAILED, "Transcription timed out"
        )
        raise self.retry(countdown=30) from None
    except Exception as e:
        repo.set_recording_status(
            UUID(recording_id), RecordingStatus.FAILED, f"Transcription failed: {str(e)}"
        )
        if session_record:
            transcript = RecordingTranscript(
                status="failed",
                text=None,
                segments=[],
                audio_chunk_count=0,
            )
            session_record.transcript = transcript.model_dump(mode="json")
            repo.db.commit()
        raise
    finally:
        # If we downloaded the audio to a local temp file (S3 backend), clean it up
        # regardless of success or failure.
        if is_temp_file and audio_path and audio_path.exists():
            with contextlib.suppress(Exception):
                os.unlink(audio_path)
        repo.db.close()
