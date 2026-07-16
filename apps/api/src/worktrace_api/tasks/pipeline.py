from celery import chord
from worktrace_api.core.celery_app import celery_app
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
        generate_sop_with_ai.si(recording_id, session_id, tenant_id)
    )
    pipeline.apply_async()
