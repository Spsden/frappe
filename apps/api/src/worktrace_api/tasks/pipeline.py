from uuid import UUID

from celery import chord

from worktrace_api.core.celery_app import celery_app
from worktrace_api.schemas import RecordingStatus
from worktrace_api.tasks._repo import make_repo
from worktrace_api.tasks.annotation import annotate_screenshots
from worktrace_api.tasks.sop_generation import generate_sop_with_ai
from worktrace_api.tasks.transcription import transcribe_audio


@celery_app.task(bind=True, max_retries=0)
def process_recording(self, recording_id: str, session_id: str, tenant_id: str) -> None:
    # Run transcription and annotation independently in parallel
    pipeline = chord(
        [
            transcribe_audio.si(recording_id, session_id, tenant_id),
            annotate_screenshots.si(recording_id, session_id, tenant_id),
        ],
        finish_evidence_processing.si(recording_id, session_id, tenant_id),
    )
    pipeline.apply_async()


@celery_app.task(bind=True, max_retries=0)
def finish_evidence_processing(
    self, recording_id: str, session_id: str, tenant_id: str
) -> None:
    repo = make_repo(tenant_id)
    recording_uuid = UUID(recording_id)
    session_uuid = UUID(session_id)
    try:
        recording = repo.get_recording(recording_uuid)
        if not recording:
            return
        if recording.manual_mode:
            repo.link_recording_session(
                recording_uuid,
                session_uuid,
                RecordingStatus.AWAITING_MANUAL_REVIEW,
            )
            return

        generate_sop_with_ai.delay(recording_id, session_id, tenant_id)
    finally:
        repo.db.close()
