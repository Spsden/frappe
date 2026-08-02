"""Deterministic workflow comparison built from approved SOP snapshots.

The LLM is intentionally not involved in the numbers. It only receives the
finished aggregate later to write the executive summary. Step alignment uses
semantic embeddings and sequence order, so a differently worded but equivalent
step can match while repeated and genuinely unmatched steps remain visible.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from statistics import mean
from typing import Any, Literal
from uuid import UUID

from worktrace_api.schemas import (
    SOP,
    AnalyticsComparisonOverview,
    AnalyticsPathTimeline,
    AnalyticsRecordingMetric,
    AnalyticsResult,
    AnalyticsStepComparison,
    AnalyticsTimelineStep,
    SOPStep,
)

ALGORITHM_VERSION = "ordered-semantic-v1"
EMBEDDING_DIMENSIONS = 1536
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
_MINIMUM_MATCH_SIMILARITY = 0.62
_GAP_PENALTY = -0.25


@dataclass(frozen=True)
class StepDocument:
    recording_id: UUID
    sop_id: UUID
    step_id: UUID
    text: str
    content_hash: str

    @property
    def cache_key(self) -> tuple[UUID, UUID, str]:
        return self.sop_id, self.step_id, self.content_hash


@dataclass(frozen=True)
class _PreparedStep:
    step: SOPStep
    content_hash: str
    vector: tuple[float, ...]
    duration_ms: int | None
    timing_source: Literal["observed", "estimated", "unavailable"]


@dataclass(frozen=True)
class _PreparedRecording:
    recording_id: UUID
    label: str
    duration_ms: int
    sop: SOP
    steps: tuple[_PreparedStep, ...]


@dataclass
class _AlignmentGroup:
    members: dict[int, _PreparedStep] = field(default_factory=dict)

    def centroid(self) -> tuple[float, ...]:
        vectors = [step.vector for step in self.members.values()]
        dimensions = len(vectors[0])
        return _normalize_vector(
            tuple(
                sum(vector[index] for vector in vectors) / len(vectors)
                for index in range(dimensions)
            )
        )

    def label(self) -> str:
        labels = [
            step.step.title.strip() or step.step.instruction.strip()
            for step in self.members.values()
        ]
        counts = Counter(labels)
        return min(counts, key=lambda value: (-counts[value], labels.index(value)))


def step_documents(input_snapshots: list[dict[str, Any]]) -> list[StepDocument]:
    documents: list[StepDocument] = []
    for item in input_snapshots:
        recording_id = UUID(str(item["recording_id"]))
        sop = SOP.model_validate(item["sop"])
        for step in sop.steps:
            text = _step_text(step)
            documents.append(
                StepDocument(
                    recording_id=recording_id,
                    sop_id=sop.id,
                    step_id=step.id,
                    text=text,
                    content_hash=hashlib.sha256(text.encode()).hexdigest(),
                )
            )
    return documents


def build_comparison(
    input_snapshots: list[dict[str, Any]],
    embeddings: dict[tuple[UUID, UUID, str], list[float]],
) -> AnalyticsResult:
    """Build chart-ready metrics from 2–5 immutable analytics inputs."""
    if not 2 <= len(input_snapshots) <= 5:
        raise ValueError("Workflow comparison requires between 2 and 5 recordings")
    prepared = _prepare_recordings(input_snapshots, embeddings)
    groups = _progressive_alignment(prepared)
    classifications = _classify_groups(groups, len(prepared))

    fastest_index = min(
        range(len(prepared)), key=lambda index: (prepared[index].duration_ms, index)
    )
    fastest = prepared[fastest_index]
    ranked = sorted(
        enumerate(prepared), key=lambda item: (item[1].duration_ms, item[0])
    )
    group_ids = [f"step-{index:03d}" for index in range(1, len(groups) + 1)]
    signatures = {
        tuple(group_ids[index] for index, group in enumerate(groups) if run_index in group.members)
        for run_index in range(len(prepared))
    }

    metrics = [
        AnalyticsRecordingMetric(
            recording_id=recording.recording_id,
            label=recording.label,
            rank=rank,
            total_duration_ms=recording.duration_ms,
            step_count=len(recording.steps),
            path_signature=" > ".join(
                group_ids[index]
                for index, group in enumerate(groups)
                if original_index in group.members
            ),
        )
        for rank, (original_index, recording) in enumerate(ranked, start=1)
    ]

    timelines = [
        _timeline_for_recording(
            run_index,
            recording,
            groups,
            group_ids,
            classifications,
        )
        for run_index, recording in enumerate(prepared)
    ]
    fastest_vs_average = _fastest_vs_average(
        fastest_index,
        groups,
        group_ids,
    )
    timed_steps = sum(
        step.duration_ms is not None for recording in prepared for step in recording.steps
    )
    total_steps = sum(len(recording.steps) for recording in prepared)
    timing_coverage = timed_steps / total_steps if total_steps else 0.0
    average_duration = round(mean(recording.duration_ms for recording in prepared))

    notes = [
        "Steps are aligned within this comparison by semantic similarity and sequence order.",
        (
            "Unmatched steps remain visible as optional or path-specific work; "
            "they are not treated as errors."
        ),
    ]
    if timing_coverage < 1:
        notes.append(
            f"{round(timing_coverage * 100)}% of SOP steps contain observed or estimated timing."
        )

    return AnalyticsResult(
        overview=AnalyticsComparisonOverview(
            recording_count=len(prepared),
            distinct_path_count=len(signatures),
            fastest_recording_id=fastest.recording_id,
            fastest_duration_ms=fastest.duration_ms,
            average_duration_ms=average_duration,
            potential_time_saved_ms=max(0, average_duration - fastest.duration_ms),
            shared_step_count=sum(value == "shared" for value in classifications),
            optional_step_count=sum(value == "optional" for value in classifications),
            path_specific_step_count=sum(
                value == "path_specific" for value in classifications
            ),
            timing_coverage=round(timing_coverage, 4),
        ),
        completion_ranking=metrics,
        path_timelines=timelines,
        fastest_vs_average=fastest_vs_average,
        alignment_notes=notes,
    )


def _prepare_recordings(
    input_snapshots: list[dict[str, Any]],
    embeddings: dict[tuple[UUID, UUID, str], list[float]],
) -> list[_PreparedRecording]:
    documents = {
        (document.sop_id, document.step_id): document
        for document in step_documents(input_snapshots)
    }
    labels = _recording_labels(input_snapshots)
    prepared: list[_PreparedRecording] = []
    for index, item in enumerate(input_snapshots, start=1):
        recording_id = UUID(str(item["recording_id"]))
        sop = SOP.model_validate(item["sop"])
        steps: list[_PreparedStep] = []
        for step in sorted(sop.steps, key=lambda value: value.position):
            document = documents[(sop.id, step.id)]
            vector = embeddings.get(document.cache_key)
            if vector is None:
                raise ValueError(f"Missing embedding for SOP step {step.id}")
            if not vector or not all(math.isfinite(value) for value in vector):
                raise ValueError(f"Invalid embedding for SOP step {step.id}")
            duration_ms, source = _step_duration(step)
            steps.append(
                _PreparedStep(
                    step=step,
                    content_hash=document.content_hash,
                    vector=_normalize_vector(tuple(vector)),
                    duration_ms=duration_ms,
                    timing_source=source,
                )
            )
        if not steps:
            raise ValueError(f"Approved SOP {sop.id} contains no steps")
        prepared.append(
            _PreparedRecording(
                recording_id=recording_id,
                label=labels[index - 1],
                duration_ms=max(0, int(item["duration_ms"])),
                sop=sop,
                steps=tuple(steps),
            )
        )
    return prepared


def _recording_labels(input_snapshots: list[dict[str, Any]]) -> list[str]:
    """Build stable, human-readable labels without hiding duplicate references."""
    base_labels: list[str] = []
    for index, item in enumerate(input_snapshots, start=1):
        reference = str(item.get("reference") or "").strip()
        recorded_by = str(item.get("recorded_by_email") or "").strip()
        base_labels.append(reference or recorded_by or f"Recording {index}")

    base_counts = Counter(label.casefold() for label in base_labels)
    used: Counter[str] = Counter()
    labels: list[str] = []
    for item, base in zip(input_snapshots, base_labels, strict=True):
        label = base
        if base_counts[base.casefold()] > 1:
            recorded_by = str(item.get("recorded_by_email") or "").strip()
            if recorded_by and recorded_by.casefold() != base.casefold():
                label = f"{base} · {recorded_by}"

        normalized = label.casefold()
        used[normalized] += 1
        if used[normalized] > 1:
            label = f"{label} · #{used[normalized]}"
        labels.append(label)

    return labels


def _progressive_alignment(recordings: list[_PreparedRecording]) -> list[_AlignmentGroup]:
    pivot = _medoid_index(recordings)
    order = [pivot, *(index for index in range(len(recordings)) if index != pivot)]
    groups = [_AlignmentGroup(members={pivot: step}) for step in recordings[pivot].steps]

    for recording_index in order[1:]:
        steps = recordings[recording_index].steps
        pairs = _align_vectors(
            [group.centroid() for group in groups],
            [step.vector for step in steps],
        )
        expanded: list[_AlignmentGroup] = []
        for group_index, step_index in pairs:
            if group_index is None:
                expanded.append(
                    _AlignmentGroup(members={recording_index: steps[step_index]})
                )
                continue
            group = groups[group_index]
            if step_index is not None:
                group.members[recording_index] = steps[step_index]
            expanded.append(group)
        groups = expanded
    return groups


def _medoid_index(recordings: list[_PreparedRecording]) -> int:
    if len(recordings) == 2:
        return 0
    scores: list[float] = []
    for left_index, left in enumerate(recordings):
        comparisons = [
            _sequence_similarity(left, right)
            for right_index, right in enumerate(recordings)
            if right_index != left_index
        ]
        scores.append(mean(comparisons))
    return max(range(len(scores)), key=lambda index: (scores[index], -index))


def _sequence_similarity(left: _PreparedRecording, right: _PreparedRecording) -> float:
    pairs = _align_vectors(
        [step.vector for step in left.steps],
        [step.vector for step in right.steps],
    )
    similarities = [
        _cosine(left.steps[left_index].vector, right.steps[right_index].vector)
        if left_index is not None and right_index is not None
        else 0.0
        for left_index, right_index in pairs
    ]
    return mean(similarities) if similarities else 0.0


def _align_vectors(
    left: list[tuple[float, ...]], right: list[tuple[float, ...]]
) -> list[tuple[int | None, int | None]]:
    rows = len(left) + 1
    columns = len(right) + 1
    scores = [[0.0] * columns for _ in range(rows)]
    traces = [[""] * columns for _ in range(rows)]
    for row in range(1, rows):
        scores[row][0] = row * _GAP_PENALTY
        traces[row][0] = "up"
    for column in range(1, columns):
        scores[0][column] = column * _GAP_PENALTY
        traces[0][column] = "left"

    for row in range(1, rows):
        for column in range(1, columns):
            similarity = _cosine(left[row - 1], right[column - 1])
            match_score = (
                (similarity - _MINIMUM_MATCH_SIMILARITY) * 2.5
                if similarity >= _MINIMUM_MATCH_SIMILARITY
                else -1.0
            )
            choices = (
                (scores[row - 1][column - 1] + match_score, "diagonal"),
                (scores[row - 1][column] + _GAP_PENALTY, "up"),
                (scores[row][column - 1] + _GAP_PENALTY, "left"),
            )
            scores[row][column], traces[row][column] = max(
                choices,
                key=lambda choice: (choice[0], choice[1] == "diagonal"),
            )

    pairs: list[tuple[int | None, int | None]] = []
    row, column = len(left), len(right)
    while row or column:
        trace = traces[row][column]
        if trace == "diagonal":
            pairs.append((row - 1, column - 1))
            row -= 1
            column -= 1
        elif trace == "up":
            pairs.append((row - 1, None))
            row -= 1
        else:
            pairs.append((None, column - 1))
            column -= 1
    pairs.reverse()
    return pairs


def _timeline_for_recording(
    recording_index: int,
    recording: _PreparedRecording,
    groups: list[_AlignmentGroup],
    group_ids: list[str],
    classifications: list[Literal["shared", "optional", "path_specific"]],
) -> AnalyticsPathTimeline:
    start_ms = 0
    steps: list[AnalyticsTimelineStep] = []
    for group_id, group, classification in zip(
        group_ids, groups, classifications, strict=True
    ):
        step = group.members.get(recording_index)
        if not step:
            continue
        duration_ms = step.duration_ms or 0
        steps.append(
            AnalyticsTimelineStep(
                group_id=group_id,
                sop_step_id=step.step.id,
                label=step.step.title or step.step.instruction,
                start_ms=start_ms,
                duration_ms=duration_ms,
                classification=classification,
                timing_source=step.timing_source,
            )
        )
        start_ms += duration_ms
    return AnalyticsPathTimeline(
        recording_id=recording.recording_id,
        label=recording.label,
        total_duration_ms=recording.duration_ms,
        unallocated_duration_ms=max(0, recording.duration_ms - start_ms),
        steps=steps,
    )


def _fastest_vs_average(
    fastest_index: int,
    groups: list[_AlignmentGroup],
    group_ids: list[str],
) -> list[AnalyticsStepComparison]:
    comparisons: list[AnalyticsStepComparison] = []
    for group_id, group in zip(group_ids, groups, strict=True):
        measured = [
            step.duration_ms for step in group.members.values() if step.duration_ms is not None
        ]
        if not measured:
            continue
        fastest_step = group.members.get(fastest_index)
        comparisons.append(
            AnalyticsStepComparison(
                group_id=group_id,
                label=group.label(),
                sample_count=len(measured),
                fastest_duration_ms=(
                    fastest_step.duration_ms if fastest_step is not None else None
                ),
                average_duration_ms=round(mean(measured)),
                fastest_path_has_step=fastest_step is not None,
            )
        )
    return comparisons


def _classify_groups(
    groups: list[_AlignmentGroup], recording_count: int
) -> list[Literal["shared", "optional", "path_specific"]]:
    classifications: list[Literal["shared", "optional", "path_specific"]] = []
    for group in groups:
        if len(group.members) == recording_count:
            classifications.append("shared")
        elif len(group.members) == 1:
            classifications.append("path_specific")
        else:
            classifications.append("optional")
    return classifications


def _step_text(step: SOPStep) -> str:
    parts = [step.title, step.instruction, step.warning or ""]
    return re.sub(r"\s+", " ", "\n".join(part.strip().lower() for part in parts)).strip()


def _step_duration(
    step: SOPStep,
) -> tuple[int | None, Literal["observed", "estimated", "unavailable"]]:
    if step.observed_duration_ms is not None:
        return step.observed_duration_ms, "observed"
    if step.estimated_time_ms is not None:
        return step.estimated_time_ms, "estimated"
    return None, "unavailable"


def _normalize_vector(vector: tuple[float, ...]) -> tuple[float, ...]:
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude == 0:
        raise ValueError("Embedding vector cannot be all zeroes")
    return tuple(value / magnitude for value in vector)


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    if len(left) != len(right):
        raise ValueError("Embedding vectors must have equal dimensions")
    return sum(a * b for a, b in zip(left, right, strict=True))
