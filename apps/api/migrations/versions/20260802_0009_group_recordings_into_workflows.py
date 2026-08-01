"""group existing recordings into workflows

Revision ID: 20260802_0009
Revises: 20260802_0008
Create Date: 2026-08-02 00:00:01.000000
"""

from collections.abc import Sequence

from alembic import op

from worktrace_api.backfill import group_recordings_into_workflows

revision: str = "20260802_0009"
down_revision: str | None = "20260802_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing recordings (which only carried a free-text ``workflow_name``)
    # are folded under one workflow per (tenant, workflow_name). The actual
    # logic lives in worktrace_api.backfill so it can be tested directly.
    group_recordings_into_workflows(op.get_bind())


def downgrade() -> None:
    # Reverse the links but keep the workflows created from real data — dropping
    # them would silently lose the grouping a tenant already relies on.
    from sqlalchemy import text

    op.get_bind().execute(text("UPDATE recordings SET workflow_id = NULL"))
