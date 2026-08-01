"""versioned workflow analytics

Revision ID: 20260802_0010
Revises: 20260802_0009
Create Date: 2026-08-02 01:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "20260802_0010"
down_revision: str | None = "20260802_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        embedding_type = Vector(1536)
    else:
        embedding_type = sa.JSON()

    op.create_table(
        "analytics_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("input_count", sa.Integer(), nullable=False),
        sa.Column("embedding_model", sa.String(length=200), nullable=False),
        sa.Column("algorithm_version", sa.String(length=50), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("executive_summary", sa.JSON(), nullable=True),
        sa.Column("failure_stage", sa.String(length=40), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("supersedes_run_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["supersedes_run_id"], ["analytics_runs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "workflow_id", "version", name="uq_analytics_run_version"
        ),
    )
    op.create_index("ix_analytics_runs_created_by", "analytics_runs", ["created_by"])
    op.create_index("ix_analytics_runs_mode", "analytics_runs", ["mode"])
    op.create_index("ix_analytics_runs_status", "analytics_runs", ["status"])
    op.create_index("ix_analytics_runs_tenant_id", "analytics_runs", ["tenant_id"])
    op.create_index("ix_analytics_runs_workflow_id", "analytics_runs", ["workflow_id"])

    op.create_table(
        "analytics_run_inputs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("recording_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("sop_id", sa.String(length=36), nullable=False),
        sa.Column("sop_version", sa.Integer(), nullable=False),
        sa.Column("sop_content_hash", sa.String(length=64), nullable=False),
        sa.Column("sop_snapshot", sa.JSON(), nullable=False),
        sa.Column("recording_reference", sa.String(length=300), nullable=True),
        sa.Column("recorded_by", sa.String(length=36), nullable=True),
        sa.Column("recorded_by_email", sa.String(length=320), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["analytics_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "position", name="uq_analytics_input_position"),
        sa.UniqueConstraint("run_id", "recording_id", name="uq_analytics_input_recording"),
    )
    for column in ("recording_id", "run_id", "session_id", "sop_id", "tenant_id"):
        op.create_index(
            f"ix_analytics_run_inputs_{column}", "analytics_run_inputs", [column]
        )

    op.create_table(
        "sop_step_embeddings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("sop_id", sa.String(length=36), nullable=False),
        sa.Column("sop_step_id", sa.String(length=36), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("embedding", embedding_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["sop_id"], ["sops.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id",
            "sop_id",
            "sop_step_id",
            "model",
            "content_hash",
            name="uq_sop_step_embedding_content",
        ),
    )
    for column in ("content_hash", "sop_id", "sop_step_id", "tenant_id"):
        op.create_index(
            f"ix_sop_step_embeddings_{column}", "sop_step_embeddings", [column]
        )


def downgrade() -> None:
    op.drop_table("sop_step_embeddings")
    op.drop_table("analytics_run_inputs")
    op.drop_table("analytics_runs")
