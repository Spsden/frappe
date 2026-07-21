import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Path,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from sqlalchemy.orm import Session

from worktrace_api.auth import (
    AuthenticationError,
    EmailAlreadyRegisteredError,
    authenticate,
    log_in,
    log_out,
    sign_up,
)
from worktrace_api.database import create_tables
from worktrace_api.media_tokens import (
    MediaTokenError,
    create_media_token,
    parse_media_token,
)
from worktrace_api.privacy import sanitize_session
from worktrace_api.processing import RecordingProcessor
from worktrace_api.recordings import ChunkStorage
from worktrace_api.repository import Repository, get_db
from worktrace_api.schemas import (
    SOP,
    SOP_LIMIT_FIELDS,
    Account,
    AnalyticsSummary,
    AuthSession,
    ChunkContentType,
    ChunkReceipt,
    ExportBundle,
    ExternalAIApprovalRequest,
    ExternalAIPayloadPreview,
    Feedback,
    FeedbackCreate,
    LLMProviderSettings,
    LLMProviderSettingsUpdate,
    LoginRequest,
    ManualReviewUpdate,
    Recording,
    RecordingComplete,
    RecordingCreate,
    RecordingGenerateSOP,
    RecordingRetryRequest,
    RecordingRetryTarget,
    RecordingStatus,
    RecordingStatusesRequest,
    RecordingStatusResponse,
    Screenshot,
    ScreenshotAnnotation,
    ScreenshotAnnotationSet,
    ScreenshotEvidence,
    SignUpRequest,
    SOPApproval,
    SopLimitsSettings,
    SopLimitsSettingsUpdate,
    SOPStatus,
    TargetBounds,
    WorkflowSession,
    WorkflowSessionCreate,
)
from worktrace_api.services import (
    analyze_workflow,
    classify_feedback,
    external_ai_preview,
)
from worktrace_api.settings import get_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_tables()
    yield


settings = get_settings()
app = FastAPI(
    title="WorkTrace API",
    version="0.1.0",
    description=(
        "Secure tenant-isolated workflow capture, SOP, onboarding, feedback, "
        "analytics, and export API."
    ),
    lifespan=lifespan,
    openapi_tags=[
        {"name": "system", "description": "Runtime health."},
        {"name": "auth", "description": "Tenant signup and user sessions."},
        {"name": "settings", "description": "Tenant-level backend configuration."},
        {"name": "sessions", "description": "Workflow ingestion and privacy controls."},
        {"name": "recordings", "description": "Resumable raw recording ingestion."},
        {"name": "sops", "description": "SOP generation, review, and approval."},
        {"name": "walkthroughs", "description": "Approved onboarding walkthroughs."},
        {"name": "feedback", "description": "Employee feedback capture and classification."},
        {"name": "analytics", "description": "Conservative workflow-path and friction evidence."},
        {"name": "exports", "description": "Sanitized session export bundles."},
    ],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Tenant-ID"],
)
chunk_storage = ChunkStorage(settings.recording_storage_path, settings.max_chunk_bytes)
recording_processor = RecordingProcessor(chunk_storage, settings.allowed_domains)
processing_stages = [
    RecordingStatus.RECORDING,
    RecordingStatus.UPLOADING,
    RecordingStatus.VALIDATING,
    RecordingStatus.TRANSCRIBING_AUDIO,
    RecordingStatus.PROCESSING_SCREENSHOTS,
    RecordingStatus.ALIGNING_EVIDENCE,
    RecordingStatus.AWAITING_MANUAL_REVIEW,
    RecordingStatus.GENERATING_SOP,
    RecordingStatus.SOP_FAILED,
    RecordingStatus.READY_FOR_REVIEW,
    RecordingStatus.COMPLETED,
]
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthContext:
    account: Account
    access_token: str


def authenticated_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    x_tenant_id: UUID | None = Header(default=None, alias="X-Tenant-ID"),
    db: Session = Depends(get_db, scope="function"),
) -> AuthContext:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        account = authenticate(db, credentials.credentials)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    if x_tenant_id and x_tenant_id != account.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    return AuthContext(account=account, access_token=credentials.credentials)


def repository(
    auth: AuthContext = Depends(authenticated_account),
    db: Session = Depends(get_db, scope="function"),
) -> Repository:
    return Repository(db, auth.account.tenant_id)


def require_session(repo: Repository, session_id: UUID) -> WorkflowSession:
    session = repo.get_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


def signed_media_url(request: Request, storage_key: str, media_type: str) -> str:
    token = create_media_token(
        storage_key=storage_key,
        media_type=media_type,
        secret=settings.media_token_secret,
        ttl_seconds=settings.media_token_ttl_seconds,
    )
    return str(request.url_for("get_media_file", token=token))


def screenshot_evidence(
    request: Request,
    screenshot: Screenshot,
    annotations: list[ScreenshotAnnotation],
) -> ScreenshotEvidence:
    return ScreenshotEvidence(
        id=screenshot.id,
        sequence=screenshot.sequence,
        captured_at=screenshot.captured_at,
        width=screenshot.width,
        height=screenshot.height,
        media_type=screenshot.media_type,
        media_url=signed_media_url(request, screenshot.storage_key, screenshot.media_type),
        annotated_media_url=(
            signed_media_url(request, screenshot.annotated_storage_key, "image/png")
            if screenshot.annotated_storage_key
            else None
        ),
        annotations=annotations,
    )


@app.get("/health", tags=["system"])
def health() -> dict[str, Any]:
    from worktrace_api.core.celery_app import service_status

    return {
        "status": "ok",
        "environment": settings.env,
        "services": service_status(settings.redis_url),
    }


@app.get("/media/{token}", name="get_media_file", tags=["sessions"])
def get_media_file(token: str) -> FileResponse:
    try:
        payload = parse_media_token(token, secret=settings.media_token_secret)
    except MediaTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media not found",
        ) from exc

    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes,
    )
    path = storage.resolve_storage_key(payload.storage_key)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    return FileResponse(path, media_type=payload.media_type)


@app.post(
    "/auth/signup",
    response_model=AuthSession,
    status_code=status.HTTP_201_CREATED,
    tags=["auth"],
)
def signup(
    payload: SignUpRequest,
    db: Session = Depends(get_db, scope="function"),
) -> AuthSession:
    try:
        return sign_up(db, payload, settings.access_token_ttl_hours)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.post("/auth/login", response_model=AuthSession, tags=["auth"])
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db, scope="function"),
) -> AuthSession:
    try:
        return log_in(db, payload, settings.access_token_ttl_hours)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


@app.get("/auth/me", response_model=Account, tags=["auth"])
def current_account(auth: AuthContext = Depends(authenticated_account)) -> Account:
    return auth.account


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
def logout(
    auth: AuthContext = Depends(authenticated_account),
    db: Session = Depends(get_db, scope="function"),
) -> Response:
    log_out(db, auth.access_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/settings/llm-provider", response_model=LLMProviderSettings, tags=["settings"])
def get_llm_provider_settings(repo: Repository = Depends(repository)) -> LLMProviderSettings:
    return repo.get_llm_provider_settings(
        settings.openai_base_url,
        settings.openai_model,
        settings.openai_api_key,
    )


@app.put("/settings/llm-provider", response_model=LLMProviderSettings, tags=["settings"])
def save_llm_provider_settings(
    payload: LLMProviderSettingsUpdate,
    repo: Repository = Depends(repository),
) -> LLMProviderSettings:
    return repo.save_llm_provider_settings(payload, settings.openai_api_key)


def _sop_limit_defaults() -> dict[str, int]:
    return {field: int(getattr(settings, field)) for field in SOP_LIMIT_FIELDS}


@app.get("/settings/sop-limits", response_model=SopLimitsSettings, tags=["settings"])
def get_sop_limits_settings(repo: Repository = Depends(repository)) -> SopLimitsSettings:
    return repo.get_sop_limits(_sop_limit_defaults())


@app.put("/settings/sop-limits", response_model=SopLimitsSettings, tags=["settings"])
def save_sop_limits_settings(
    payload: SopLimitsSettingsUpdate,
    repo: Repository = Depends(repository),
) -> SopLimitsSettings:
    return repo.save_sop_limits(payload, _sop_limit_defaults())


# Primary recording ingestion endpoint.
@app.post(
    "/recordings",
    response_model=Recording,
    status_code=status.HTTP_201_CREATED,
    tags=["recordings"],
)
def create_recording(
    payload: RecordingCreate,
    response: Response,
    repo: Repository = Depends(repository),
) -> Recording:
    if payload.id:
        existing = repo.get_recording(payload.id)
        if existing:
            if (
                existing.workflow_name != payload.workflow_name
                or existing.source_type != payload.source_type
                or existing.has_audio != payload.has_audio
                or existing.manual_mode != payload.manual_mode
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Recording id already exists with different metadata",
                )
            response.status_code = status.HTTP_200_OK
            return existing
    try:
        return repo.create_recording(
            payload.workflow_name,
            payload.source_type,
            payload.has_audio,
            payload.id,
            payload.manual_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.put(
    "/recordings/{recording_id}/chunks/{chunk_index}",
    response_model=ChunkReceipt,
    tags=["recordings"],
)
async def upload_recording_chunk(
    recording_id: UUID,
    chunk_index: int = Path(ge=0),
    content_type: ChunkContentType = Form(),
    timestamp_start_ms: int = Form(ge=0),
    timestamp_end_ms: int = Form(ge=0),
    checksum_sha256: str = Form(pattern=r"^[a-f0-9]{64}$"),
    idempotency_key: str = Form(min_length=1, max_length=200),
    payload_size: int = Form(gt=0),
    metadata_json: str = Form(default="{}"),
    file: UploadFile = File(),
    repo: Repository = Depends(repository),
) -> ChunkReceipt:
    recording = repo.get_recording(recording_id)
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    if timestamp_end_ms < timestamp_start_ms:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chunk end timestamp precedes start timestamp",
        )
    payload = await file.read(settings.max_chunk_bytes + 1)
    try:
        parsed_metadata = json.loads(metadata_json)
        if not isinstance(parsed_metadata, dict):
            raise ValueError("Chunk metadata must be a JSON object")
        actual_payload_size = chunk_storage.validate(payload, checksum_sha256)
        if actual_payload_size != payload_size:
            raise ValueError("Declared payload size does not match payload")
        existing = repo.get_matching_chunk_receipt(
            recording_id,
            chunk_index,
            content_type,
            timestamp_start_ms,
            timestamp_end_ms,
            checksum_sha256,
            idempotency_key,
            parsed_metadata,
        )
        if existing:
            return existing
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if recording.status not in {RecordingStatus.RECORDING, RecordingStatus.UPLOADING}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Recording no longer accepts chunks",
        )
    try:
        storage_key, payload_size = chunk_storage.write(
            repo.tenant_id,
            recording_id,
            chunk_index,
            content_type,
            file.content_type or "application/octet-stream",
            file.filename,
            payload,
            checksum_sha256,
        )
        return repo.save_chunk(
            recording_id=recording_id,
            chunk_index=chunk_index,
            content_type=content_type,
            media_type=file.content_type or "application/octet-stream",
            timestamp_start_ms=timestamp_start_ms,
            timestamp_end_ms=timestamp_end_ms,
            checksum_sha256=checksum_sha256,
            idempotency_key=idempotency_key,
            payload_size=payload_size,
            storage_key=storage_key,
            metadata_json=parsed_metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc



#means recording is complete and ready for processing.
@app.post(
    "/recordings/{recording_id}/complete",
    response_model=Recording,
    tags=["recordings"],
)
def complete_recording(
    recording_id: UUID,
    payload: RecordingComplete,
    repo: Repository = Depends(repository),
) -> Recording:
    try:
        repo.complete_recording(recording_id, payload.expected_chunk_count)
        return recording_processor.process(recording_id, repo)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.post(
    "/recordings/{recording_id}/retry",
    response_model=Recording,
    tags=["recordings"],
)
def retry_recording_step(
    recording_id: UUID,
    payload: RecordingRetryRequest,
    repo: Repository = Depends(repository),
) -> Recording:
    if payload.target == RecordingRetryTarget.SOP:
        return _retry_sop_generation(recording_id, repo)
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Unsupported retry target: {payload.target}",
    )


def _dispatch_sop_generation(recording: Recording, repo: Repository) -> Recording:
    """Shared tail for the retry and manual-generate routes: mark the recording
    as generating, enqueue the SOP task, and on dispatch failure land cleanly on
    ``sop_failed`` (never generic ``failed``) with a non-sensitive message."""
    updated = repo.set_recording_status(recording.id, RecordingStatus.GENERATING_SOP) or recording
    queued, error_message = recording_processor.enqueue_sop_generation(
        recording.id,
        recording.session_id,
        repo.tenant_id,
    )
    if not queued:
        repo.set_recording_status(
            recording.id,
            RecordingStatus.SOP_FAILED,
            error_message or "Could not queue SOP generation",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_message or "Could not queue SOP generation",
        )
    return updated


def _retry_sop_generation(recording_id: UUID, repo: Repository) -> Recording:
    recording = repo.get_recording(recording_id)
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    if not recording.session_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Recording has no processed session yet",
        )
    if recording.status != RecordingStatus.SOP_FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SOP retry is only available after SOP generation fails",
        )

    return _dispatch_sop_generation(recording, repo)


@app.put(
    "/recordings/{recording_id}/manual-review",
    response_model=Recording,
    tags=["recordings"],
)
def save_manual_review(
    recording_id: UUID,
    payload: ManualReviewUpdate,
    repo: Repository = Depends(repository),
) -> Recording:
    try:
        return repo.save_manual_review(
            recording_id,
            transcript_text=payload.transcript_text,
            custom_instruction=payload.custom_instruction,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.post(
    "/recordings/{recording_id}/generate-sop",
    response_model=Recording,
    tags=["recordings"],
)
def generate_recording_sop(
    recording_id: UUID,
    payload: RecordingGenerateSOP,
    repo: Repository = Depends(repository),
) -> Recording:
    recording = repo.get_recording(recording_id)
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    if not recording.session_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Recording has no processed session yet",
        )
    if recording.status not in {
        RecordingStatus.AWAITING_MANUAL_REVIEW,
        RecordingStatus.SOP_FAILED,
        RecordingStatus.READY_FOR_REVIEW,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Recording is not ready for manual SOP generation",
        )

    updated = (
        repo.set_recording_custom_instruction(recording_id, payload.custom_instruction)
        or recording
    )
    return _dispatch_sop_generation(updated, repo)


@app.get(
    "/recordings/{recording_id}/status",
    response_model=RecordingStatusResponse,
    tags=["recordings"],
)
def recording_status(
    recording_id: UUID, repo: Repository = Depends(repository)
) -> RecordingStatusResponse:
    recording = repo.get_recording(recording_id)
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    return build_recording_status(recording, repo)


@app.post(
    "/recordings/statuses",
    response_model=list[RecordingStatusResponse],
    tags=["recordings"],
)
def recording_statuses(
    payload: RecordingStatusesRequest,
    repo: Repository = Depends(repository),
) -> list[RecordingStatusResponse]:
    recordings = repo.get_recordings(payload.recording_ids)
    return [build_recording_status(recording, repo) for recording in recordings]


def build_recording_status(
    recording: Recording,
    repo: Repository,
) -> RecordingStatusResponse:
    missing_chunks = [
        chunk.storage_key
        for chunk in repo.list_recording_chunks(recording.id)
        if not chunk_storage.exists(chunk.storage_key)
    ]
    if missing_chunks:
        recording = repo.set_recording_status(
            recording.id,
            RecordingStatus.FAILED,
            f"Recording evidence files are missing for {len(missing_chunks)} uploaded chunk(s).",
        ) or recording
    stages = [
        stage
        for stage in processing_stages
        if recording.has_audio or stage != RecordingStatus.TRANSCRIBING_AUDIO
    ]
    return RecordingStatusResponse(recording=recording, stages=stages)


@app.delete(
    "/recordings/{recording_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["recordings"],
)
def delete_recording(recording_id: UUID, repo: Repository = Depends(repository)) -> None:
    if not repo.get_recording(recording_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    chunk_storage.delete_recording(repo.tenant_id, recording_id)
    repo.delete_recording(recording_id)


@app.post(
    "/sessions",
    response_model=WorkflowSession,
    status_code=status.HTTP_201_CREATED,
    tags=["sessions"],
)
def create_session(
    payload: WorkflowSessionCreate, repo: Repository = Depends(repository)
) -> WorkflowSession:
    if payload.tenant_id != repo.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    try:
        session = WorkflowSession(
            **payload.model_dump(),
            consented_at=datetime.now(UTC) if payload.typed_text_consent else None,
        )
        return repo.save_session(sanitize_session(session, settings.allowed_domains))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@app.get("/sessions", response_model=list[WorkflowSession], tags=["sessions"])
def list_sessions(
    workflow_name: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    repo: Repository = Depends(repository),
) -> list[WorkflowSession]:
    return repo.list_sessions(workflow_name, limit, offset)


@app.get("/sessions/{session_id}", response_model=WorkflowSession, tags=["sessions"])
def get_session(session_id: UUID, repo: Repository = Depends(repository)) -> WorkflowSession:
    return require_session(repo, session_id)


@app.get(
    "/sessions/{session_id}/screenshots",
    response_model=list[ScreenshotEvidence],
    tags=["sessions"],
)
def list_session_screenshots(
    session_id: UUID,
    request: Request,
    repo: Repository = Depends(repository),
) -> list[ScreenshotEvidence]:
    """Screenshots for a session, each carrying every annotation that references
    it (N highlights per frame). Only annotations already resolved to
    screenshot-pixel space are exposed, so the frontend can render them directly
    as overlays without any further coordinate math."""
    session = require_session(repo, session_id)
    screenshots = repo.get_screenshots_for_session(session_id)

    annotations_by_screenshot: dict[UUID, list[ScreenshotAnnotation]] = {}
    for event in session.events:
        annotation = (event.event_data or {}).get("evidenceAnnotation")
        if not isinstance(annotation, dict) or "bounds" not in annotation:
            continue
        if annotation.get("coordinate_space") != "screenshot_pixels":
            continue
        target = event.screenshot_reference or event.after_screenshot_id
        if target is None:
            continue
        try:
            bounds = TargetBounds(**annotation["bounds"])
        except (TypeError, ValueError):
            continue
        annotations_by_screenshot.setdefault(UUID(str(target)), []).append(
            ScreenshotAnnotation(
                event_id=event.id,
                event_type=event.event_type,
                type=annotation.get("type", "click_rectangle"),
                coordinate_space="screenshot_pixels",
                bounds=bounds,
                confidence=float(annotation.get("confidence", 0.45)),
                source=annotation.get("source", "fallback_coordinate"),
                label=event.target_label,
                role=event.target_role,
            )
        )

    return [
        screenshot_evidence(
            request,
            screenshot,
            _effective_annotations(screenshot, annotations_by_screenshot),
        )
        for screenshot in screenshots
    ]


def _effective_annotations(
    screenshot: Screenshot,
    derived: dict[UUID, list[ScreenshotAnnotation]],
) -> list[ScreenshotAnnotation]:
    """If the frame carries an authoritative (user-edited) annotation set, use
    it; otherwise fall back to the annotations derived from recorded events."""
    if screenshot.annotations is None:
        return derived.get(screenshot.id, [])
    try:
        return [ScreenshotAnnotation(**item) for item in screenshot.annotations]
    except (TypeError, ValueError):
        return derived.get(screenshot.id, [])


@app.put(
    "/sessions/{session_id}/screenshots/{screenshot_id}/annotations",
    response_model=ScreenshotEvidence,
    tags=["sessions"],
)
async def replace_screenshot_annotations(
    session_id: UUID,
    screenshot_id: UUID,
    request: Request,
    annotations: str = Form(...),
    annotated_image: UploadFile = File(...),
    repo: Repository = Depends(repository),
) -> ScreenshotEvidence:
    """Replace a screenshot's annotation set with the user-edited/manual set.

    The supplied set becomes the authoritative annotations for the frame
    (overriding event-derived highlights). The Electron editor sends the final
    annotated PNG it rendered, so the backend stores the reviewed image without
    re-rendering it and risking renderer drift. The raw screenshot is preserved."""
    screenshot = repo.get_screenshot(session_id, screenshot_id)
    if screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")

    try:
        payload = ScreenshotAnnotationSet.model_validate(
            {"annotations": json.loads(annotations)}
        )
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="annotations must be valid JSON",
        ) from exc
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(),
        ) from exc

    if annotated_image.content_type != "image/png":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Annotated image must be image/png",
        )

    annotated_bytes = await annotated_image.read(settings.max_chunk_bytes + 1)
    if len(annotated_bytes) > settings.max_chunk_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Annotated image exceeds maximum size of {settings.max_chunk_bytes} bytes",
        )
    if not annotated_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Annotated image must be a PNG file",
        )

    normalized = [
        ScreenshotAnnotation(
            type=item.type,
            bounds=item.bounds,
            label=item.label,
            role=item.role,
            source=item.source,
            coordinate_space="screenshot_pixels",
            confidence=1.0,
        )
        for item in payload.annotations
    ]
    stored = [annotation.model_dump(mode="json") for annotation in normalized]
    repo.set_screenshot_annotations(screenshot_id, stored)

    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes,
    )
    try:
        annotated_key = f"{screenshot.storage_key.rsplit('.', 1)[0]}-annotated.png"
        annotated_path = storage.resolve_storage_key(annotated_key)
        annotated_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = annotated_path.with_suffix(".tmp")
        temporary.write_bytes(annotated_bytes)
        temporary.replace(annotated_path)
        repo.update_screenshot_annotation(screenshot_id, annotated_key, "redacted")
    except Exception as exc:
        repo.update_screenshot_annotation(screenshot_id, None, "failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save annotated image",
        ) from exc

    return screenshot_evidence(
        request,
        Screenshot(
            **{
                **screenshot.model_dump(),
                "annotated_storage_key": annotated_key,
                "redaction_status": "redacted",
                "annotations": stored,
            }
        ),
        normalized,
    )


@app.delete(
    "/sessions/{session_id}/screenshots/{screenshot_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["sessions"],
)
def delete_session_screenshot(
    session_id: UUID,
    screenshot_id: UUID,
    repo: Repository = Depends(repository),
) -> Response:
    require_session(repo, session_id)
    screenshot = repo.delete_screenshot(session_id, screenshot_id)
    if screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")

    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes,
    )
    storage.delete(screenshot.storage_key)
    if screenshot.annotated_storage_key:
        storage.delete(screenshot.annotated_storage_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/sessions/{session_id}/screenshots/{screenshot_id}", tags=["sessions"])
def get_session_screenshot_image(
    session_id: UUID,
    screenshot_id: UUID,
    request: Request,
    type: str | None = None,
    repo: Repository = Depends(repository),
) -> RedirectResponse:
    """Serve the raw screenshot bytes for overlay rendering or annotated bytes for SOP."""
    screenshot = repo.get_screenshot(session_id, screenshot_id)
    if screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")
    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes,
    )
    key_to_serve = (
        screenshot.annotated_storage_key
        if type == "annotated" and screenshot.annotated_storage_key
        else screenshot.storage_key
    )
    if not key_to_serve or not storage.exists(key_to_serve):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot image not available"
        )
    return RedirectResponse(
        signed_media_url(
            request,
            key_to_serve,
            "image/png" if type == "annotated" else screenshot.media_type,
        ),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@app.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["sessions"])
def delete_session(session_id: UUID, repo: Repository = Depends(repository)) -> Response:
    if not repo.delete_session(session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/sessions/{session_id}/ai-preview",
    response_model=ExternalAIPayloadPreview,
    tags=["sessions"],
)
def preview_external_ai(
    session_id: UUID, repo: Repository = Depends(repository)
) -> ExternalAIPayloadPreview:
    session = require_session(repo, session_id)
    return external_ai_preview(session, settings.ai_provider)


@app.post("/sessions/{session_id}/ai-approval", response_model=WorkflowSession, tags=["sessions"])
def set_external_ai_approval(
    session_id: UUID,
    payload: ExternalAIApprovalRequest,
    repo: Repository = Depends(repository),
) -> WorkflowSession:
    session = require_session(repo, session_id)
    preview = external_ai_preview(session, settings.ai_provider)
    if payload.payload_hash != preview.payload_hash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payload changed; review and approve the latest preview",
        )
    approved = repo.record_ai_approval(
        session_id, payload.actor, payload.payload_hash, payload.approved
    )
    if not approved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return approved


@app.get("/sops", response_model=list[SOP], tags=["sops"])
def list_sops(
    status_filter: SOPStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    repo: Repository = Depends(repository),
) -> list[SOP]:
    return repo.list_sops(
        status_filter.value if status_filter else None, limit, offset
    )


@app.get("/sops/{sop_id}", response_model=SOP, tags=["sops"])
def get_sop(sop_id: UUID, repo: Repository = Depends(repository)) -> SOP:
    sop = repo.get_sop(sop_id)
    if not sop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")
    return sop


@app.get("/walkthroughs/{sop_id}", response_model=SOP, tags=["walkthroughs"])
def get_walkthrough(sop_id: UUID, repo: Repository = Depends(repository)) -> SOP:
    sop = repo.get_sop(sop_id)
    if not sop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")
    if sop.status != SOPStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only approved SOPs can be published as walkthroughs",
        )
    return sop


@app.post("/sops/{sop_id}/approval", response_model=SOP, tags=["sops"])
def approve_sop(sop_id: UUID, payload: SOPApproval, repo: Repository = Depends(repository)) -> SOP:
    sop = repo.set_sop_status(sop_id, SOPStatus.APPROVED if payload.approved else SOPStatus.DRAFT)
    if not sop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")
    return sop


@app.post(
    "/feedback",
    response_model=Feedback,
    status_code=status.HTTP_201_CREATED,
    tags=["feedback"],
)
def create_feedback(payload: FeedbackCreate, repo: Repository = Depends(repository)) -> Feedback:
    require_session(repo, payload.session_id)
    if payload.sop_step_id and not repo.sop_step_belongs_to_session(
        payload.session_id, payload.sop_step_id
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SOP step does not belong to the feedback session",
        )
    return repo.save_feedback(classify_feedback(repo.tenant_id, payload))


@app.get("/exports/{session_id}", response_model=ExportBundle, tags=["exports"])
def export_session(session_id: UUID, repo: Repository = Depends(repository)) -> ExportBundle:
    session = require_session(repo, session_id)
    return ExportBundle(
        tenant_id=repo.tenant_id,
        session=session,
        sops=repo.list_sops_for_session(session_id),
        feedback=repo.list_feedback_for_session(session_id),
    )


@app.get("/analytics/{workflow_name}", response_model=AnalyticsSummary, tags=["analytics"])
def workflow_analytics(
    workflow_name: str,
    reference_session_id: UUID | None = None,
    repo: Repository = Depends(repository),
) -> AnalyticsSummary:
    sessions = repo.list_sessions(workflow_name, limit=500)
    if not sessions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return analyze_workflow(repo.tenant_id, workflow_name, sessions, reference_session_id)
