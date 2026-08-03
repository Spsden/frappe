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
        "click_rectangle", "scroll_focus", "pointer_focus", "manual_box", "text_box", "redact"
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
    media_url: str | None = Field(default=None, max_length=4000)
    annotated_media_url: str | None = Field(default=None, max_length=4000)
    annotations: list[ScreenshotAnnotation] = Field(default_factory=list, max_length=50)
    privacy_redaction_status: Literal[
        "not_run", "queued", "processing", "clear", "redacted", "failed"
    ] = "not_run"
    privacy_redaction_count: int = Field(default=0, ge=0)
    privacy_redaction_version: int = Field(default=0, ge=0)


class ScreenshotAnnotationInput(StrictModel):
    """Author-supplied annotation for the evidence editor save flow. Only the
    renderable fields are accepted; server-side bookkeeping (coordinate space,
    confidence) is normalized by the endpoint."""

    type: Literal[
        "click_rectangle", "scroll_focus", "pointer_focus", "manual_box", "text_box", "redact"
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


class SOPDecisionBranch(StrictModel):
    """A conditional path within a step ("if X, then Y"). Branches are authored
    by the SOP generator from observed decision points in the evidence."""

    condition: str = Field(min_length=1, max_length=500)
    action: str = Field(min_length=1, max_length=1000)


class SOPStep(StrictModel):
    id: UUID = Field(default_factory=uuid4)
    position: int = Field(ge=1)
    title: str = Field(max_length=200)
    instruction: str = Field(max_length=4000)
    warning: str | None = Field(default=None, max_length=1000)
    screenshot_reference: UUID | None = None
    evidence_annotations: list[EvidenceAnnotation] = Field(default_factory=list, max_length=20)
    estimated_time_ms: int | None = Field(default=None, ge=0)
    observed_duration_ms: int | None = Field(default=None, ge=0)
    decision_branches: list[SOPDecisionBranch] = Field(default_factory=list, max_length=20)


class SOP(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID = Field(default_factory=uuid4)
    source_session_id: UUID
    version: int = Field(default=1, ge=1)
    status: SOPStatus = SOPStatus.DRAFT
    title: str = Field(max_length=200)
    # Optional supporting narrative (purpose / overview / notes) produced by the
    # generator. Stored as supporting content on the single SOP draft — never as
    # a separate "full document" version.
    document: str | None = Field(default=None, max_length=20_000)
    steps: list[SOPStep] = Field(min_length=1, max_length=500)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SOPLibraryItem(SOP):
    """SOP plus recording context needed by the tenant-wide library.

    Detail/export APIs continue to use the core ``SOP`` schema. Keeping this
    enrichment specific to the library avoids making recording metadata part
    of the SOP document itself.
    """

    workflow_id: UUID | None = None
    workflow_name: str
    recording_id: UUID | None = None
    recording_reference: str | None = None
    recorded_by: UUID | None = None
    recorded_by_email: str | None = None
    recording_created_at: datetime | None = None
    session_duration_ms: int = Field(ge=0)


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


class AnalyticsRunMode(StrEnum):
    # Manually selected 2-5 approved recordings (the original comparison mode).
    SELECTED_COMPARISON = "selected_comparison"
    # Population-level overview using every eligible recording for a workflow.
    WORKFORCE = "workforce"


# Workforce eligibility bounds. Selected comparison keeps its own 2-5 bound on
# the create payload; these govern the server-resolved workforce set.
WORKFORCE_MIN_RECORDINGS = 6
WORKFORCE_MAX_RECORDINGS = 50


class AnalyticsRunStatus(StrEnum):
    QUEUED = "queued"
    EMBEDDING = "embedding"
    ALIGNING = "aligning"
    CLUSTERING = "clustering"
    SCORING_FRICTION = "scoring_friction"
    CALCULATING = "calculating"
    SUMMARIZING = "summarizing"
    COMPLETED = "completed"
    SUMMARY_FAILED = "summary_failed"
    FAILED = "failed"


class AnalyticsRetryTarget(StrEnum):
    SUMMARY = "summary"
    FULL_RUN = "full_run"


class AnalyticsRunCreate(StrictModel):
    """Create payload for a workflow analytics run.

    Two mutually exclusive modes keep run semantics unambiguous:

    * ``selected_comparison`` — the original mode. Requires 2-5 explicit,
      unique ``recording_ids`` that already have an approved SOP.
    * ``workforce`` — population overview. The server resolves every eligible
      recording for the workflow, so ``recording_ids`` must be empty.
    """

    mode: AnalyticsRunMode
    recording_ids: list[UUID] = Field(default_factory=list, max_length=5)

    @field_validator("recording_ids")
    @classmethod
    def unique_recordings(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("Each recording can only be selected once")
        return value

    @model_validator(mode="after")
    def validate_mode_payload(self) -> "AnalyticsRunCreate":
        if self.mode == AnalyticsRunMode.SELECTED_COMPARISON:
            if not 2 <= len(self.recording_ids) <= 5:
                raise ValueError("Selected comparison requires between 2 and 5 recordings")
        elif self.mode == AnalyticsRunMode.WORKFORCE and self.recording_ids:
            raise ValueError("Workforce mode does not accept explicit recording IDs")
        return self


class AnalyticsRetryRequest(StrictModel):
    target: AnalyticsRetryTarget


class AnalyticsEligibleRecording(StrictModel):
    recording_id: UUID
    session_id: UUID
    reference: str | None = None
    recorded_by: UUID | None = None
    recorded_by_email: str | None = None
    duration_ms: int = Field(ge=0)
    sop_id: UUID
    sop_version: int = Field(ge=1)
    sop_title: str
    step_count: int = Field(ge=1)
    approved_sop_created_at: datetime


class AnalyticsRunInput(StrictModel):
    position: int = Field(ge=1)
    recording_id: UUID
    session_id: UUID
    sop_id: UUID
    sop_version: int = Field(ge=1)
    sop_content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    recording_reference: str | None = None
    recorded_by: UUID | None = None
    recorded_by_email: str | None = None
    duration_ms: int = Field(ge=0)


class AnalyticsRecordingMetric(StrictModel):
    recording_id: UUID
    label: str
    rank: int = Field(ge=1)
    total_duration_ms: int = Field(ge=0)
    step_count: int = Field(ge=1)
    path_signature: str


class AnalyticsTimelineStep(StrictModel):
    group_id: str
    sop_step_id: UUID
    label: str
    start_ms: int = Field(ge=0)
    duration_ms: int = Field(ge=0)
    classification: Literal["shared", "optional", "path_specific"]
    timing_source: Literal["observed", "estimated", "unavailable"]


class AnalyticsPathTimeline(StrictModel):
    recording_id: UUID
    label: str
    total_duration_ms: int = Field(ge=0)
    unallocated_duration_ms: int = Field(ge=0)
    steps: list[AnalyticsTimelineStep]


class AnalyticsStepComparison(StrictModel):
    group_id: str
    label: str
    sample_count: int = Field(ge=1)
    fastest_duration_ms: int | None = Field(default=None, ge=0)
    average_duration_ms: int = Field(ge=0)
    fastest_path_has_step: bool


class AnalyticsComparisonOverview(StrictModel):
    recording_count: int = Field(ge=2, le=WORKFORCE_MAX_RECORDINGS)
    distinct_path_count: int = Field(ge=1)
    fastest_recording_id: UUID
    fastest_duration_ms: int = Field(ge=0)
    average_duration_ms: int = Field(ge=0)
    potential_time_saved_ms: int = Field(ge=0)
    shared_step_count: int = Field(ge=0)
    optional_step_count: int = Field(ge=0)
    path_specific_step_count: int = Field(ge=0)
    timing_coverage: float = Field(ge=0, le=1)


class AnalyticsClusterMember(StrictModel):
    recording_id: UUID
    label: str
    total_duration_ms: int = Field(ge=0)


class AnalyticsClusterSummary(StrictModel):
    cluster_id: str
    label: str
    recording_count: int = Field(ge=2)
    average_duration_ms: int = Field(ge=0)
    average_step_count: float = Field(ge=0)
    representative_recording_id: UUID
    path_signature: str
    members: list[AnalyticsClusterMember] = Field(min_length=2)


class AnalyticsFrictionMetric(StrictModel):
    group_id: str
    label: str
    cluster_id: str | None = None
    sample_count: int = Field(ge=0)
    population_count: int = Field(ge=1)
    mean_duration_ms: int | None = Field(default=None, ge=0)
    median_duration_ms: int | None = Field(default=None, ge=0)
    standard_deviation_ms: int | None = Field(default=None, ge=0)
    coefficient_of_variation: float | None = Field(default=None, ge=0)
    presence_frequency: float = Field(ge=0, le=1)
    optional_frequency: float = Field(ge=0, le=1)
    friction_score: int | None = Field(default=None, ge=0, le=100)
    confidence: Literal["insufficient", "low", "medium", "high"]


class AnalyticsHeatmapCell(StrictModel):
    group_id: str
    cluster_id: str
    present: bool
    sample_count: int = Field(ge=0)
    mean_duration_ms: int | None = Field(default=None, ge=0)
    standard_deviation_ms: int | None = Field(default=None, ge=0)
    friction_score: int | None = Field(default=None, ge=0, le=100)
    confidence: Literal["insufficient", "low", "medium", "high"]


class AnalyticsWorkforceOverview(StrictModel):
    recording_count: int = Field(ge=WORKFORCE_MIN_RECORDINGS, le=WORKFORCE_MAX_RECORDINGS)
    selected_k: int = Field(ge=1, le=4)
    silhouette_score: float | None = Field(default=None, ge=-1, le=1)
    cluster_quality: Literal["strong", "moderate", "weak", "insufficient_separation"]


class AnalyticsWorkforceResult(StrictModel):
    overview: AnalyticsWorkforceOverview
    clusters: list[AnalyticsClusterSummary] = Field(min_length=1, max_length=4)
    friction: list[AnalyticsFrictionMetric]
    heatmap: list[AnalyticsHeatmapCell]


class AnalyticsResult(StrictModel):
    overview: AnalyticsComparisonOverview
    completion_ranking: list[AnalyticsRecordingMetric] = Field(
        min_length=2, max_length=WORKFORCE_MAX_RECORDINGS
    )
    path_timelines: list[AnalyticsPathTimeline] = Field(
        min_length=2, max_length=WORKFORCE_MAX_RECORDINGS
    )
    fastest_vs_average: list[AnalyticsStepComparison]
    alignment_notes: list[str] = Field(default_factory=list, max_length=20)
    workforce: AnalyticsWorkforceResult | None = None


class AnalyticsRun(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID
    workflow_id: UUID
    workflow_name: str
    version: int = Field(ge=1)
    mode: AnalyticsRunMode
    status: AnalyticsRunStatus
    # Selected comparison caps at 5; workforce caps at WORKFORCE_MAX_RECORDINGS.
    input_count: int = Field(ge=2, le=WORKFORCE_MAX_RECORDINGS)
    embedding_model: str
    algorithm_version: str
    inputs: list[AnalyticsRunInput] = Field(min_length=2, max_length=WORKFORCE_MAX_RECORDINGS)
    result: AnalyticsResult | None = None
    executive_summary: list[str] | None = Field(default=None, min_length=3, max_length=3)
    failure_stage: str | None = None
    error_message: str | None = None
    created_by: UUID | None = None
    supersedes_run_id: UUID | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime


class DashboardSummary(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    workflows_recorded: int = Field(ge=0)
    workflows_recorded_this_month: int = Field(ge=0)
    workflows_recorded_change_percent: float | None = None
    sops_generated: int = Field(ge=0)
    approved_sops: int = Field(ge=0)
    active_workflows: int = Field(ge=0)
    average_completion_ms: int | None = Field(default=None, ge=0)
    average_completion_delta_ms: int | None = None


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


class RedactionRunStatus(StrEnum):
    NOT_RUN = "not_run"
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIAL_FAILED = "partial_failed"
    FAILED = "failed"


class RedactionRun(StrictModel):
    id: UUID | None = None
    recording_id: UUID
    version: int = Field(default=0, ge=0)
    status: RedactionRunStatus = RedactionRunStatus.NOT_RUN
    total_screenshots: int = Field(default=0, ge=0)
    processed_screenshots: int = Field(default=0, ge=0)
    redacted_screenshots: int = Field(default=0, ge=0)
    redaction_count: int = Field(default=0, ge=0)
    failed_screenshots: int = Field(default=0, ge=0)
    detector_mode: Literal["model_and_rules", "rules_only"] | None = None
    warning_message: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None


class ChunkContentType(StrEnum):
    AUDIO = "audio"
    EVENTS = "events"
    SCREENSHOTS = "screenshots"


class RecordingCreate(StrictModel):
    id: UUID | None = None
    # Exactly one of workflow_id (attach to an existing workflow) or
    # workflow_name (create a new workflow in the same transaction) must be
    # provided. ``workflow_name`` is also accepted for the resumable-upload
    # retry path, which converges on the existing same-named workflow.
    workflow_id: UUID | None = None
    workflow_name: str | None = Field(default=None, min_length=1, max_length=200)
    reference: str | None = Field(default=None, max_length=300)
    source_type: CaptureSource = CaptureSource.DESKTOP
    has_audio: bool = False
    manual_mode: bool = False

    @model_validator(mode="after")
    def requires_exactly_one_workflow(self) -> "RecordingCreate":
        if bool(self.workflow_id) == bool(self.workflow_name):
            raise ValueError("Provide exactly one of workflow_id or workflow_name")
        return self


class Recording(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID
    workflow_id: UUID | None = None
    workflow_name: str
    reference: str | None = None
    recorded_by: UUID | None = None
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


class WorkflowCreate(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class Workflow(StrictModel):
    """A shared, reusable procedure that groups one or more recordings.

    The summary counts (recording/user totals, processing vs ready splits and
    the most recent recording time) are computed server-side in a single
    grouped query so the list view never runs into N+1 lookups.
    """

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID
    name: str
    description: str | None = None
    created_by: UUID | None = None
    created_by_email: str | None = None
    recording_count: int = Field(default=0, ge=0)
    user_count: int = Field(default=0, ge=0)
    last_recording_at: datetime | None = None
    processing_count: int = Field(default=0, ge=0)
    ready_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime


class WorkflowRecording(StrictModel):
    """A recording row scoped to a workflow, enriched with the joined fields the
    workflow-details list needs (session duration + recorded-by label) so the
    page can render without per-row follow-up requests."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    tenant_id: UUID
    id: UUID
    workflow_id: UUID | None = None
    workflow_name: str
    reference: str | None = None
    recorded_by: UUID | None = None
    recorded_by_email: str | None = None
    session_id: UUID | None = None
    status: RecordingStatus
    duration_ms: int | None = None
    created_at: datetime
    completed_at: datetime | None = None


class RecordingComplete(StrictModel):
    expected_chunk_count: int = Field(ge=1)


class RecordingRetryTarget(StrEnum):
    SOP = "sop"


class RecordingRetryRequest(StrictModel):
    target: RecordingRetryTarget


class RecordingGenerateSOP(StrictModel):
    custom_instruction: str | None = Field(default=None, max_length=4000)


class LLMProviderSettings(StrictModel):
    base_url: str = Field(max_length=500)
    model: str = Field(max_length=200)
    has_api_key: bool
    updated_at: datetime | None = None


class LLMProviderSettingsUpdate(StrictModel):
    base_url: str = Field(min_length=1, max_length=500)
    model: str = Field(min_length=1, max_length=200)
    api_key: str | None = Field(default=None, max_length=2000)
    clear_api_key: bool = False


# Per-tenant overrides for the SOP generation guardrails (see Settings). Each
# name matches a ``sop_*`` field on Settings so env defaults and overrides stay
# in lockstep.
SOP_LIMIT_FIELDS: tuple[str, ...] = (
    "sop_max_evidence_steps",
    "sop_max_vision_frames",
    "sop_image_max_dimension_px",
    "sop_image_jpeg_quality",
    "sop_max_output_tokens",
)


class SopLimitsSettings(StrictModel):
    """Effective SOP generation guardrails for a tenant.

    Each ``sop_*`` value is the override when one is set, otherwise the env
    default. ``defaults`` carries the env defaults and ``overridden`` flags which
    fields the tenant has customized, so the UI can show "default" badges and a
    reset-to-default action.
    """

    sop_max_evidence_steps: int
    sop_max_vision_frames: int
    sop_image_max_dimension_px: int
    sop_image_jpeg_quality: int
    sop_max_output_tokens: int
    defaults: dict[str, int]
    overridden: dict[str, bool]
    updated_at: datetime | None = None


class SopLimitsSettingsUpdate(StrictModel):
    """Partial update of SOP guardrails. Bounds mirror ``Settings``.

    Omit a field to leave it unchanged; send ``null`` to clear the override
    (revert to the env default); send an int to set/replace the override.
    """

    sop_max_evidence_steps: int | None = Field(default=None, ge=1, le=500)
    sop_max_vision_frames: int | None = Field(default=None, ge=0, le=100)
    sop_image_max_dimension_px: int | None = Field(default=None, ge=320, le=4096)
    sop_image_jpeg_quality: int | None = Field(default=None, ge=30, le=95)
    sop_max_output_tokens: int | None = Field(default=None, ge=1000, le=32000)


class ManualReviewUpdate(StrictModel):
    transcript_text: str | None = Field(default=None, max_length=20_000)
    custom_instruction: str | None = Field(default=None, max_length=4000)


class RecordingStatusResponse(StrictModel):
    recording: Recording
    stages: list[RecordingStatus]


class RecordingStatusesRequest(StrictModel):
    recording_ids: list[UUID] = Field(min_length=1, max_length=500)


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
    privacy_redaction_status: Literal[
        "not_run", "queued", "processing", "clear", "redacted", "failed"
    ] = "not_run"
    privacy_redaction_count: int = Field(default=0, ge=0)
    privacy_redaction_version: int = Field(default=0, ge=0)
    privacy_redacted_storage_key: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SearchResultKind(StrEnum):
    SOP = "sop"
    SESSION = "session"


class SearchResult(StrictModel):
    """A single cross-entity hit for the global search endpoint.

    ``source_session_id`` lets the desktop client route to the SOP detail page
    (which is keyed by session). ``matched_field`` tells the UI why the row is a
    hit (title vs document vs step text vs workflow name) so deep hits can be
    surfaced with context rather than looking like title matches.
    """

    kind: SearchResultKind
    id: UUID
    title: str = Field(max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    matched_field: Literal["title", "document", "step", "workflow_name"]
    status: str | None = Field(default=None, max_length=30)
    source_session_id: UUID | None = None
    created_at: datetime


class SearchResponse(StrictModel):
    query: str
    results: list[SearchResult] = Field(default_factory=list, max_length=100)


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
