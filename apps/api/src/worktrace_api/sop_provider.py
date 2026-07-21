"""
SOP generation provider — the isolated LLM contract for the SOP pipeline.

This is the ONLY module that talks to the OpenAI / OpenRouter HTTP API, so the
backend provider can be swapped (OpenAI, OpenRouter, a Claude-compatible
gateway) by changing how ``SOPProvider.complete`` builds its client and by
pointing the ``WORKTRACE_OPENAI_BASE_URL`` / ``WORKTRACE_OPENAI_MODEL`` env vars
at the new endpoint.

The module is intentionally split into pure, unit-testable pieces:

  - ``build_evidence_bundle``     DB rows -> serializable per-step context
  - ``encode_evidence_images``    annotated PNGs -> base-64 data URIs (I/O)
  - ``build_generation_messages`` bundle -> OpenAI chat messages (the prompt)
  - ``GeneratedSOP``              strict schema the model MUST return
  - ``parse_generated_sop``       model output -> validated ``GeneratedSOP``
  - ``build_repair_messages``     validation errors -> one repair turn
  - ``generated_to_sop``          validated output -> persisted ``SOP``

The Celery task in ``tasks/sop_generation.py`` owns orchestration: build the
bundle, ask the provider for JSON, validate, and on failure ask once more with a
repair prompt before failing as retryable.

Privacy: only transcript *text/segments* and annotated screenshot *images* leave
the process. Raw audio is never sent.
"""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

import openai
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from worktrace_api.schemas import (
    SOP,
    SOPDecisionBranch,
    SOPStatus,
    SOPStep,
    WorkflowSession,
)
from worktrace_api.settings import Settings

if TYPE_CHECKING:
    from worktrace_api.recordings import ChunkStorage
    from worktrace_api.schemas import Screenshot

logger = logging.getLogger(__name__)

# Cap on how many annotated frames we attach as vision input. Keeps token cost
# bounded for very long recordings while still grounding the model in real
# evidence. Text metadata for every step is always included.
MAX_VISION_FRAMES = 24


class SOPProviderError(Exception):
    """Raised when the LLM call itself fails (network, auth, empty response)."""


class SOPProviderUnavailable(SOPProviderError):
    """Raised when no API key / provider is configured. Not auto-retryable."""


# ---------------------------------------------------------------------------
# Generated-output schema (the strict contract the model must satisfy)
# ---------------------------------------------------------------------------


class _LLMModel(BaseModel):
    # LLM outputs occasionally include harmless extra keys; ignore them rather
    # than rejecting the whole document, but still validate every required field
    # and type strictly. The persisted SOP/SOPStep stay ``extra="forbid"``.
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class GeneratedDecisionBranch(_LLMModel):
    condition: str = Field(min_length=1, max_length=500)
    action: str = Field(min_length=1, max_length=1000)


class GeneratedSOPStep(_LLMModel):
    position: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=1, max_length=4000)
    warning: str | None = Field(default=None, max_length=1000)
    estimated_time_ms: int | None = Field(default=None, ge=0)
    decision_branches: list[GeneratedDecisionBranch] = Field(default_factory=list, max_length=20)


class GeneratedSOP(_LLMModel):
    title: str = Field(min_length=1, max_length=200)
    # Optional supporting narrative (purpose / overview). Stored as the SOP
    # ``document`` — never as a second "full document" version.
    document: str | None = Field(default=None, max_length=20_000)
    steps: list[GeneratedSOPStep] = Field(min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Evidence bundle (pure)
# ---------------------------------------------------------------------------


@dataclass
class EvidenceStep:
    position: int
    screenshot_id: UUID | None
    annotated_storage_key: str | None
    application: str | None
    window_title: str | None
    event_type: str | None
    target_label: str | None
    element_text: str | None
    target_role: str | None
    narration: str | None
    duration_ms: int | None


@dataclass
class EvidenceBundle:
    workflow_name: str
    duration_ms: int
    source_type: str
    transcript_text: str | None
    transcript_segments: list[dict] = field(default_factory=list)
    custom_instruction: str | None = None
    steps: list[EvidenceStep] = field(default_factory=list)


def _align_narration(
    screenshot_captured_at: datetime,
    next_captured_at: datetime | None,
    recording_start: datetime,
    segments: list,
) -> str | None:
    """Concatenate transcript segments overlapping this screenshot's active
    window. Segment start/end are ms-from-recording-start; screenshot times are
    absolute UTC."""
    ss_start = screenshot_captured_at
    ss_end = next_captured_at
    texts = []
    for segment in segments:
        seg_abs_start = recording_start + timedelta(milliseconds=segment.start_ms)
        seg_abs_end = recording_start + timedelta(milliseconds=segment.end_ms)
        if (ss_end is None or seg_abs_start < ss_end) and seg_abs_end > ss_start:
            texts.append(segment.text)
    joined = " ".join(texts).strip()
    return joined or None


def build_evidence_bundle(
    session: WorkflowSession,
    screenshots: list[Screenshot],
    custom_instruction: str | None,
) -> EvidenceBundle:
    """Assemble the serializable evidence the prompt is built from.

    Only redacted (annotated) screenshots are evidence steps. Narration is
    aligned per-frame from the transcript. The matching recorded event supplies
    app/window/element metadata — preferred over raw coordinates per the spec.
    """
    annotated = [shot for shot in screenshots if shot.redaction_status == "redacted"]
    recording_start = screenshots[0].captured_at if screenshots else session.created_at

    transcript = session.transcript
    segments = transcript.segments if transcript and transcript.status == "completed" else []
    transcript_text = transcript.text if transcript and transcript.text else None

    steps: list[EvidenceStep] = []
    for index, screenshot in enumerate(annotated):
        next_shot = annotated[index + 1] if index + 1 < len(annotated) else None
        # The last event that declared this frame as its "before" state.
        matching_event = next(
            (
                event
                for event in reversed(session.events)
                if event.before_screenshot_id == screenshot.id
            ),
            None,
        )
        narration = _align_narration(
            screenshot.captured_at,
            next_shot.captured_at if next_shot else None,
            recording_start,
            segments,
        )
        steps.append(
            EvidenceStep(
                position=index + 1,
                screenshot_id=screenshot.id,
                annotated_storage_key=screenshot.annotated_storage_key,
                application=matching_event.application if matching_event else None,
                window_title=matching_event.window_title if matching_event else None,
                event_type=str(matching_event.event_type) if matching_event else None,
                target_label=matching_event.target_label if matching_event else None,
                element_text=matching_event.element_text if matching_event else None,
                target_role=matching_event.target_role if matching_event else None,
                narration=narration,
                duration_ms=matching_event.duration_ms if matching_event else None,
            )
        )

    instruction_present = bool(custom_instruction and custom_instruction.strip())
    cleaned_instruction = custom_instruction.strip() if instruction_present else None

    return EvidenceBundle(
        workflow_name=session.workflow_name,
        duration_ms=session.duration_ms,
        source_type=session.source_type,
        transcript_text=transcript_text,
        transcript_segments=[seg.model_dump(mode="json") for seg in segments],
        custom_instruction=cleaned_instruction,
        steps=steps,
    )


# ---------------------------------------------------------------------------
# Image encoding (I/O)
# ---------------------------------------------------------------------------


def encode_evidence_images(bundle: EvidenceBundle, storage: ChunkStorage) -> dict[str, str]:
    """Read each annotated PNG and return ``{annotated_storage_key: data_uri}``.

    Frames beyond ``MAX_VISION_FRAMES`` are skipped to bound token cost; their
    text metadata is still in the prompt. Missing/unreadable files are skipped
    so a single bad frame never fails the whole generation.
    """
    data_uris: dict[str, str] = {}
    for index, step in enumerate(bundle.steps):
        if index >= MAX_VISION_FRAMES:
            break
        if not step.annotated_storage_key:
            continue
        try:
            if not storage.exists(step.annotated_storage_key):
                continue
            image_bytes = storage.read(step.annotated_storage_key)
            b64 = base64.b64encode(image_bytes).decode("utf-8")
            data_uris[step.annotated_storage_key] = f"data:image/png;base64,{b64}"
        except Exception:
            logger.warning(
                "Could not encode annotated image: %s", step.annotated_storage_key, exc_info=True
            )
    return data_uris


# ---------------------------------------------------------------------------
# Prompt construction (pure)
# ---------------------------------------------------------------------------


_JSON_SCHEMA_DESCRIPTION = """{
  "title": string,                         // concise SOP title
  "document": string | null,               // optional 1-3 sentence purpose/overview
  "steps": [
    {
      "position": integer,                 // 1-based, ascending
      "title": string,                     // short imperative label, <= 200 chars
      "instruction": string,               // the actionable instruction, <= 4000 chars
      "warning": string | null,            // caveat/gotcha when applicable
      "estimated_time_ms": integer | null, // best-effort ms estimate when timing is visible
      "decision_branches": [               // only when a real choice exists
        {"condition": string, "action": string}
      ]
    }
  ]
}"""


def _element_reference(step: EvidenceStep) -> str:
    """Best human descriptor for the interacted element (label > text > role)."""
    return step.target_label or step.element_text or step.target_role or "the highlighted element"


def _step_context_lines(bundle: EvidenceBundle, image_data_uris: dict[str, str]) -> list[str]:
    lines: list[str] = []
    for step in bundle.steps:
        app = step.window_title or step.application or "the active application"
        action = (step.event_type or "interact").replace("_", " ")
        element = _element_reference(step)
        timing = (
            f"{step.duration_ms} ms observed" if step.duration_ms is not None else "timing unknown"
        )
        narration = (
            f'Narration: "{step.narration}"'
            if step.narration
            else "No narration recorded for this step."
        )
        has_image = bool(image_data_uris.get(step.annotated_storage_key or ""))
        image_note = (
            "An annotated screenshot is attached showing the screen state and the "
            "element the annotation marks."
            if has_image
            else "No annotated screenshot is available for this step; rely on the metadata."
        )
        lines.append(
            f"Step {step.position}:\n"
            f"  - Application / window: {app}\n"
            f"  - Action: {action}\n"
            f"  - Element: {element}\n"
            f"  - Timing: {timing}\n"
            f"  - {narration}\n"
            f"  - {image_note}"
        )
    return lines


def _custom_instruction_block(custom_instruction: str | None) -> str:
    """Render the reviewer's custom instruction as bounded guidance.

    It is framed as tone/scope/format guidance only, and explicitly forbidden
    from inventing evidence or overriding accuracy/privacy — satisfying the
    requirement that it never bypasses tenant/privacy/safety constraints.
    """
    if not custom_instruction:
        return ""
    return (
        "\nREVIEWER GUIDANCE (tone / scope / format only):\n"
        f"{custom_instruction}\n"
        "Treat this as guidance for wording and emphasis. Do NOT invent systems, "
        "labels, credentials, or business rules that are not visible in the "
        "evidence, and do not weaken accuracy or privacy safeguards.\n"
    )


def _system_prompt(bundle: EvidenceBundle) -> str:
    return (
        "You are a senior technical writer producing a Standard Operating "
        "Procedure (SOP) for employees from recorded workflow evidence.\n\n"
        "Ground rules:\n"
        "- Write practical, employee-facing steps a new hire can follow.\n"
        "- Screenshots are VISUAL EVIDENCE; the annotation on each marks the "
        "element or area the user interacted with. Prefer visible labels, the "
        "application/window title, and the provided event metadata over any raw "
        "coordinates. Never quote coordinates in the SOP.\n"
        "- Use ONLY what is visible and recorded. Do NOT invent applications, "
        "labels, URLs, credentials, or business rules that are not in the "
        "evidence. If something is unclear, write a cautious instruction rather "
        " than a fabricated one.\n"
        "- Number steps in order starting at 1. Give each a short imperative "
        "title and a specific instruction (name the control and where it is).\n"
        "- Add a `warning` only when there is a real gotcha; add "
        "`decision_branches` only when the evidence shows a genuine choice.\n"
        "- `estimated_time_ms` is optional; fill it from visible timing when "
        "reasonable, otherwise omit.\n\n"
        "Respond with STRICT JSON ONLY matching this shape (no markdown, no "
        "commentary):\n"
        f"{_JSON_SCHEMA_DESCRIPTION}"
    )


def build_generation_messages(
    bundle: EvidenceBundle, image_data_uris: dict[str, str]
) -> list[dict]:
    """Build the OpenAI chat messages for the generation call (pure)."""
    transcript_block = (
        f'Transcript (reviewer may have edited this):\n"{bundle.transcript_text}"'
        if bundle.transcript_text
        else "No transcript narration is available."
    )
    timing_block = f"Total recorded duration: {bundle.duration_ms} ms."

    text_body = (
        f'Workflow: "{bundle.workflow_name}"\n'
        f"Capture source: {bundle.source_type}\n"
        f"{timing_block}\n\n"
        f"{transcript_block}\n\n"
        f"Evidence steps ({len(bundle.steps)}):\n"
        + "\n".join(_step_context_lines(bundle, image_data_uris))
        + _custom_instruction_block(bundle.custom_instruction)
        + "\nGenerate the SOP as the JSON object described in the system message."
    )

    content: list[dict] = [{"type": "text", "text": text_body}]
    # Attach annotated images in step order, capped to bound token cost.
    for index, step in enumerate(bundle.steps):
        if index >= MAX_VISION_FRAMES:
            break
        data_uri = image_data_uris.get(step.annotated_storage_key or "")
        if not data_uri:
            continue
        content.append(
            {
                "type": "text",
                "text": f"Annotated screenshot for Step {step.position}:",
            }
        )
        content.append({"type": "image_url", "image_url": {"url": data_uri}})

    return [
        {"role": "system", "content": _system_prompt(bundle)},
        {"role": "user", "content": content},
    ]


# ---------------------------------------------------------------------------
# Parsing / validation (pure)
# ---------------------------------------------------------------------------


def _strip_json_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        # Drop an optional opening fence with optional language tag.
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def parse_generated_sop(content: str) -> GeneratedSOP:
    """Parse + validate model output. Raises ``ValueError`` on any failure with
    a human-readable reason (used to drive the repair turn)."""
    if not content or not content.strip():
        raise ValueError("The model returned an empty response.")
    try:
        payload = json.loads(_strip_json_fences(content))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model output was not valid JSON: {exc.msg}") from exc
    try:
        return GeneratedSOP.model_validate(payload)
    except ValidationError as exc:
        # Flatten errors into a short, readable string (no provider internals).
        details = "; ".join(
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()
        )
        raise ValueError(f"Model output failed validation: {details}") from exc


# ---------------------------------------------------------------------------
# Repair turn (pure)
# ---------------------------------------------------------------------------


def build_repair_messages(
    bundle: EvidenceBundle,
    image_data_uris: dict[str, str],
    raw_output: str,
    error_message: str,
) -> list[dict]:
    """One repair turn: replay the original evidence and ask the model to fix
    the specific validation problem."""
    base = build_generation_messages(bundle, image_data_uris)
    base.append(
        {
            "role": "user",
            "content": (
                "Your previous response could not be used:\n"
                f"{error_message}\n\n"
                "Re-emit the COMPLETE SOP as valid JSON matching the schema in the "
                "system message. Do not include markdown fences or any text outside "
                "the JSON object.\n\n"
                f"For reference, your previous (invalid) output began with:\n"
                f"{raw_output[:500]}"
            ),
        }
    )
    return base


# ---------------------------------------------------------------------------
# Mapping validated output -> persisted SOP (pure)
# ---------------------------------------------------------------------------


def generated_to_sop(
    generated: GeneratedSOP,
    bundle: EvidenceBundle,
    tenant_id: UUID,
    session_id: UUID,
) -> SOP:
    """Map validated LLM output to a persisted SOP draft.

    Steps are re-sorted by ``position`` and renumbered 1..n so a slightly off
    ordering from the model never produces gaps. ``screenshot_reference`` is
    assigned from the evidence by position (the model never invents UUIDs).
    Ground-truth ``duration_ms`` from the evidence overrides the model's guess.
    """
    ordered = sorted(generated.steps, key=lambda step: step.position)
    evidence_by_position = {step.position: step for step in bundle.steps}

    steps: list[SOPStep] = []
    for index, generated_step in enumerate(ordered, start=1):
        evidence = evidence_by_position.get(index)
        screenshot_reference = evidence.screenshot_id if evidence else None
        estimated_time = (
            evidence.duration_ms
            if evidence and evidence.duration_ms is not None
            else generated_step.estimated_time_ms
        )
        steps.append(
            SOPStep(
                position=index,
                title=generated_step.title,
                instruction=generated_step.instruction,
                warning=generated_step.warning,
                screenshot_reference=screenshot_reference,
                estimated_time_ms=estimated_time,
                decision_branches=[
                    SOPDecisionBranch(condition=branch.condition, action=branch.action)
                    for branch in generated_step.decision_branches
                ],
            )
        )

    return SOP(
        tenant_id=tenant_id,
        id=uuid4(),
        source_session_id=session_id,
        version=1,  # replace_session_draft_sop assigns the real version
        status=SOPStatus.DRAFT,
        title=generated.title or bundle.workflow_name,
        document=generated.document,
        steps=steps,
    )


# ---------------------------------------------------------------------------
# Provider (the only place that touches the LLM HTTP API)
# ---------------------------------------------------------------------------


class SOPProvider:
    """Thin, swappable client around the OpenAI SDK.

    Construction is cheap; ``complete`` opens the HTTP client per call. The API
    key comes exclusively from settings (env). When no key is configured the
    provider reports unavailable so the task can fail cleanly as ``sop_failed``.
    """

    def __init__(self, settings: Settings):
        self._settings = settings

    @property
    def available(self) -> bool:
        return bool(self._settings.openai_api_key)

    def complete(
        self, messages: list[dict], *, max_tokens: int = 4000, temperature: float = 0.2
    ) -> str:
        if not self.available:
            raise SOPProviderUnavailable("No LLM API key is configured (WORKTRACE_OPENAI_API_KEY).")

        headers: dict[str, str] = {}
        if "openrouter.ai" in self._settings.openai_base_url:
            # OpenRouter ranks/attributes requests via these headers.
            headers = {
                "HTTP-Referer": "https://worktrace.ai",
                "X-Title": "WorkTrace",
            }

        try:
            client = openai.OpenAI(
                base_url=self._settings.openai_base_url,
                api_key=self._settings.openai_api_key,
            )
            response = client.chat.completions.create(
                model=self._settings.openai_model,
                messages=messages,
                response_format={"type": "json_object"},
                max_tokens=max_tokens,
                temperature=temperature,
                extra_headers=headers or None,
            )
        except Exception as exc:  # network / auth / rate-limit / server error
            raise SOPProviderError(f"LLM request failed: {exc}") from exc

        if not response.choices:
            raise SOPProviderError("LLM returned no choices.")
        content = response.choices[0].message.content
        if not content or not content.strip():
            raise SOPProviderError("LLM returned an empty response.")
        return content
