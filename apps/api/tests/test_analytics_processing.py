from uuid import UUID

import pytest
from conftest import TEST_TENANT_ID, TEST_USER_ID
from test_workflow_analytics import _add_recording

from worktrace_api.analytics_processing import WorkflowAnalyticsProcessor
from worktrace_api.analytics_provider import AnalyticsProviderError
from worktrace_api.database import SessionLocal
from worktrace_api.repository import Repository
from worktrace_api.schemas import AnalyticsRunMode

TENANT_ID = UUID(TEST_TENANT_ID)
USER_ID = UUID(TEST_USER_ID)


class FakeProvider:
    embedding_model = "test-embedding-model"

    def __init__(self, fail_summary: bool = False):
        self.embed_calls = 0
        self.fail_summary = fail_summary

    def embed(self, texts, batch_size=128):
        self.embed_calls += 1
        return [[1.0, 0.0, 0.0, 0.0] for _ in texts]

    def summarize(self, workflow_name, result):
        if self.fail_summary:
            raise AnalyticsProviderError("provider response must not leak")
        return [
            f"Two approved paths were compared for {workflow_name}.",
            "The faster selected path completed the workflow in less time.",
            "Review the optional steps before standardising either approach.",
        ]


def _run(repo):
    workflow = repo.create_workflow("Approve a refund", created_by=USER_ID)
    first_id, _, _ = _add_recording(
        repo,
        workflow.id,
        workflow.name,
        reference="Quick check",
        duration_ms=3_000,
    )
    second_id, _, _ = _add_recording(
        repo,
        workflow.id,
        workflow.name,
        reference="Detailed check",
        duration_ms=5_000,
    )
    return repo.create_analytics_run(
        workflow.id,
        mode=AnalyticsRunMode.SELECTED_COMPARISON,
        recording_ids=[first_id, second_id],
        created_by=USER_ID,
        embedding_model="test-embedding-model",
        algorithm_version="test-v1",
    )


def _workforce_run(repo):
    workflow = repo.create_workflow("Process purchase orders", created_by=USER_ID)
    for index in range(6):
        _add_recording(
            repo,
            workflow.id,
            workflow.name,
            reference=f"Operator {index + 1}",
            duration_ms=4_000,
        )
    return repo.create_analytics_run(
        workflow.id,
        mode=AnalyticsRunMode.WORKFORCE,
        created_by=USER_ID,
        embedding_model="test-embedding-model",
        algorithm_version="workforce-test-v1",
    )


def test_processor_caches_embeddings_and_completes_run():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        run = _run(repo)
        provider = FakeProvider()

        completed = WorkflowAnalyticsProcessor(repo, provider).process(run.id)

        assert completed.status == "completed"
        assert completed.result is not None
        assert completed.result.overview.fastest_duration_ms == 3_000
        assert len(completed.executive_summary or []) == 3
        assert provider.embed_calls == 1

        # A regenerated analytics version uses the same approved SOP snapshots,
        # so the step vectors should come entirely from the cache.
        rerun = repo.create_analytics_run(
            run.workflow_id,
            mode=AnalyticsRunMode.SELECTED_COMPARISON,
            recording_ids=[item.recording_id for item in run.inputs],
            created_by=USER_ID,
            embedding_model=provider.embedding_model,
            algorithm_version="test-v1",
        )
        provider.embed_calls = 0
        WorkflowAnalyticsProcessor(repo, provider).process(rerun.id)
        assert provider.embed_calls == 0


def test_summary_failure_preserves_metrics_and_can_be_retried():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        run = _run(repo)
        provider = FakeProvider(fail_summary=True)
        processor = WorkflowAnalyticsProcessor(repo, provider)

        failed = processor.process(run.id)

        assert failed.status == "summary_failed"
        assert failed.result is not None
        assert failed.executive_summary is None
        assert failed.failure_stage == "summary"
        assert "provider response" not in (failed.error_message or "")

        provider.fail_summary = False
        completed = processor.retry_summary(run.id)
        assert completed.status == "completed"
        assert len(completed.executive_summary or []) == 3


def test_processor_builds_population_metrics_for_workforce_run():
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        run = _workforce_run(repo)

        completed = WorkflowAnalyticsProcessor(repo, FakeProvider()).process(run.id)

        assert completed.status == "completed"
        assert completed.result is not None
        assert completed.result.overview.recording_count == 6
        assert completed.result.workforce is not None
        assert completed.result.workforce.overview.selected_k == 1
        assert completed.result.workforce.overview.cluster_quality == "insufficient_separation"
        assert completed.result.workforce.clusters[0].recording_count == 6


def test_workforce_failure_keeps_the_specific_processing_stage(monkeypatch):
    with SessionLocal() as db:
        repo = Repository(db, TENANT_ID)
        run = _workforce_run(repo)
        monkeypatch.setattr(
            "worktrace_api.analytics_processing.cluster_workforce",
            lambda _analysis: (_ for _ in ()).throw(ValueError("bad cluster input")),
        )

        with pytest.raises(ValueError, match="bad cluster input"):
            WorkflowAnalyticsProcessor(repo, FakeProvider()).process(run.id)

        failed = repo.get_analytics_run(run.id)
        assert failed is not None
        assert failed.status == "failed"
        assert failed.failure_stage == "clustering"
        assert failed.error_message == "bad cluster input"
