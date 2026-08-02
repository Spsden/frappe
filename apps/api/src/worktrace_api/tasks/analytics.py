"""Celery entry points for versioned workflow analytics runs."""

import logging
from uuid import UUID

from worktrace_api.analytics_processing import WorkflowAnalyticsProcessor
from worktrace_api.analytics_provider import AnalyticsProvider, AnalyticsProviderUnavailable
from worktrace_api.core.celery_app import celery_app
from worktrace_api.repository import Repository
from worktrace_api.settings import get_settings
from worktrace_api.tasks._repo import make_repo

logger = logging.getLogger(__name__)


def _processor(tenant_id: str) -> tuple[WorkflowAnalyticsProcessor, Repository]:
    settings = get_settings()
    repo = make_repo(tenant_id)
    provider_settings = repo.get_llm_provider_secret()
    provider = AnalyticsProvider(
        settings,
        base_url=provider_settings.base_url if provider_settings else None,
        chat_model=provider_settings.model if provider_settings else None,
        api_key=provider_settings.api_key if provider_settings else None,
    )
    return WorkflowAnalyticsProcessor(repo, provider), repo


@celery_app.task(bind=True, max_retries=2)
def process_workflow_analytics(self, run_id: str, tenant_id: str) -> None:
    processor, repo = _processor(tenant_id)
    try:
        processor.process(UUID(run_id))
    except AnalyticsProviderUnavailable:
        # Configuration cannot heal during an automatic 30-second retry loop.
        # The failed run remains available for the Settings -> manual retry flow.
        return
    except Exception as exc:
        # The processor has already persisted a safe failure state. A retry is
        # useful for transient provider/network failures; immutable inputs make
        # the operation safe to repeat.
        if int(self.request.retries) >= int(self.max_retries or 0):
            logger.error("Analytics run %s exhausted automatic retries", run_id)
            return
        raise self.retry(exc=exc, countdown=30) from exc
    finally:
        repo.db.close()


@celery_app.task(bind=True, max_retries=2)
def summarize_workflow_analytics(self, run_id: str, tenant_id: str) -> None:
    processor, repo = _processor(tenant_id)
    try:
        processor.retry_summary(UUID(run_id))
    except Exception as exc:
        if int(self.request.retries) >= int(self.max_retries or 0):
            logger.error("Analytics summary %s exhausted automatic retries", run_id)
            return
        raise self.retry(exc=exc, countdown=30) from exc
    finally:
        repo.db.close()
