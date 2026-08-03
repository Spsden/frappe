"""Deterministic population clustering and workflow friction metrics."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from statistics import mean, median, pstdev

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from worktrace_api.schemas import (
    AnalyticsClusterMember,
    AnalyticsClusterSummary,
    AnalyticsFrictionMetric,
    AnalyticsHeatmapCell,
    AnalyticsWorkforceOverview,
    AnalyticsWorkforceResult,
)
from worktrace_api.workflow_analytics import WorkflowAnalysis

WORKFORCE_ALGORITHM_VERSION = "ordered-semantic-kmeans-v1"
_MINIMUM_SILHOUETTE = 0.20
_RANDOM_STATE = 79


@dataclass(frozen=True)
class WorkforceClusters:
    assignments: tuple[int, ...]
    selected_k: int
    silhouette: float | None
    quality: str
    summaries: tuple[AnalyticsClusterSummary, ...]


@dataclass(frozen=True)
class _MetricDraft:
    group_id: str
    label: str
    cluster_id: str | None
    sample_count: int
    population_count: int
    mean_duration_ms: int | None
    median_duration_ms: int | None
    standard_deviation_ms: int | None
    coefficient_of_variation: float | None
    presence_frequency: float


def cluster_workforce(analysis: WorkflowAnalysis) -> WorkforceClusters:
    """Find 2–4 useful execution-path groups, or one honest fallback group."""
    matrix = _feature_matrix(analysis)
    candidates: list[tuple[float, int, np.ndarray, np.ndarray]] = []
    distinct_rows = len(np.unique(matrix, axis=0))
    maximum_k = min(4, len(analysis.recordings) // 2, distinct_rows)
    for cluster_count in range(2, maximum_k + 1):
        model = KMeans(
            n_clusters=cluster_count,
            random_state=_RANDOM_STATE,
            n_init=20,
            algorithm="lloyd",
        ).fit(matrix)
        counts = Counter(int(value) for value in model.labels_)
        if len(counts) != cluster_count or min(counts.values()) < 2:
            continue
        score = float(silhouette_score(matrix, model.labels_))
        if math.isfinite(score):
            candidates.append((score, cluster_count, model.labels_, model.cluster_centers_))

    if not candidates:
        return _single_cluster(analysis)

    score, cluster_count, raw_labels, centers = max(
        candidates,
        key=lambda candidate: (candidate[0], -candidate[1]),
    )
    if score < _MINIMUM_SILHOUETTE:
        return _single_cluster(analysis)

    assignments = _stable_cluster_labels(analysis, raw_labels)
    summaries = _cluster_summaries(analysis, assignments, matrix, centers, raw_labels)
    return WorkforceClusters(
        assignments=assignments,
        selected_k=cluster_count,
        silhouette=round(score, 4),
        quality=_cluster_quality(score),
        summaries=summaries,
    )


def score_workforce_friction(
    analysis: WorkflowAnalysis,
    clusters: WorkforceClusters,
) -> AnalyticsWorkforceResult:
    """Calculate transparent duration/variance friction without imputing missing time."""
    scopes: list[tuple[str | None, tuple[int, ...]]] = [
        (None, tuple(range(len(analysis.recordings))))
    ]
    scopes.extend(
        (
            f"path-{cluster_index + 1}",
            tuple(
                index
                for index, assignment in enumerate(clusters.assignments)
                if assignment == cluster_index
            ),
        )
        for cluster_index in range(clusters.selected_k)
    )

    drafts = [
        _metric_draft(analysis, group_index, cluster_id, member_indexes)
        for cluster_id, member_indexes in scopes
        for group_index in range(len(analysis.groups))
    ]
    scores = _friction_scores(drafts)
    metrics = tuple(
        AnalyticsFrictionMetric(
            group_id=draft.group_id,
            label=draft.label,
            cluster_id=draft.cluster_id,
            sample_count=draft.sample_count,
            population_count=draft.population_count,
            mean_duration_ms=draft.mean_duration_ms,
            median_duration_ms=draft.median_duration_ms,
            standard_deviation_ms=draft.standard_deviation_ms,
            coefficient_of_variation=draft.coefficient_of_variation,
            presence_frequency=draft.presence_frequency,
            optional_frequency=round(1 - draft.presence_frequency, 4),
            friction_score=scores.get((draft.cluster_id, draft.group_id)),
            confidence=_confidence(draft.sample_count),
        )
        for draft in drafts
    )
    cluster_metrics = [metric for metric in metrics if metric.cluster_id is not None]
    heatmap = [
        AnalyticsHeatmapCell(
            group_id=metric.group_id,
            cluster_id=metric.cluster_id or "",
            present=metric.sample_count > 0,
            sample_count=metric.sample_count,
            mean_duration_ms=metric.mean_duration_ms,
            standard_deviation_ms=metric.standard_deviation_ms,
            friction_score=metric.friction_score,
            confidence=metric.confidence,
        )
        for metric in cluster_metrics
    ]
    return AnalyticsWorkforceResult(
        overview=AnalyticsWorkforceOverview(
            recording_count=len(analysis.recordings),
            selected_k=clusters.selected_k,
            silhouette_score=clusters.silhouette,
            cluster_quality=clusters.quality,
        ),
        clusters=list(clusters.summaries),
        friction=list(metrics),
        heatmap=heatmap,
    )


def _feature_matrix(analysis: WorkflowAnalysis) -> np.ndarray:
    rows: list[list[float]] = []
    feature_weights: list[float] = []
    for _group in analysis.groups:
        feature_weights.extend((1.6, 0.8, 0.35, 0.8, 0.7))
    feature_weights.extend((0.8, 0.8, 0.7, 0.7, 0.7))

    for recording_index, recording in enumerate(analysis.recordings):
        positions = {
            step.step.id: index / max(1, len(recording.steps) - 1)
            for index, step in enumerate(recording.steps)
        }
        row: list[float] = []
        present_counts = Counter()
        for classification, group in zip(analysis.classifications, analysis.groups, strict=True):
            step = group.members.get(recording_index)
            present = step is not None
            if present:
                present_counts[classification] += 1
            has_timing = bool(step and step.duration_ms is not None)
            centroid = group.centroid()
            row.extend(
                (
                    float(present),
                    positions.get(step.step.id, 0.0) if step else 0.0,
                    float(has_timing),
                    math.log1p(step.duration_ms) if has_timing and step else 0.0,
                    1 - _cosine(step.vector, centroid) if step else 0.0,
                )
            )
        group_count = max(1, len(analysis.groups))
        row.extend(
            (
                math.log1p(recording.duration_ms),
                len(recording.steps) / group_count,
                present_counts["shared"] / group_count,
                present_counts["optional"] / group_count,
                present_counts["path_specific"] / group_count,
            )
        )
        rows.append(row)

    scaled = StandardScaler().fit_transform(np.asarray(rows, dtype=float))
    return scaled * np.asarray(feature_weights, dtype=float)


def _stable_cluster_labels(
    analysis: WorkflowAnalysis,
    raw_labels: np.ndarray,
) -> tuple[int, ...]:
    raw_values = sorted(set(int(value) for value in raw_labels))
    ordered = sorted(
        raw_values,
        key=lambda value: (
            min(
                _path_signature(analysis, index)
                for index, label in enumerate(raw_labels)
                if int(label) == value
            ),
            mean(
                analysis.recordings[index].duration_ms
                for index, label in enumerate(raw_labels)
                if int(label) == value
            ),
            value,
        ),
    )
    remap = {raw: stable for stable, raw in enumerate(ordered)}
    return tuple(remap[int(value)] for value in raw_labels)


def _cluster_summaries(
    analysis: WorkflowAnalysis,
    assignments: tuple[int, ...],
    matrix: np.ndarray,
    centers: np.ndarray,
    raw_labels: np.ndarray,
) -> tuple[AnalyticsClusterSummary, ...]:
    raw_by_stable = {
        stable: int(
            raw_labels[next(index for index, value in enumerate(assignments) if value == stable)]
        )
        for stable in sorted(set(assignments))
    }
    summaries: list[AnalyticsClusterSummary] = []
    for cluster_index in sorted(set(assignments)):
        indexes = [index for index, value in enumerate(assignments) if value == cluster_index]
        raw_cluster = raw_by_stable[cluster_index]
        representative = min(
            indexes,
            key=lambda index: (
                float(np.linalg.norm(matrix[index] - centers[raw_cluster])),
                index,
            ),
        )
        signatures = [_path_signature(analysis, index) for index in indexes]
        signature_counts = Counter(signatures)
        signature = min(
            signature_counts,
            key=lambda value: (-signature_counts[value], signatures.index(value)),
        )
        members = [
            AnalyticsClusterMember(
                recording_id=analysis.recordings[index].recording_id,
                label=analysis.recordings[index].label,
                total_duration_ms=analysis.recordings[index].duration_ms,
            )
            for index in indexes
        ]
        summaries.append(
            AnalyticsClusterSummary(
                cluster_id=f"path-{cluster_index + 1}",
                label=f"Path group {cluster_index + 1}",
                recording_count=len(indexes),
                average_duration_ms=round(
                    mean(analysis.recordings[index].duration_ms for index in indexes)
                ),
                average_step_count=round(
                    mean(len(analysis.recordings[index].steps) for index in indexes), 2
                ),
                representative_recording_id=analysis.recordings[representative].recording_id,
                path_signature=signature,
                members=members,
            )
        )
    return tuple(summaries)


def _single_cluster(analysis: WorkflowAnalysis) -> WorkforceClusters:
    assignments = tuple(0 for _ in analysis.recordings)
    matrix = _feature_matrix(analysis)
    center = np.asarray([matrix.mean(axis=0)])
    raw = np.zeros(len(analysis.recordings), dtype=int)
    return WorkforceClusters(
        assignments=assignments,
        selected_k=1,
        silhouette=None,
        quality="insufficient_separation",
        summaries=_cluster_summaries(analysis, assignments, matrix, center, raw),
    )


def _metric_draft(
    analysis: WorkflowAnalysis,
    group_index: int,
    cluster_id: str | None,
    member_indexes: tuple[int, ...],
) -> _MetricDraft:
    group = analysis.groups[group_index]
    present = [group.members[index] for index in member_indexes if index in group.members]
    measured = [step.duration_ms for step in present if step.duration_ms is not None]
    measured_values = [int(value) for value in measured]
    average = mean(measured_values) if measured_values else None
    deviation = pstdev(measured_values) if measured_values else None
    coefficient = (
        (
            deviation / average
            if average is not None and average > 0 and deviation is not None
            else 0.0
        )
        if measured_values
        else None
    )
    return _MetricDraft(
        group_id=analysis.group_ids[group_index],
        label=group.label(),
        cluster_id=cluster_id,
        sample_count=len(measured_values),
        population_count=len(member_indexes),
        mean_duration_ms=round(average) if average is not None else None,
        median_duration_ms=round(median(measured_values)) if measured_values else None,
        standard_deviation_ms=round(deviation) if deviation is not None else None,
        coefficient_of_variation=round(coefficient, 4) if coefficient is not None else None,
        presence_frequency=round(len(present) / len(member_indexes), 4),
    )


def _friction_scores(
    drafts: list[_MetricDraft],
) -> dict[tuple[str | None, str], int]:
    scores: dict[tuple[str | None, str], int] = {}
    scopes = {draft.cluster_id for draft in drafts}
    for scope in scopes:
        eligible = [
            draft
            for draft in drafts
            if draft.cluster_id == scope
            and draft.sample_count >= 3
            and draft.mean_duration_ms is not None
            and draft.coefficient_of_variation is not None
        ]
        duration_ranks = _percentile_ranks(
            {draft.group_id: float(draft.mean_duration_ms or 0) for draft in eligible}
        )
        variance_ranks = _percentile_ranks(
            {draft.group_id: float(draft.coefficient_of_variation or 0) for draft in eligible}
        )
        for draft in eligible:
            scores[(scope, draft.group_id)] = round(
                100
                * (0.65 * duration_ranks[draft.group_id] + 0.35 * variance_ranks[draft.group_id])
            )
    return scores


def _percentile_ranks(values: dict[str, float]) -> dict[str, float]:
    if len(values) <= 1 or len(set(values.values())) == 1:
        return {key: 0.0 for key in values}
    ordered = sorted(values.values())
    denominator = len(ordered) - 1
    return {
        key: (
            mean(index for index, candidate in enumerate(ordered) if candidate == value)
            / denominator
        )
        for key, value in values.items()
    }


def _path_signature(analysis: WorkflowAnalysis, recording_index: int) -> str:
    return " > ".join(
        group_id
        for group_id, group in zip(analysis.group_ids, analysis.groups, strict=True)
        if recording_index in group.members
    )


def _cluster_quality(score: float) -> str:
    if score >= 0.50:
        return "strong"
    if score >= 0.35:
        return "moderate"
    return "weak"


def _confidence(sample_count: int) -> str:
    if sample_count < 3:
        return "insufficient"
    if sample_count < 5:
        return "low"
    if sample_count < 10:
        return "medium"
    return "high"


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))
