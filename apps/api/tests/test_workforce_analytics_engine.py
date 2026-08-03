from uuid import uuid4

from worktrace_api.analytics_provider import _summary_aggregate
from worktrace_api.schemas import SOP, SOPStatus, SOPStep
from worktrace_api.workflow_analytics import (
    build_comparison_from_analysis,
    prepare_workflow_analysis,
    step_documents,
)
from worktrace_api.workforce_clustering import cluster_workforce, score_workforce_friction


def _snapshot(reference, duration_ms, steps):
    sop = SOP(
        tenant_id=uuid4(),
        source_session_id=uuid4(),
        status=SOPStatus.APPROVED,
        title="Approve an invoice",
        steps=[
            SOPStep(
                position=index,
                title=title,
                instruction=f"Complete {title.lower()}.",
                observed_duration_ms=duration,
            )
            for index, (title, duration) in enumerate(steps, start=1)
        ],
    )
    return {
        "recording_id": str(uuid4()),
        "duration_ms": duration_ms,
        "reference": reference,
        "sop": sop.model_dump(mode="json"),
    }


def _vectors(snapshots):
    basis = {
        "Open invoice": [1.0, 0.0, 0.0, 0.0],
        "Verify supplier": [0.0, 1.0, 0.0, 0.0],
        "Approve invoice": [0.0, 0.0, 1.0, 0.0],
        "Notify finance": [0.0, 0.0, 0.0, 1.0],
    }
    vectors = {}
    for snapshot in snapshots:
        sop = SOP.model_validate(snapshot["sop"])
        documents = {item.step_id: item for item in step_documents([snapshot])}
        for step in sop.steps:
            document = documents[step.id]
            vectors[document.cache_key] = basis[step.title]
    return vectors


def _analysis(snapshots):
    return prepare_workflow_analysis(
        snapshots,
        _vectors(snapshots),
        minimum_recordings=6,
        maximum_recordings=50,
    )


def test_finds_repeatable_execution_paths_without_singleton_clusters():
    snapshots = [
        _snapshot(
            f"Direct {index}",
            8_000 + index * 100,
            [("Open invoice", 2_000), ("Approve invoice", 4_000 + index * 100)],
        )
        for index in range(4)
    ]
    snapshots.extend(
        _snapshot(
            f"Verified {index}",
            15_000 + index * 200,
            [
                ("Open invoice", 2_000),
                ("Verify supplier", 6_000 + index * 200),
                ("Approve invoice", 4_000),
                ("Notify finance", 2_000),
            ],
        )
        for index in range(4)
    )
    analysis = _analysis(snapshots)

    first = cluster_workforce(analysis)
    second = cluster_workforce(analysis)

    assert first == second
    assert first.selected_k == 2
    assert sorted(cluster.recording_count for cluster in first.summaries) == [4, 4]
    assert all(cluster.recording_count >= 2 for cluster in first.summaries)
    assert {cluster.path_signature.count(">") for cluster in first.summaries} == {1, 3}


def test_homogeneous_population_reports_insufficient_separation():
    snapshots = [
        _snapshot(
            f"Same {index}",
            8_000,
            [("Open invoice", 2_000), ("Approve invoice", 4_000)],
        )
        for index in range(6)
    ]

    clusters = cluster_workforce(_analysis(snapshots))

    assert clusters.selected_k == 1
    assert clusters.silhouette is None
    assert clusters.quality == "insufficient_separation"
    assert clusters.summaries[0].recording_count == 6


def test_friction_uses_observed_samples_and_leaves_sparse_steps_unscored():
    snapshots = []
    for index in range(6):
        snapshots.append(
            _snapshot(
                f"Run {index}",
                20_000 + index * 500,
                [
                    ("Open invoice", None if index == 0 else 1_000 + index * 100),
                    ("Verify supplier", 2_000 + index * 1_000),
                    ("Approve invoice", 3_000),
                    *(([("Notify finance", 500)]) if index < 2 else []),
                ],
            )
        )
    analysis = _analysis(snapshots)
    clusters = cluster_workforce(analysis)

    result = score_workforce_friction(analysis, clusters)
    population = {item.label: item for item in result.friction if item.cluster_id is None}

    assert population["Open invoice"].sample_count == 5
    assert population["Open invoice"].mean_duration_ms == 1_300
    assert population["Notify finance"].sample_count == 2
    assert population["Notify finance"].friction_score is None
    assert population["Notify finance"].confidence == "insufficient"
    assert (
        population["Verify supplier"].friction_score > population["Approve invoice"].friction_score
    )
    assert len(result.heatmap) == len(analysis.groups) * clusters.selected_k


def test_summary_payload_contains_population_metrics_without_employee_identity():
    snapshots = [
        _snapshot(
            f"Employee {index}",
            8_000 + index * 100,
            [("Open invoice", 2_000), ("Approve invoice", 4_000 + index * 100)],
        )
        for index in range(6)
    ]
    analysis = _analysis(snapshots)
    clusters = cluster_workforce(analysis)
    workforce = score_workforce_friction(analysis, clusters)
    result = build_comparison_from_analysis(analysis).model_copy(update={"workforce": workforce})

    payload = _summary_aggregate("Approve invoices", result)
    serialized = str(payload)

    assert "workforce" in payload
    assert "population_friction" in payload["workforce"]
    assert "Employee 0" not in serialized
    assert str(snapshots[0]["recording_id"]) not in serialized
    assert "recording_id" not in serialized
