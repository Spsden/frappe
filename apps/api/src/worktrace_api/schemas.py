from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

SCHEMA_VERSION = "1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class AccountRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class SignUpRequest(StrictModel):
    company_name: str = Field(min_length=2, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalized_email(value)


class LoginRequest(StrictModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalized_email(value)


class Account(StrictModel):
    user_id: UUID
    tenant_id: UUID
    company_name: str
    email: str
    role: AccountRole


class AuthSession(StrictModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    account: Account


class EventType(StrEnum):
    CLICK = "click"
    INPUT = "input"
    KEY_BURST = "key_burst"
    SCROLL = "scroll"
    NAVIGATION = "navigation"
    APP_SWITCH = "app_switch"
    PAUSE = "pause"
    RESUME = "resume"


class CaptureSource(StrEnum):
    BROWSER = "browser"
    DESKTOP = "desktop"


class TargetBounds(StrictModel):
    x: float
    y: float
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class SessionEvent(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID = Field(default_factory=uuid4)
    sequence: int | None = Field(default=None, ge=0)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    event_type: EventType
    page_url: HttpUrl | None = None
    application: str | None = Field(default=None, max_length=200)
    window_title: str | None = Field(default=None, max_length=500)
    x: float | None = None
    y: float | None = None
    modifiers: list[str] = Field(default_factory=list, max_length=8)
    target_role: str | None = Field(default=None, max_length=100)
    target_label: str | None = Field(default=None, max_length=500)
    target_bounds: TargetBounds | None = None
    safe_selector: str | None = Field(default=None, max_length=500)
    element_text: str | None = Field(default=None, max_length=500)
    consented_text: str | None = Field(default=None, max_length=2000)
    screenshot_reference: UUID | None = None
    before_screenshot_id: UUID | None = None
    after_screenshot_id: UUID | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    event_data: dict[str, Any] = Field(default_factory=dict)
    redaction_reasons: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def requires_event_context(self) -> "SessionEvent":
        if self.event_type == EventType.NAVIGATION and not self.page_url:
            raise ValueError("Navigation events require page_url")
        if not self.page_url and not self.application:
            raise ValueError("Desktop events require application when page_url is absent")
        return self


class SessionStatus(StrEnum):
    RECORDING = "recording"
    SUBMITTED = "submitted"
    APPROVED = "approved"


class EvidenceAnnotation(StrictModel):
    type: Literal["click_rectangle", "scroll_focus", "pointer_focus", "manual_box"]
    event_id: UUID
    screenshot_reference: UUID | None = None
    coordinate_space: Literal["screenshot_pixels", "global_screen"]
    bounds: TargetBounds
    confidence: float = Field(ge=0, le=1)
    source: Literal["event_pointer", "fallback_coordinate", "accessibility"] = "event_pointer"


class ScreenshotAnnotation(StrictModel):
    """A single renderable highlight on a screenshot (Phase 3 overlay source).

    ``event_id``/``event_type`` are optional because a ``manual_box`` highlight
    is authored by the user in the evidence editor and is not tied to a recorded
    input event."""

    event_id: UUID | None = None
    event_type: EventType | None = None
    type: Literal[
        "click_rectangle", "scroll_focus", "pointer_focus", "manual_box", "text_box"
    ]
    coordinate_space: Literal["screenshot_pixels", "global_screen"] = "screenshot_pixels"
    bounds: TargetBounds
    confidence: float = Field(default=1.0, ge=0, le=1)
    # "accessibility" is reserved for Phase 2 element-level capture.
    source: Literal["event_pointer", "fallback_coordinate", "accessibility", "manual"]
    label: str | None = Field(default=None, max_length=500)
    role: str | None = Field(default=None, max_length=100)


class ScreenshotEvidence(StrictModel):
    """A screenshot plus every annotation that references it (N per frame)."""

    id: UUID
    sequence: int = Field(ge=1)
    captured_at: datetime
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    media_type: str = Field(default="image/png", max_length=100)
    annotations: list[ScreenshotAnnotation] = Field(default_factory=list, max_length=50)


class ScreenshotAnnotationInput(StrictModel):
    """Author-supplied annotation for the evidence editor save flow. Only the
    renderable fields are accepted; server-side bookkeeping (coordinate space,
    confidence) is normalized by the endpoint."""

    type: Literal[
        "click_rectangle", "scroll_focus", "pointer_focus", "manual_box", "text_box"
    ]
    bounds: TargetBounds
    label: str | None = Field(default=None, max_length=500)
    role: str | None = Field(default=None, max_length=100)
    source: Literal["event_pointer", "fallback_coordinate", "accessibility", "manual"] = (
        "manual"
    )


class ScreenshotAnnotationSet(StrictModel):
    """Full replacement set of annotations for a single screenshot. An empty
    list means "cleared" (no highlights). Once saved, this set is the
    authoritative source for the frame, overriding event-derived annotations."""

    annotations: list[ScreenshotAnnotationInput] = Field(default_factory=list, max_length=50)


class TranscriptSegment(StrictModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=4000)
    speaker: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def ordered_segment(self) -> "TranscriptSegment":
        if self.end_ms < self.start_ms:
            raise ValueError("Transcript segment end precedes start")
        return self


class RecordingTranscript(StrictModel):
    status: Literal["not_recorded", "pending_transcription", "completed", "failed"]
    text: str | None = Field(default=None, max_length=20_000)
    segments: list[TranscriptSegment] = Field(default_factory=list, max_length=5000)
    audio_chunk_count: int = Field(default=0, ge=0)
    audio_reference: str | None = Field(default=None, max_length=500)


class WorkflowSessionCreate(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    source_type: CaptureSource = CaptureSource.BROWSER
    recording_id: UUID | None = None
    workflow_name: str = Field(min_length=1, max_length=200)
    typed_text_consent: bool = False
    consent_actor: str | None = Field(default=None, max_length=200)
    consent_statement_version: str | None = Field(default=None, max_length=50)
    duration_ms: int = Field(default=0, ge=0)
    transcript: RecordingTranscript | None = None
    events: list[SessionEvent] = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def tenant_ids_match(self) -> "WorkflowSessionCreate":
        if any(event.tenant_id != self.tenant_id for event in self.events):
            raise ValueError("Every event tenant_id must match the session tenant_id")
        if self.typed_text_consent and not (self.consent_statement_version and self.consent_actor):
            raise ValueError("Typed-text consent requires statement version and actor")
        return self


class WorkflowSession(WorkflowSessionCreate):
    id: UUID = Field(default_factory=uuid4)
    status: SessionStatus = SessionStatus.SUBMITTED
    consented_at: datetime | None = None
    external_ai_approved: bool = False
    external_ai_approved_at: datetime | None = None
    external_ai_payload_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SOPStatus(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"
    ARCHIVED = "archived"


class SOPStep(StrictModel):
    id: UUID = Field(default_factory=uuid4)
    position: int = Field(ge=1)
    title: str = Field(max_length=200)
    instruction: str = Field(max_length=4000)
    warning: str | None = Field(default=None, max_length=1000)
    screenshot_reference: UUID | None = None
    evidence_annotations: list[EvidenceAnnotation] = Field(default_factory=list, max_length=20)
    estimated_time_ms: int | None = Field(default=None, ge=0)
    decision_branch: str | None = Field(default=None, max_length=1000)


class SOP(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID = Field(default_factory=uuid4)
    source_session_id: UUID
    version: int = Field(default=1, ge=1)
    status: SOPStatus = SOPStatus.DRAFT
    title: str = Field(max_length=200)
    steps: list[SOPStep] = Field(min_length=1, max_length=500)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class FeedbackClassification(StrEnum):
    TASK_DESCRIPTION = "task_description"
    FRUSTRATION_SIGNAL = "frustration_signal"
    PROCESS_GAP = "process_gap"


class FeedbackCreate(StrictModel):
    session_id: UUID
    sop_step_id: UUID | None = None
    transcript: str = Field(min_length=1, max_length=4000)
    audio_reference: UUID | None = None


class Feedback(FeedbackCreate):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID = Field(default_factory=uuid4)
    classification: FeedbackClassification
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SOPApproval(StrictModel):
    approved: bool


class ReferenceSelection(StrictModel):
    session_id: UUID | None = None


class AnalyticsSummary(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    workflow_name: str
    reference_session_id: UUID | None = None
    clustering_status: Literal["disabled_insufficient_sessions", "not_implemented", "available"]
    path_summaries: list[dict[str, Any]]
    friction_points: list[dict[str, Any]]
    executive_summary: list[str] = Field(max_length=3)


class ExternalAIPayloadPreview(StrictModel):
    provider: str
    approved: bool
    payload_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload: dict[str, Any]
    excluded_fields: list[str]


class ExternalAIApprovalRequest(StrictModel):
    approved: bool
    actor: str = Field(min_length=1, max_length=200)
    payload_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ExportBundle(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    session: WorkflowSession
    sops: list[SOP]
    feedback: list[Feedback]


class RecordingStatus(StrEnum):
    RECORDING = "recording"
    UPLOADING = "uploading"
    VALIDATING = "validating"
    TRANSCRIBING_AUDIO = "transcribing_audio"
    PROCESSING_SCREENSHOTS = "processing_screenshots"
    ALIGNING_EVIDENCE = "aligning_evidence"
    AWAITING_MANUAL_REVIEW = "awaiting_manual_review"
    GENERATING_SOP = "generating_sop"
    SOP_FAILED = "sop_failed"
    READY_FOR_REVIEW = "ready_for_review"
    COMPLETED = "completed"
    FAILED = "failed"


class ChunkContentType(StrEnum):
    AUDIO = "audio"
    EVENTS = "events"
    SCREENSHOTS = "screenshots"


class RecordingCreate(StrictModel):
    id: UUID | None = None
    workflow_name: str = Field(min_length=1, max_length=200)
    source_type: CaptureSource = CaptureSource.DESKTOP
    has_audio: bool = False
    manual_mode: bool = False


class Recording(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID
    workflow_name: str
    source_type: CaptureSource
    session_id: UUID | None = None
    status: RecordingStatus
    expected_chunk_count: int | None = Field(default=None, ge=0)
    uploaded_chunk_count: int = Field(ge=0)
    uploaded_bytes: int = Field(ge=0)
    has_audio: bool
    manual_mode: bool = False
    custom_sop_instruction: str | None = None
    error_message: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


class ChunkReceipt(StrictModel):
    recording_id: UUID
    chunk_index: int = Field(ge=0)
    checksum_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload_size: int = Field(gt=0)
    duplicate: bool = False


class RecordingComplete(StrictModel):
    expected_chunk_count: int = Field(ge=1)


class RecordingRetryTarget(StrEnum):
    SOP = "sop"


class RecordingRetryRequest(StrictModel):
    target: RecordingRetryTarget


class RecordingGenerateSOP(StrictModel):
    custom_instruction: str | None = Field(default=None, max_length=4000)


class ManualReviewUpdate(StrictModel):
    transcript_text: str | None = Field(default=None, max_length=20_000)
    custom_instruction: str | None = Field(default=None, max_length=4000)


class RecordingStatusResponse(StrictModel):
    recording: Recording
    stages: list[RecordingStatus]


class Screenshot(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID
    recording_id: UUID
    session_id: UUID | None = None
    sequence: int = Field(ge=1)
    captured_at: datetime
    storage_key: str = Field(min_length=1, max_length=500)
    media_type: str = Field(default="image/png", max_length=100)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    change_score: float = Field(ge=0, le=1)
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    redaction_status: Literal["pending", "not_required", "redacted", "failed"] = "pending"
    annotated_storage_key: str | None = Field(default=None, max_length=500)
    annotations: list[dict[str, Any]] | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


def _normalized_email(value: str) -> str:
    email = value.strip().lower()
    if (
        email.count("@") != 1
        or email.startswith("@")
        or email.endswith("@")
        or "." not in email.rsplit("@", 1)[1]
    ):
        raise ValueError("Enter a valid email address")
    return email
