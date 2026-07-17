import contextlib
from pathlib import Path
from typing import Any
from uuid import UUID

from faster_whisper import WhisperModel
from celery.exceptions import SoftTimeLimitExceeded

from worktrace_api.core.celery_app import celery_app
from worktrace_api.database import SessionLocal, WorkflowSessionRecord
from worktrace_api.recordings import ChunkStorage, chunk_extension
from worktrace_api.repository import Repository
from worktrace_api.schemas import (
    ChunkContentType,
    RecordingStatus,
    RecordingTranscript,
    TranscriptSegment,
)
from worktrace_api.settings import get_settings

_whisper_model: WhisperModel | None = None
_storage: ChunkStorage | None = None

# Recording statuses at which the raw audio chunks are safe to drop: ingestion
# is fully past the upload/validate phases, so the assembled audio + transcript
# are the source of truth from here on.
_AUDIO_CHUNK_SAFE_STATUSES = {
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


def get_storage() -> ChunkStorage:
    global _storage
    if _storage is None:
        settings = get_settings()
        _storage = ChunkStorage(Path(settings.recording_storage_path), settings.max_chunk_bytes)
    return _storage


def make_repo(tenant_id: str) -> Repository:
    db = SessionLocal()
    return Repository(db=db, tenant_id=UUID(tenant_id))


def _resolve_audio_file(
    session_record: WorkflowSessionRecord,
    repo: Repository,
    recording_id: UUID,
    storage: ChunkStorage,
) -> Path | None:
    # Prefer the durable assembled file written during ingestion
    # (processing._transcript -> storage.assemble). Transcribing it directly
    # avoids re-reading and re-concatenating the raw audio chunks.
    transcript = dict(session_record.transcript or {})
    audio_reference = transcript.get("audio_reference")
    if audio_reference:
        try:
            path = storage.resolve_storage_key(audio_reference)
        except ValueError:
            path = None
        if path and path.exists() and path.stat().st_size > 0:
            return path

    # Fallback (defensive / older recordings): assemble from raw audio chunks
    # and persist the reference so future runs use the assembled file.
    chunks = repo.list_recording_chunks(recording_id)
    audio_chunks = [c for c in chunks if c.content_type == ChunkContentType.AUDIO]
    if not audio_chunks:
        return None
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
    return storage.resolve_storage_key(audio_reference)


def _cleanup_audio_chunks(repo: Repository, recording_id: UUID, storage: ChunkStorage) -> None:
    # Gate on recording status: only delete once ingestion is past upload/validate.
    # Re-read the recording so we observe the latest status. Idempotent.
    recording = repo.get_recording(recording_id)
    if not recording or recording.status not in _AUDIO_CHUNK_SAFE_STATUSES:
        return
    # Delete rows first, then files. Screenshots/events chunks are untouched.
    storage_keys = repo.delete_audio_chunks(recording_id)
    for key in storage_keys:
        with contextlib.suppress(FileNotFoundError):
            storage.delete(key)


@celery_app.task(bind=True, max_retries=3, queue="audio")
def transcribe_audio(self: Any, recording_id: str, session_id: str, tenant_id: str) -> None:
    repo = make_repo(tenant_id)
    session_record: WorkflowSessionRecord | None = None
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

        if session_record.transcript and session_record.transcript.get("status") == "completed":
            return

        # Preserve the audio chunk count captured during ingestion.
        existing_chunk_count = (session_record.transcript or {}).get("audio_chunk_count", 0)

        repo.set_recording_status(UUID(recording_id), RecordingStatus.TRANSCRIBING_AUDIO)

        storage = get_storage()
        audio_path = _resolve_audio_file(session_record, repo, UUID(recording_id), storage)

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
        repo.db.close()
