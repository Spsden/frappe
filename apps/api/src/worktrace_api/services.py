from uuid import UUID

from worktrace_api.privacy import build_external_ai_preview
from worktrace_api.schemas import (
    SOP,
    EventType,
    Feedback,
    FeedbackClassification,
    FeedbackCreate,
    SOPStep,
    WorkflowSession,
)


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
                observed_duration_ms=event.duration_ms,
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

