from celery import chain
from worktrace_api.core.celery_app import celery_app
from worktrace_api.tasks.annotation import annotate_screenshots


@celery_app.task(bind=True, max_retries=0)
def process_recording(self, recording_id: str, session_id: str, tenant_id: str) -> None:
    pipeline = chain(
        # We will add transcribe_audio here later
        annotate_screenshots.si(recording_id, session_id, tenant_id),
        # We will add generate_sop_task here later
    )
    pipeline.apply_async()
