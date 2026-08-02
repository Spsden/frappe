"""Celery entry point for explicitly requested recording redaction."""

import logging
from uuid import UUID

from worktrace_api.core.celery_app import celery_app
from worktrace_api.redaction_processing import RecordingRedactionProcessor
from worktrace_api.settings import get_settings
from worktrace_api.tasks._repo import make_repo

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    max_retries=1,
    queue="vision",
    soft_time_limit=900,
    time_limit=960,
)
def redact_recording_screenshots(self, run_id: str, tenant_id: str) -> None:
    repo = make_repo(tenant_id)
    run_uuid = UUID(run_id)
    try:
        RecordingRedactionProcessor(repo, get_settings()).process(run_uuid)
    except Exception as exc:
        logger.exception("Redaction run %s failed", run_id)
        repo.fail_redaction_run(run_uuid, "Screenshot redaction failed")
        if int(self.request.retries) < int(self.max_retries or 0):
            raise self.retry(exc=exc, countdown=30) from exc
    finally:
        repo.db.close()
