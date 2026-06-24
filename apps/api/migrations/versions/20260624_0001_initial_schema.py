"""initial schema

Revision ID: 20260624_0001
Revises:
Create Date: 2026-06-24 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260624_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    dialect = op.get_bind().dialect.name

    op.create_table(
        "tenants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    _create_recordings_table(include_session_fk=dialect == "sqlite")
    op.create_index("ix_recordings_session_id", "recordings", ["session_id"])
    op.create_index("ix_recordings_source_type", "recordings", ["source_type"])
    op.create_index("ix_recordings_status", "recordings", ["status"])
    op.create_index("ix_recordings_tenant_id", "recordings", ["tenant_id"])
    op.create_index("ix_recordings_workflow_name", "recordings", ["workflow_name"])

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=500), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])

    op.create_table(
        "access_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_access_tokens_expires_at", "access_tokens", ["expires_at"])
    op.create_index("ix_access_tokens_revoked_at", "access_tokens", ["revoked_at"])
    op.create_index("ix_access_tokens_tenant_id", "access_tokens", ["tenant_id"])
    op.create_index("ix_access_tokens_token_hash", "access_tokens", ["token_hash"], unique=True)
    op.create_index("ix_access_tokens_user_id", "access_tokens", ["user_id"])

    op.create_table(
        "recording_chunks",
        sa.Column("recording_id", sa.String(length=36), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=30), nullable=False),
        sa.Column("media_type", sa.String(length=100), nullable=False),
        sa.Column("timestamp_start_ms", sa.Integer(), nullable=False),
        sa.Column("timestamp_end_ms", sa.Integer(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False),
        sa.Column("payload_size", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["recording_id"], ["recordings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("recording_id", "chunk_index"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_recording_chunk_idempotency"),
    )
    op.create_index("ix_recording_chunks_content_type", "recording_chunks", ["content_type"])
    op.create_index("ix_recording_chunks_tenant_id", "recording_chunks", ["tenant_id"])

    op.create_table(
        "workflow_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("recording_id", sa.String(length=36), nullable=True),
        sa.Column("source_type", sa.String(length=20), nullable=False),
        sa.Column("workflow_name", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("typed_text_consent", sa.Boolean(), nullable=False),
        sa.Column("consent_actor", sa.String(length=200), nullable=True),
        sa.Column("consent_statement_version", sa.String(length=50), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("external_ai_approved", sa.Boolean(), nullable=False),
        sa.Column("external_ai_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("external_ai_payload_hash", sa.String(length=64), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("transcript", sa.JSON(), nullable=True),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["recording_id"], ["recordings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_sessions_recording_id", "workflow_sessions", ["recording_id"])
    op.create_index("ix_workflow_sessions_source_type", "workflow_sessions", ["source_type"])
    op.create_index("ix_workflow_sessions_status", "workflow_sessions", ["status"])
    op.create_index("ix_workflow_sessions_tenant_id", "workflow_sessions", ["tenant_id"])
    op.create_index("ix_workflow_sessions_workflow_name", "workflow_sessions", ["workflow_name"])

    if dialect != "sqlite":
        op.create_foreign_key(
            "fk_recordings_session_id",
            "recordings",
            "workflow_sessions",
            ["session_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_table(
        "ai_approvals",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("actor", sa.String(length=200), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("approved", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["workflow_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_approvals_session_id", "ai_approvals", ["session_id"])
    op.create_index("ix_ai_approvals_tenant_id", "ai_approvals", ["tenant_id"])

    op.create_table(
        "feedback",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("sop_step_id", sa.String(length=36), nullable=True),
        sa.Column("transcript", sa.String(length=4000), nullable=False),
        sa.Column("classification", sa.String(length=40), nullable=False),
        sa.Column("audio_reference", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["workflow_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feedback_classification", "feedback", ["classification"])
    op.create_index("ix_feedback_session_id", "feedback", ["session_id"])
    op.create_index("ix_feedback_tenant_id", "feedback", ["tenant_id"])

    op.create_table(
        "screenshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("recording_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("media_type", sa.String(length=100), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("change_score", sa.Float(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("redaction_status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["recording_id"], ["recordings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["workflow_sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "recording_id", "content_hash", name="uq_screenshot_hash"),
        sa.UniqueConstraint("tenant_id", "recording_id", "sequence", name="uq_screenshot_sequence"),
    )
    op.create_index("ix_screenshots_content_hash", "screenshots", ["content_hash"])
    op.create_index("ix_screenshots_recording_id", "screenshots", ["recording_id"])
    op.create_index("ix_screenshots_redaction_status", "screenshots", ["redaction_status"])
    op.create_index("ix_screenshots_session_id", "screenshots", ["session_id"])
    op.create_index("ix_screenshots_tenant_id", "screenshots", ["tenant_id"])

    op.create_table(
        "sops",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_session_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_session_id"], ["workflow_sessions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id",
            "source_session_id",
            "version",
            name="uq_sop_tenant_session_version",
        ),
    )
    op.create_index("ix_sops_source_session_id", "sops", ["source_session_id"])
    op.create_index("ix_sops_status", "sops", ["status"])
    op.create_index("ix_sops_tenant_id", "sops", ["tenant_id"])


def downgrade() -> None:
    dialect = op.get_bind().dialect.name

    if dialect == "sqlite":
        op.execute("PRAGMA foreign_keys=OFF")
    else:
        op.drop_constraint("fk_recordings_session_id", "recordings", type_="foreignkey")

    op.drop_table("sops")
    op.drop_table("screenshots")
    op.drop_table("feedback")
    op.drop_table("ai_approvals")
    op.drop_table("workflow_sessions")
    op.drop_table("recording_chunks")
    op.drop_table("access_tokens")
    op.drop_table("users")
    op.drop_table("recordings")
    op.drop_table("tenants")


def _create_recordings_table(*, include_session_fk: bool) -> None:
    constraints: list[sa.Constraint] = [
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    ]
    if include_session_fk:
        constraints.insert(
            0,
            sa.ForeignKeyConstraint(
                ["session_id"],
                ["workflow_sessions.id"],
                name="fk_recordings_session_id",
                ondelete="SET NULL",
            ),
        )

    op.create_table(
        "recordings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("source_type", sa.String(length=20), nullable=False),
        sa.Column("workflow_name", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("expected_chunk_count", sa.Integer(), nullable=True),
        sa.Column("uploaded_chunk_count", sa.Integer(), nullable=False),
        sa.Column("uploaded_bytes", sa.Integer(), nullable=False),
        sa.Column("has_audio", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        *constraints,
    )
