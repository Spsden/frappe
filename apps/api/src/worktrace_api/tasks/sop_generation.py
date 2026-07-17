"""
SOP Generation — Full Multimodal Celery Pipeline
=================================================
Queue : llm
Retries : 3 (30 s countdown)

Pipeline
--------
1.  Load WorkflowSession, annotated Screenshots, and aligned transcript
    segments from the database.
2.  For every annotated screenshot (red-box PNG already written by
    annotation.py) build a rich context bundle:
      - Base-64 encoded annotated image  (GPT-4o Vision input)
      - Application / window title
      - Event type, target_label, element_text, target_role
      - User narration aligned to the screenshot's time window
3.  Call GPT-4o (via OpenRouter) once per step with the image + text
    context to produce one precise, human-readable instruction.
4.  Call GPT-4o one final time with all instructions to produce a
    complete, well-structured Markdown SOP document.
5.  Persist a new SOP version (v2+) to the database.
"""

import base64
import logging
from datetime import timedelta
from uuid import UUID

import openai

from worktrace_api.core.celery_app import celery_app
from worktrace_api.recordings import ChunkStorage
from worktrace_api.schemas import (
    RecordingTranscript,
    SOP,
    SOPStatus,
    SOPStep,
)
from worktrace_api.settings import get_settings
from worktrace_api.tasks._repo import make_repo

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _encode_image(storage: ChunkStorage, annotated_key: str | None) -> str | None:
    """
    Read the annotated PNG from ChunkStorage and return a base-64 data URI
    suitable for the OpenAI / OpenRouter vision API.
    Returns None if the key is missing or the file cannot be read.
    """
    if not annotated_key:
        return None
    try:
        if not storage.exists(annotated_key):
            return None
        image_bytes = storage.read(annotated_key)
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        return f"data:image/png;base64,{b64}"
    except Exception:
        logger.warning("Could not encode annotated image: %s", annotated_key, exc_info=True)
        return None


def _align_narration(screenshot, next_screenshot, session_created_at, segments) -> str | None:
    """
    Return the concatenated text of all transcript segments whose time
    window overlaps with this screenshot's active period.
    segment.start_ms / end_ms are milliseconds from recording start.
    screenshot.captured_at is absolute UTC.
    """
    rec_start = session_created_at
    ss_start = screenshot.captured_at
    ss_end = next_screenshot.captured_at if next_screenshot else None
    texts = []
    for seg in segments:
        seg_abs_start = rec_start + timedelta(milliseconds=seg.start_ms)
        seg_abs_end = rec_start + timedelta(milliseconds=seg.end_ms)
        # Segment overlaps this screenshot's active window
        if (ss_end is None or seg_abs_start < ss_end) and seg_abs_end > ss_start:
            texts.append(seg.text)
    return " ".join(texts).strip() or None


def _build_step_prompt(ctx: dict, workflow_name: str, position: int, total: int) -> str:
    """
    Build the text portion of the per-step multimodal prompt.
    All available event fields are included so GPT-4o can pick the
    most descriptive reference for the element.
    """
    app_name = ctx.get("window_title") or ctx.get("application") or "Unknown Application"
    event_type = (ctx.get("event_type") or "interact").replace("_", " ")

    # Best available element descriptor (prefer label > text > role > coords)
    element_ref = (
        ctx.get("target_label")
        or ctx.get("element_text")
        or ctx.get("target_role")
        or (f"element at ({ctx.get('x')}, {ctx.get('y')})" if ctx.get("x") is not None else "unknown element")
    )

    narration = ctx.get("narration")
    narration_line = (
        f'User narration: "{narration}"'
        if narration
        else "No narration recorded for this step."
    )

    return (
        f"You are a technical writer creating a Standard Operating Procedure (SOP).\n\n"
        f"Workflow: \"{workflow_name}\"\n"
        f"You are writing Step {position} of {total}.\n\n"
        f"CONTEXT:\n"
        f"- Application: {app_name}\n"
        f"- Action performed: {event_type}\n"
        f"- Element interacted with: {element_ref}\n"
        f"- {narration_line}\n\n"
        f"The attached screenshot shows the screen state BEFORE this action.\n"
        f"A red bounding box highlights the exact element that was interacted with.\n\n"
        f"Write ONE clear, specific instruction for this step.\n"
        f"Rules:\n"
        f"- Use the element label visible inside or near the red box as your primary reference.\n"
        f"- Reference the application name where helpful.\n"
        f"- Be specific: instead of 'click the button', write 'click the [label] button in [location]'.\n"
        f"- Do NOT include the step number.\n"
        f"- Output only the instruction sentence, nothing else."
    )


def _generate_step_instruction(
    client: openai.OpenAI,
    ctx: dict,
    image_b64: str | None,
    workflow_name: str,
    position: int,
    total: int,
) -> str:
    """
    Call GPT-4o once for a single step.
    If an annotated image is available, sends a multimodal message
    (text + image_url). Falls back to text-only when image is None.
    """
    prompt_text = _build_step_prompt(ctx, workflow_name, position, total)

    if image_b64:
        # Multimodal: text + base-64 embedded image
        content = [
            {"type": "text", "text": prompt_text},
            {
                "type": "image_url",
                "image_url": {"url": image_b64},
            },
        ]
    else:
        # Text-only fallback
        content = prompt_text

    response = client.chat.completions.create(
        extra_headers={
            "HTTP-Referer": "http://localhost:5173",
            "X-OpenRouter-Title": "WorkTrace",
        },
        model="openai/gpt-4o",
        messages=[{"role": "user", "content": content}],
        max_tokens=300,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


def _generate_sop_markdown(
    client: openai.OpenAI,
    workflow_name: str,
    step_instructions: list[dict],
) -> str:
    """
    Single aggregating LLM call: take all per-step instructions and
    produce a complete, well-structured Markdown SOP document.
    Each item in step_instructions: {position, instruction, warning}
    """
    steps_text = "\n".join(
        f"{item['position']}. {item['instruction']}"
        + (f"\n   > ⚠️ Note: {item['warning']}" if item.get("warning") else "")
        for item in step_instructions
    )

    prompt = (
        f"You are a technical writer. Below are the numbered steps of a Standard "
        f"Operating Procedure for the workflow: \"{workflow_name}\".\n\n"
        f"{steps_text}\n\n"
        f"Write a complete, professional Markdown SOP document that includes:\n"
        f"1. A title header: # {workflow_name}\n"
        f"2. A short **Purpose** section (1-2 sentences) explaining what this SOP accomplishes.\n"
        f"3. A **Prerequisites** section (if any steps mention specific applications or accounts).\n"
        f"4. A **Steps** section with each step as a numbered list using the exact instructions above.\n"
        f"   - If a step has a ⚠️ Note, include it beneath that step as a blockquote.\n"
        f"5. A **Notes** section at the end for any general observations.\n\n"
        f"Output only raw Markdown. No code fences. No preamble."
    )

    response = client.chat.completions.create(
        extra_headers={
            "HTTP-Referer": "http://localhost:5173",
            "X-OpenRouter-Title": "WorkTrace",
        },
        model="openai/gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000,
        temperature=0.4,
    )
    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Celery Task
# ---------------------------------------------------------------------------

@celery_app.task(bind=True, max_retries=3)
def generate_sop_with_ai(self, recording_id: str, session_id: str, tenant_id: str) -> None:
    """
    Multimodal SOP generation task (queue: llm).

    Triggered by the chord in pipeline.py after both
    transcribe_audio and annotate_screenshots have completed.
    """
    settings = get_settings()
    repo = make_repo(tenant_id)
    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes,
    )

    try:
        # ------------------------------------------------------------------
        # 1. Load data from DB
        # ------------------------------------------------------------------
        session = repo.get_session(UUID(session_id))
        if not session:
            logger.error("Session %s not found — aborting SOP generation.", session_id)
            return

        screenshots = repo.get_screenshots_for_recording(UUID(recording_id))
        annotated = [s for s in screenshots if s.redaction_status == "redacted"]
        events = session.events

        if not annotated:
            logger.warning(
                "No annotated screenshots for recording %s — skipping SOP generation.",
                recording_id,
            )
            return

        # ------------------------------------------------------------------
        # 2. Parse transcript segments (safe: handles None or incomplete)
        # ------------------------------------------------------------------
        transcript = session.transcript
        segments = []
        if transcript and transcript.status == "completed":
            segments = transcript.segments

        # ------------------------------------------------------------------
        # 3. Build per-step context bundles
        # ------------------------------------------------------------------
        steps_context = []
        for i, screenshot in enumerate(annotated):
            next_ss = annotated[i + 1] if i + 1 < len(annotated) else None

            # Match the LAST event that declared this screenshot as its "before" state
            matching_event = next(
                (e for e in reversed(events) if e.before_screenshot_id == screenshot.id),
                None,
            )

            recording_start_time = screenshots[0].captured_at if screenshots else session.created_at
            narration = _align_narration(screenshot, next_ss, recording_start_time, segments)

            steps_context.append({
                "position": i + 1,
                "annotated_storage_key": screenshot.annotated_storage_key,
                "screenshot_id": screenshot.id,
                "application": matching_event.application if matching_event else None,
                "window_title": matching_event.window_title if matching_event else None,
                "event_type": str(matching_event.event_type) if matching_event else None,
                "target_label": matching_event.target_label if matching_event else None,
                "element_text": matching_event.element_text if matching_event else None,
                "target_role": matching_event.target_role if matching_event else None,
                "x": matching_event.x if matching_event else None,
                "y": matching_event.y if matching_event else None,
                "narration": narration,
            })

        # ------------------------------------------------------------------
        # 4. Initialise OpenRouter client
        # ------------------------------------------------------------------
        client = openai.OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.openai_api_key,
        )

        total_steps = len(steps_context)
        step_instructions = []

        # ------------------------------------------------------------------
        # 5. Per-step multimodal LLM call
        # ------------------------------------------------------------------
        for ctx in steps_context:
            image_b64 = _encode_image(storage, ctx["annotated_storage_key"])
            has_narration = bool(ctx.get("narration"))

            instruction = _generate_step_instruction(
                client=client,
                ctx=ctx,
                image_b64=image_b64,
                workflow_name=session.workflow_name,
                position=ctx["position"],
                total=total_steps,
            )

            step_instructions.append({
                "position": ctx["position"],
                "screenshot_id": ctx["screenshot_id"],
                "instruction": instruction,
                "warning": None if has_narration else "No narration recorded for this step.",
            })

            logger.info(
                "Step %d/%d generated: %s",
                ctx["position"],
                total_steps,
                instruction[:80],
            )

        # ------------------------------------------------------------------
        # 6. Final aggregating call → full Markdown SOP document
        # ------------------------------------------------------------------
        markdown_doc = _generate_sop_markdown(
            client=client,
            workflow_name=session.workflow_name,
            step_instructions=step_instructions,
        )

        logger.info(
            "Markdown SOP generated (%d chars) for session %s.",
            len(markdown_doc),
            session_id,
        )

        # ------------------------------------------------------------------
        # 7. Persist SOP to database
        # ------------------------------------------------------------------
        sop_steps = [
            SOPStep(
                position=item["position"],
                title=f"Step {item['position']}",
                # Individual LLM instruction stored per-step (max 4000 chars)
                instruction=item["instruction"][:4000],
                warning=item["warning"],
                screenshot_reference=item["screenshot_id"],
            )
            for item in step_instructions
        ]

        version = repo.next_sop_version(UUID(session_id))
        sop = SOP(
            tenant_id=UUID(tenant_id),
            source_session_id=UUID(session_id),
            version=version,
            status=SOPStatus.DRAFT,
            title=session.workflow_name,
            steps=sop_steps,
        )
        repo.save_sop(sop)

        logger.info(
            "SOP v%d saved for session %s (%d steps).",
            version,
            session_id,
            len(sop_steps),
        )

        # ------------------------------------------------------------------
        # 8. Persist the full Markdown document as a separate SOP entry
        #    (version + 1) so the frontend can access the complete doc.
        # ------------------------------------------------------------------
        from worktrace_api.schemas import SOPStep as MarkdownSOPStep

        markdown_version = repo.next_sop_version(UUID(session_id))
        markdown_sop = SOP(
            tenant_id=UUID(tenant_id),
            source_session_id=UUID(session_id),
            version=markdown_version,
            status=SOPStatus.DRAFT,
            title=f"{session.workflow_name} — Full Document",
            steps=[
                MarkdownSOPStep(
                    position=1,
                    title="Full SOP Document",
                    # Store full markdown in the first (only) step's instruction
                    # Truncated to 4000 chars for DB schema compliance.
                    instruction=markdown_doc[:4000],
                )
            ],
        )
        repo.save_sop(markdown_sop)

        logger.info(
            "Full Markdown SOP v%d saved for session %s.",
            markdown_version,
            session_id,
        )

    except Exception as exc:
        logger.exception("SOP generation failed for session %s: %s", session_id, exc)
        raise self.retry(exc=exc, countdown=30) from exc
    finally:
        repo.db.close()
