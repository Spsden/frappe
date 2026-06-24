from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from worktrace_api.settings import get_settings


class Base(DeclarativeBase):
    pass


class TenantRecord:
    tenant_id: Mapped[str] = mapped_column(String(36), index=True)


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
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
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
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    source_type: Mapped[str] = mapped_column(String(20), index=True)
    workflow_name: Mapped[str] = mapped_column(String(200), index=True)
    status: Mapped[str] = mapped_column(String(50), index=True)
    expected_chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_bytes: Mapped[int] = mapped_column(Integer, default=0)
    has_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RecordingChunkRecord(TenantRecord, Base):
    __tablename__ = "recording_chunks"

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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)
