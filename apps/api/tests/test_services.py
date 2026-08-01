from datetime import UTC, datetime
from uuid import uuid4

from worktrace_api.schemas import EventType, SessionEvent, WorkflowSession
from worktrace_api.services import generate_sop


def make_session(tenant_id, workflow_name="Invoice review"):
    return WorkflowSession(
        tenant_id=tenant_id,
        workflow_name=workflow_name,
        duration_ms=3000,
        events=[
            SessionEvent(
                tenant_id=tenant_id,
                timestamp=datetime.now(UTC),
                event_type=EventType.NAVIGATION,
                page_url="https://example.test/invoices",
                element_text="Invoices",
                duration_ms=1000,
            ),
            SessionEvent(
                tenant_id=tenant_id,
                timestamp=datetime.now(UTC),
                event_type=EventType.CLICK,
                page_url="https://example.test/invoices",
                element_text="Review",
                duration_ms=2000,
            ),
        ],
    )


def test_generates_reviewable_sop():
    tenant_id = uuid4()
    sop = generate_sop(make_session(tenant_id))
    assert sop.status == "draft"
    assert [step.position for step in sop.steps] == [1, 2]
    assert sop.steps[1].title == "Select Review"


def test_sop_generation_preserves_opaque_screenshot_id():
    tenant_id = uuid4()
    session = make_session(tenant_id)
    screenshot_id = uuid4()
    session.events[0] = session.events[0].model_copy(update={"screenshot_reference": screenshot_id})
    sop = generate_sop(session)
    assert sop.steps[0].screenshot_reference == screenshot_id


def test_generates_sop_from_desktop_events_and_after_state():
    tenant_id = uuid4()
    screenshot_id = uuid4()
    session = WorkflowSession(
        tenant_id=tenant_id,
        source_type="desktop",
        workflow_name="Submit invoice",
        duration_ms=1500,
        events=[
            SessionEvent(
                tenant_id=tenant_id,
                sequence=1,
                event_type=EventType.CLICK,
                application="ERP Desktop",
                window_title="Invoices",
                target_role="button",
                target_label="Submit",
                x=920,
                y=640,
                after_screenshot_id=screenshot_id,
                duration_ms=1500,
            )
        ],
    )

    sop = generate_sop(session)

    assert sop.steps[0].title == "Select Submit"
    assert sop.steps[0].instruction == "Click Submit."
    assert sop.steps[0].screenshot_reference == screenshot_id
