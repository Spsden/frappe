from collections import Counter, defaultdict
from statistics import mean, pstdev
from uuid import UUID

from worktrace_api.privacy import build_external_ai_preview
from worktrace_api.schemas import (
    SOP,
    AnalyticsSummary,
    EventType,
    Feedback,
    FeedbackClassification,
    FeedbackCreate,
    SOPStep,
    WorkflowSession,
)

MIN_CLUSTER_SESSIONS = 8


def generate_sop(session: WorkflowSession, version: int = 1) -> SOP:
    steps: list[SOPStep] = []
    actionable = [
        event
        for event in session.events
        if event.event_type
        in {
            EventType.CLICK,
            EventType.INPUT,
            EventType.KEY_BURST,
            EventType.NAVIGATION,
            EventType.APP_SWITCH,
        }
    ]
    for position, event in enumerate(actionable, start=1):
        annotation = event.event_data.get("evidenceAnnotation")
        evidence_annotations = [annotation] if isinstance(annotation, dict) else []
        if event.event_type == EventType.NAVIGATION:
            title = "Open the next page"
            instruction = f"Navigate to {event.page_url.path or '/'}."
        elif event.event_type in {EventType.INPUT, EventType.KEY_BURST}:
            title = "Enter the required information"
            field_name = event.target_label or event.element_text or "the selected field"
            instruction = f"Enter the approved value in {field_name}."
        elif event.event_type == EventType.APP_SWITCH:
            title = f"Open {event.application or 'the required application'}"
            instruction = f"Switch to {event.application or 'the required application'}."
        else:
            label = event.target_label or event.element_text or "the highlighted control"
            title = f"Select {label}"
            target = event.target_label or event.element_text or event.safe_selector
            target = target or "the selected control"
            instruction = f"Click {target}."
        steps.append(
            SOPStep(
                position=position,
                title=title,
                instruction=instruction,
                screenshot_reference=event.after_screenshot_id or event.screenshot_reference,
                evidence_annotations=evidence_annotations,
                estimated_time_ms=event.duration_ms,
                warning="Confirm the displayed data before continuing."
                if event.event_type in {EventType.INPUT, EventType.KEY_BURST}
                else None,
            )
        )
    if not steps:
        raise ValueError("Session has no actionable events")
    return SOP(
        tenant_id=session.tenant_id,
        source_session_id=session.id,
        version=version,
        title=session.workflow_name,
        steps=steps,
    )


def classify_feedback(tenant_id: UUID, payload: FeedbackCreate) -> Feedback:
    text = payload.transcript.lower()
    if any(term in text for term in ("missing", "cannot", "can't", "need access", "no option")):
        classification = FeedbackClassification.PROCESS_GAP
    elif any(
        term in text for term in ("slow", "confusing", "frustrating", "difficult", "too many")
    ):
        classification = FeedbackClassification.FRUSTRATION_SIGNAL
    else:
        classification = FeedbackClassification.TASK_DESCRIPTION
    return Feedback(tenant_id=tenant_id, classification=classification, **payload.model_dump())


def external_ai_preview(session: WorkflowSession, provider: str):
    return build_external_ai_preview(session, provider)


def analyze_workflow(
    tenant_id: UUID,
    workflow_name: str,
    sessions: list[WorkflowSession],
    reference_session_id: UUID | None,
) -> AnalyticsSummary:
    reference_id = (
        reference_session_id if any(s.id == reference_session_id for s in sessions) else None
    )
    path_counts = Counter(_path_signature(session) for session in sessions)
    path_summaries = [
        {"path": list(signature), "session_count": count}
        for signature, count in path_counts.most_common()
    ]

    timings: dict[str, list[int]] = defaultdict(list)
    for session in sessions:
        for event in session.events:
            if event.duration_ms is not None:
                label = event.target_label or event.element_text or event.event_type.value
                timings[label].append(event.duration_ms)

    friction_points = []
    for label, values in timings.items():
        average = mean(values)
        variation = pstdev(values) if len(values) > 1 else 0
        friction_points.append(
            {
                "step": label,
                "mean_duration_ms": round(average),
                "variation_ms": round(variation),
                "friction_score": _friction_score(average, variation),
                "sample_size": len(values),
            }
        )
    friction_points.sort(key=lambda item: item["friction_score"], reverse=True)

    clustering_status = (
        "not_implemented"
        if len(sessions) >= MIN_CLUSTER_SESSIONS
        else "disabled_insufficient_sessions"
    )
    summary = [
        f"{len(sessions)} sessions produced {len(path_counts)} observed execution paths.",
        (
            f"The highest-friction observed step is '{friction_points[0]['step']}'."
            if friction_points
            else "No timing evidence is available yet."
        ),
        (
            "Exact path grouping is available; statistical clustering is not implemented yet."
            if clustering_status == "not_implemented"
            else f"Path grouping requires at least {MIN_CLUSTER_SESSIONS} comparable sessions."
        ),
    ]
    return AnalyticsSummary(
        tenant_id=tenant_id,
        workflow_name=workflow_name,
        reference_session_id=reference_id,
        clustering_status=clustering_status,
        path_summaries=path_summaries,
        friction_points=friction_points,
        executive_summary=summary,
    )


def _path_signature(session: WorkflowSession) -> tuple[str, ...]:
    return tuple(
        event.target_label or event.element_text or event.event_type.value
        for event in session.events
        if event.event_type
        in {
            EventType.CLICK,
            EventType.INPUT,
            EventType.KEY_BURST,
            EventType.NAVIGATION,
            EventType.APP_SWITCH,
        }
    )


def _friction_score(average: float, variation: float) -> int:
    raw = (average / 1000) * 8 + (variation / 1000) * 5
    return max(0, min(100, round(raw)))
