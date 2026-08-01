from uuid import uuid4

import pytest

from worktrace_api.schemas import SOP, SOPStatus, SOPStep
from worktrace_api.workflow_analytics import build_comparison, step_documents


def _snapshot(reference, duration_ms, steps):
    recording_id = uuid4()
    sop = SOP(
        tenant_id=uuid4(),
        source_session_id=uuid4(),
        status=SOPStatus.APPROVED,
        title="Close a support ticket",
        steps=[
            SOPStep(
                position=index,
                title=title,
                instruction=instruction,
                observed_duration_ms=duration,
            )
            for index, (title, instruction, duration) in enumerate(steps, start=1)
        ],
    )
    return {
        "recording_id": str(recording_id),
        "duration_ms": duration_ms,
        "reference": reference,
        "sop": sop.model_dump(mode="json"),
    }


def _embeddings(snapshots, vectors_by_title):
    values = {}
    for snapshot in snapshots:
        sop = SOP.model_validate(snapshot["sop"])
        documents = {
            document.step_id: document for document in step_documents([snapshot])
        }
        for step in sop.steps:
            document = documents[step.id]
            values[document.cache_key] = vectors_by_title[step.title]
    return values


def test_aligns_reworded_steps_and_keeps_path_specific_work():
    snapshots = [
        _snapshot(
            "Fast path",
            9_000,
            [
                ("Sign in", "Enter your account credentials.", 2_000),
                ("Find the ticket", "Search for the ticket number.", 3_000),
                ("Close ticket", "Select Close.", 4_000),
            ],
        ),
        _snapshot(
            "Verified path",
            14_000,
            [
                ("Log in", "Authenticate with your account.", 3_000),
                ("Verify customer", "Check the customer identity.", 2_000),
                ("Search tickets", "Locate the ticket by number.", 4_000),
                ("Resolve ticket", "Mark the ticket closed.", 5_000),
            ],
        ),
    ]
    vectors = _embeddings(
        snapshots,
        {
            "Sign in": [1.0, 0.0, 0.0, 0.0],
            "Log in": [0.99, 0.05, 0.0, 0.0],
            "Verify customer": [0.0, 0.0, 0.0, 1.0],
            "Find the ticket": [0.0, 1.0, 0.0, 0.0],
            "Search tickets": [0.05, 0.99, 0.0, 0.0],
            "Close ticket": [0.0, 0.0, 1.0, 0.0],
            "Resolve ticket": [0.0, 0.05, 0.99, 0.0],
        },
    )

    result = build_comparison(snapshots, vectors)

    assert result.overview.shared_step_count == 3
    assert result.overview.path_specific_step_count == 1
    assert result.overview.distinct_path_count == 2
    assert result.overview.fastest_duration_ms == 9_000
    assert result.overview.average_duration_ms == 11_500
    assert result.overview.potential_time_saved_ms == 2_500
    assert [item.label for item in result.completion_ranking] == [
        "Fast path",
        "Verified path",
    ]
    verify = next(item for item in result.fastest_vs_average if item.label == "Verify customer")
    assert verify.fastest_path_has_step is False
    assert verify.fastest_duration_ms is None


def test_repeated_steps_remain_separate_in_the_path():
    snapshots = [
        _snapshot(
            "Single search",
            4_000,
            [
                ("Search", "Search once.", 1_000),
                ("Submit", "Submit the result.", 3_000),
            ],
        ),
        _snapshot(
            "Double search",
            6_000,
            [
                ("Search first", "Search the primary queue.", 1_000),
                ("Search again", "Search the backup queue.", 2_000),
                ("Submit result", "Submit the result.", 3_000),
            ],
        ),
    ]
    vectors = _embeddings(
        snapshots,
        {
            "Search": [1.0, 0.0],
            "Search first": [0.99, 0.05],
            "Search again": [0.98, 0.1],
            "Submit": [0.0, 1.0],
            "Submit result": [0.05, 0.99],
        },
    )

    result = build_comparison(snapshots, vectors)

    assert len(result.path_timelines[0].steps) == 2
    assert len(result.path_timelines[1].steps) == 3
    assert result.overview.path_specific_step_count == 1
    assert result.path_timelines[1].steps[0].group_id != result.path_timelines[1].steps[1].group_id


def test_missing_step_timing_is_not_counted_as_zero():
    snapshots = [
        _snapshot(
            "Observed",
            5_000,
            [("Open", "Open the page.", 2_000), ("Save", "Save.", 3_000)],
        ),
        _snapshot(
            "Partially timed",
            7_000,
            [("Open page", "Open the page.", None), ("Save form", "Save.", 4_000)],
        ),
    ]
    vectors = _embeddings(
        snapshots,
        {
            "Open": [1.0, 0.0],
            "Open page": [0.99, 0.05],
            "Save": [0.0, 1.0],
            "Save form": [0.05, 0.99],
        },
    )

    result = build_comparison(snapshots, vectors)

    assert result.overview.timing_coverage == 0.75
    partial_open = result.path_timelines[1].steps[0]
    assert partial_open.duration_ms == 0
    assert partial_open.timing_source == "unavailable"
    open_comparison = result.fastest_vs_average[0]
    assert open_comparison.sample_count == 1
    assert open_comparison.average_duration_ms == 2_000


def test_rejects_missing_or_zero_embeddings():
    snapshots = [
        _snapshot("One", 1_000, [("Open", "Open.", 1_000)]),
        _snapshot("Two", 2_000, [("Open again", "Open.", 2_000)]),
    ]
    with pytest.raises(ValueError, match="Missing embedding"):
        build_comparison(snapshots, {})

    vectors = _embeddings(
        snapshots,
        {"Open": [1.0, 0.0], "Open again": [0.0, 0.0]},
    )
    with pytest.raises(ValueError, match="all zeroes"):
        build_comparison(snapshots, vectors)
