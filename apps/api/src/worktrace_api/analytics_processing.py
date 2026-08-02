"""Orchestration for one immutable workflow analytics run."""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Protocol
from uuid import UUID

from worktrace_api.analytics_provider import (
    AnalyticsProviderError,
    AnalyticsProviderUnavailable,
)
from worktrace_api.repository import Repository
from worktrace_api.schemas import AnalyticsResult, AnalyticsRun, AnalyticsRunStatus
from worktrace_api.workflow_analytics import build_comparison, step_documents

logger = logging.getLogger(__name__)


class AnalyticsProviderProtocol(Protocol):
    embedding_model: str

    def embed(self, texts: list[str], batch_size: int = 128) -> list[list[float]]: ...

    def summarize(self, workflow_name: str, result: AnalyticsResult) -> list[str]: ...


class WorkflowAnalyticsProcessor:
    def __init__(self, repo: Repository, provider: AnalyticsProviderProtocol):
        self.repo = repo
        self.provider = provider

    def process(self, run_id: UUID) -> AnalyticsRun:
        run = self._require_run(run_id)
        snapshots = self.repo.get_analytics_input_snapshots(run_id)
        try:
            self.repo.set_analytics_run_status(run_id, AnalyticsRunStatus.EMBEDDING)
            embeddings = self._embeddings(snapshots)
        except Exception as exc:
            logger.exception("Analytics embedding failed for run %s", run_id)
            self._fail(run_id, "embedding", exc)
            raise

        try:
            self.repo.set_analytics_run_status(run_id, AnalyticsRunStatus.ALIGNING)
            result = build_comparison(snapshots, embeddings)
            self.repo.set_analytics_run_status(run_id, AnalyticsRunStatus.CALCULATING)
            self.repo.save_analytics_result(
                run_id,
                result,
                None,
                AnalyticsRunStatus.SUMMARIZING,
            )
        except Exception as exc:
            logger.exception("Analytics calculation failed for run %s", run_id)
            self._fail(run_id, "alignment", exc)
            raise

        return self._summarize(run_id, run.workflow_name, result)

    def retry_summary(self, run_id: UUID) -> AnalyticsRun:
        run = self._require_run(run_id)
        result = self.repo.get_analytics_result(run_id)
        if not result:
            raise ValueError("Analytics metrics are not available; retry the full run")
        self.repo.set_analytics_run_status(run_id, AnalyticsRunStatus.SUMMARIZING)
        return self._summarize(run_id, run.workflow_name, result)

    def _embeddings(
        self, snapshots: list[dict]
    ) -> dict[tuple[UUID, UUID, str], list[float]]:
        documents = step_documents(snapshots)
        documents_by_sop: dict[UUID, list] = defaultdict(list)
        for document in documents:
            documents_by_sop[document.sop_id].append(document)

        resolved: dict[tuple[UUID, UUID, str], list[float]] = {}
        missing = []
        for sop_id, sop_documents in documents_by_sop.items():
            cached = self.repo.get_step_embeddings(
                sop_id,
                self.provider.embedding_model,
                [document.content_hash for document in sop_documents],
            )
            for document in sop_documents:
                vector = cached.get(document.content_hash)
                if vector is None:
                    missing.append(document)
                else:
                    resolved[document.cache_key] = vector

        if missing:
            generated = self.provider.embed([document.text for document in missing])
            if len(generated) != len(missing):
                raise AnalyticsProviderError("Embedding provider returned an incomplete batch")
            cache_entries = []
            for document, vector in zip(missing, generated, strict=True):
                resolved[document.cache_key] = vector
                cache_entries.append(
                    (
                        document.sop_id,
                        document.step_id,
                        self.provider.embedding_model,
                        document.content_hash,
                        vector,
                    )
                )
            self.repo.save_step_embeddings(cache_entries)
        return resolved

    def _summarize(
        self, run_id: UUID, workflow_name: str, result: AnalyticsResult
    ) -> AnalyticsRun:
        try:
            sentences = self.provider.summarize(workflow_name, result)
            return self.repo.save_analytics_result(
                run_id,
                result,
                sentences,
                AnalyticsRunStatus.COMPLETED,
            )
        except Exception as exc:
            logger.exception("Analytics summary failed for run %s", run_id)
            return self.repo.save_analytics_result(
                run_id,
                result,
                None,
                AnalyticsRunStatus.SUMMARY_FAILED,
                error_message=_safe_error(exc, "summary"),
            )

    def _require_run(self, run_id: UUID) -> AnalyticsRun:
        run = self.repo.get_analytics_run(run_id)
        if not run:
            raise LookupError("Analytics run not found")
        return run

    def _fail(self, run_id: UUID, stage: str, exc: Exception) -> None:
        self.repo.db.rollback()
        self.repo.set_analytics_run_status(
            run_id,
            AnalyticsRunStatus.FAILED,
            failure_stage=stage,
            error_message=_safe_error(exc, stage),
        )


def _safe_error(exc: Exception, stage: str) -> str:
    if isinstance(exc, AnalyticsProviderUnavailable):
        return "No LLM API key is configured for workflow analytics."
    if isinstance(exc, AnalyticsProviderError):
        return f"The AI provider could not complete the analytics {stage} stage."
    if isinstance(exc, ValueError):
        return str(exc)[:500]
    return f"Workflow analytics {stage} failed ({type(exc).__name__})."
