"""user-triggered screenshot redaction

Revision ID: 20260803_0011
Revises: 20260802_0010
Create Date: 2026-08-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_0011"
down_revision: str | None = "20260802_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    screenshot_columns = {
        column["name"] for column in inspector.get_columns("screenshots")
    }
    additions = (
        (
            "privacy_redaction_status",
            sa.Column(
                "privacy_redaction_status",
                sa.String(length=30),
                nullable=False,
                server_default="not_run",
            ),
        ),
        (
            "privacy_redaction_count",
            sa.Column(
                "privacy_redaction_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        ),
        (
            "privacy_redaction_version",
            sa.Column(
                "privacy_redaction_version",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        ),
        (
            "privacy_redacted_storage_key",
            sa.Column("privacy_redacted_storage_key", sa.String(length=500), nullable=True),
        ),
    )
    for name, column in additions:
        if name not in screenshot_columns:
            op.add_column("screenshots", column)

    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("screenshots")}
    if "ix_screenshots_privacy_redaction_status" not in indexes:
        op.create_index(
            "ix_screenshots_privacy_redaction_status",
            "screenshots",
            ["privacy_redaction_status"],
        )

    if "redaction_runs" not in inspector.get_table_names():
        op.create_table(
            "redaction_runs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("recording_id", sa.String(length=36), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("total_screenshots", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("processed_screenshots", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("redacted_screenshots", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("redaction_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failed_screenshots", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("detector_mode", sa.String(length=30), nullable=True),
            sa.Column("warning_message", sa.String(length=500), nullable=True),
            sa.Column("error_message", sa.String(length=1000), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.ForeignKeyConstraint(["recording_id"], ["recordings.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tenant_id", "recording_id", "version", name="uq_redaction_run_version"
            ),
        )
        op.create_index("ix_redaction_runs_recording_id", "redaction_runs", ["recording_id"])
        op.create_index("ix_redaction_runs_status", "redaction_runs", ["status"])
        op.create_index("ix_redaction_runs_tenant_id", "redaction_runs", ["tenant_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "redaction_runs" in inspector.get_table_names():
        op.drop_table("redaction_runs")

    screenshot_columns = {
        column["name"] for column in sa.inspect(bind).get_columns("screenshots")
    }
    for column in (
        "privacy_redacted_storage_key",
        "privacy_redaction_version",
        "privacy_redaction_count",
        "privacy_redaction_status",
    ):
        if column in screenshot_columns:
            op.drop_column("screenshots", column)
