import json
from collections.abc import Generator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
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
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
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
from worktrace_api.privacy import sanitize_session
from worktrace_api.processing import RecordingProcessor
from worktrace_api.recordings import ChunkStorage
from worktrace_api.repository import Repository, get_db
from worktrace_api.schemas import (
    SOP,
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
    LoginRequest,
    Recording,
    RecordingComplete,
    RecordingCreate,
    RecordingStatus,
    RecordingStatusResponse,
    SignUpRequest,
    SOPApproval,
    SOPStatus,
    WorkflowSession,
    WorkflowSessionCreate,
)
from worktrace_api.services import (
    analyze_workflow,
    classify_feedback,
    external_ai_preview,
    generate_sop,
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
    RecordingStatus.GENERATING_SOP,
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
    db: Session = Depends(get_db),
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
    auth: AuthContext = Depends(authenticated_account), db: Session = Depends(get_db)
) -> Generator[Repository, None, None]:
    yield Repository(db, auth.account.tenant_id)


def require_session(repo: Repository, session_id: UUID) -> WorkflowSession:
    session = repo.get_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.env}


@app.post(
    "/auth/signup",
    response_model=AuthSession,
    status_code=status.HTTP_201_CREATED,
    tags=["auth"],
)
def signup(payload: SignUpRequest, db: Session = Depends(get_db)) -> AuthSession:
    try:
        return sign_up(db, payload, settings.access_token_ttl_hours)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.post("/auth/login", response_model=AuthSession, tags=["auth"])
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthSession:
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
    auth: AuthContext = Depends(authenticated_account), db: Session = Depends(get_db)
) -> Response:
    log_out(db, auth.access_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/recordings",
    response_model=Recording,
    status_code=status.HTTP_201_CREATED,
    tags=["recordings"],
)
def create_recording(payload: RecordingCreate, repo: Repository = Depends(repository)) -> Recording:
    return repo.create_recording(payload.workflow_name, payload.source_type, payload.has_audio)


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
    missing_chunks = [
        chunk.storage_key
        for chunk in repo.list_recording_chunks(recording_id)
        if not chunk_storage.exists(chunk.storage_key)
    ]
    if missing_chunks:
        recording = repo.set_recording_status(
            recording_id,
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


@app.post(
    "/sessions/{session_id}/sops",
    response_model=SOP,
    status_code=status.HTTP_201_CREATED,
    tags=["sops"],
)
def create_sop(session_id: UUID, repo: Repository = Depends(repository)) -> SOP:
    session = require_session(repo, session_id)
    try:
        return repo.save_sop(generate_sop(session, repo.next_sop_version(session_id)))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


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
