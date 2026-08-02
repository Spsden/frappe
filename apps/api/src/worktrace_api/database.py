from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.types import TypeDecorator

from worktrace_api.settings import get_settings


class Base(DeclarativeBase):
    pass


class EmbeddingVector(TypeDecorator):
    """Use pgvector in production while keeping the SQLite test suite portable."""

    impl = JSON
    cache_ok = True

    def __init__(self, dimensions: int = 1536):
        super().__init__()
        self.dimensions = dimensions

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(self.dimensions))
        return dialect.type_descriptor(JSON())


class TenantRecord:
    @declared_attr
    def tenant_id(cls) -> Mapped[str]:
        return mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)


class TenantAccountRecord(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class UserRecord(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(500))
    role: Mapped[str] = mapped_column(String(30), default="owner")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class AccessTokenRecord(Base):
    __tablename__ = "access_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class LLMProviderSettingsRecord(Base):
    __tablename__ = "llm_provider_settings"

    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    base_url: Mapped[str] = mapped_column(String(500))
    model: Mapped[str] = mapped_column(String(200))
    api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class SopLimitsSettingsRecord(Base):
    __tablename__ = "sop_limits_settings"

    # One row per tenant; NULL means "use the env default" for that field.
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    sop_max_evidence_steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sop_max_vision_frames: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sop_image_max_dimension_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sop_image_jpeg_quality: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sop_max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class WorkflowRecord(TenantRecord, Base):
    """A shared, reusable procedure such as "Expense Reimbursement".

    Many recordings (one execution by an employee) can belong to the same
    workflow. ``name`` is unique per tenant so duplicate procedures cannot be
    created accidentally — the save flow is expected to reuse an existing
    workflow by name rather than create a near-duplicate.
    """

    __tablename__ = "workflows"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_workflow_tenant_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class WorkflowSessionRecord(TenantRecord, Base):
    __tablename__ = "workflow_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    recording_id: Mapped[str | None] = mapped_column(
        ForeignKey("recordings.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_type: Mapped[str] = mapped_column(String(20), index=True)
    workflow_name: Mapped[str] = mapped_column(String(200), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    typed_text_consent: Mapped[bool] = mapped_column(Boolean)
    consent_actor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    consent_statement_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    external_ai_approved: Mapped[bool] = mapped_column(Boolean)
    external_ai_approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    external_ai_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer)
    transcript: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    events: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class SOPRecord(TenantRecord, Base):
    __tablename__ = "sops"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "source_session_id", "version", name="uq_sop_tenant_session_version"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_session_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(200))
    document: Mapped[str | None] = mapped_column(Text, nullable=True)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class AnalyticsRunRecord(TenantRecord, Base):
    __tablename__ = "analytics_runs"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "workflow_id", "version", name="uq_analytics_run_version"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    mode: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(40), index=True)
    input_count: Mapped[int] = mapped_column(Integer)
    embedding_model: Mapped[str] = mapped_column(String(200))
    algorithm_version: Mapped[str] = mapped_column(String(50))
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    executive_summary: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    failure_stage: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supersedes_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("analytics_runs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class AnalyticsRunInputRecord(TenantRecord, Base):
    __tablename__ = "analytics_run_inputs"
    __table_args__ = (
        UniqueConstraint("run_id", "position", name="uq_analytics_input_position"),
        UniqueConstraint("run_id", "recording_id", name="uq_analytics_input_recording"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("analytics_runs.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    recording_id: Mapped[str] = mapped_column(String(36), index=True)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    sop_id: Mapped[str] = mapped_column(String(36), index=True)
    sop_version: Mapped[int] = mapped_column(Integer)
    sop_content_hash: Mapped[str] = mapped_column(String(64))
    sop_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    recording_reference: Mapped[str | None] = mapped_column(String(300), nullable=True)
    recorded_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    recorded_by_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class SOPStepEmbeddingRecord(TenantRecord, Base):
    __tablename__ = "sop_step_embeddings"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "sop_id",
            "sop_step_id",
            "model",
            "content_hash",
            name="uq_sop_step_embedding_content",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sop_id: Mapped[str] = mapped_column(
        ForeignKey("sops.id", ondelete="CASCADE"), index=True
    )
    sop_step_id: Mapped[str] = mapped_column(String(36), index=True)
    model: Mapped[str] = mapped_column(String(200))
    dimensions: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    embedding: Mapped[list[float]] = mapped_column(EmbeddingVector(1536))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class FeedbackRecord(TenantRecord, Base):
    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="CASCADE"), index=True
    )
    sop_step_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    transcript: Mapped[str] = mapped_column(String(4000))
    classification: Mapped[str] = mapped_column(String(40), index=True)
    audio_reference: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class AIApprovalRecord(TenantRecord, Base):
    __tablename__ = "ai_approvals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="CASCADE"), index=True
    )
    actor: Mapped[str] = mapped_column(String(200))
    payload_hash: Mapped[str] = mapped_column(String(64))
    approved: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class RecordingRecord(TenantRecord, Base):
    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey(
            "workflow_sessions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_recordings_session_id",
        ),
        nullable=True,
        index=True,
    )
    workflow_id: Mapped[str | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(20), index=True)
    # Denormalised copy of the workflow name at capture time. The authoritative
    # link is ``workflow_id``; the name is kept on the row so list/status
    # queries and the processing pipeline can render a label without an extra
    # join, and so the processed WorkflowSession inherits a stable name.
    workflow_name: Mapped[str] = mapped_column(String(200), index=True)
    reference: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    recorded_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(50), index=True)
    expected_chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_bytes: Mapped[int] = mapped_column(Integer, default=0)
    has_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    manual_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    custom_sop_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RecordingChunkRecord(TenantRecord, Base):
    __tablename__ = "recording_chunks"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_recording_chunk_idempotency"),
    )

    recording_id: Mapped[str] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), primary_key=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    content_type: Mapped[str] = mapped_column(String(30), index=True)
    media_type: Mapped[str] = mapped_column(String(100))
    timestamp_start_ms: Mapped[int] = mapped_column(Integer)
    timestamp_end_ms: Mapped[int] = mapped_column(Integer)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(200))
    payload_size: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(500))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class ScreenshotRecord(TenantRecord, Base):
    __tablename__ = "screenshots"
    __table_args__ = (
        UniqueConstraint("tenant_id", "recording_id", "sequence", name="uq_screenshot_sequence"),
        UniqueConstraint("tenant_id", "recording_id", "content_hash", name="uq_screenshot_hash"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    recording_id: Mapped[str] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    storage_key: Mapped[str] = mapped_column(String(500))
    media_type: Mapped[str] = mapped_column(String(100), default="image/png")
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    change_score: Mapped[float] = mapped_column(Float)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    redaction_status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    annotated_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    annotations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine_options = {
    "connect_args": connect_args,
    "pool_pre_ping": True,
}
if settings.database_url.startswith("sqlite"):
    # SQLite is the local/dev database. A request burst can otherwise fill
    # QueuePool while FastAPI is still scheduling dependency cleanup, leaving
    # later requests waiting for a connection that is about to be returned.
    # Opening a short-lived SQLite connection per session avoids that deadlock.
    engine_options["poolclass"] = NullPool
engine = create_engine(settings.database_url, **engine_options)


if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)
