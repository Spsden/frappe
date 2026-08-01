"""group existing recordings into workflows

Revision ID: 20260802_0009
Revises: 20260802_0008
Create Date: 2026-08-02 00:00:01.000000
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

from alembic import op
from sqlalchemy import text

revision: str = "20260802_0009"
down_revision: str | None = "20260802_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Backfill: fold existing recordings under one workflow per
    (tenant, workflow_name). Existing recordings are never deleted — each is
    linked to a freshly created workflow, reusing a workflow of the same name
    when one already exists (so duplicate names collapse cleanly)."""
    bind = op.get_bind()

    groups = bind.execute(
        text(
            "SELECT tenant_id, workflow_name FROM recordings "
            "WHERE workflow_id IS NULL "
            "  AND workflow_name IS NOT NULL "
            "  AND workflow_name <> '' "
            "GROUP BY tenant_id, workflow_name"
        )
    ).fetchall()

    if not groups:
        return

    for tenant_id, workflow_name in groups:
        existing = bind.execute(
            text("SELECT id FROM workflows WHERE tenant_id = :t AND name = :n"),
            {"t": tenant_id, "n": workflow_name},
        ).fetchone()

        if existing:
            workflow_id = existing[0]
        else:
            user_row = bind.execute(
                text(
                    "SELECT id FROM users WHERE tenant_id = :t ORDER BY created_at LIMIT 1"
                ),
                {"t": tenant_id},
            ).fetchone()
            workflow_id = str(uuid4())
            now = datetime.now(UTC)
            bind.execute(
                text(
                    "INSERT INTO workflows "
                    "(id, tenant_id, name, description, created_by, created_at, updated_at) "
                    "VALUES (:id, :t, :n, NULL, :u, :c, :c)"
                ),
                {
                    "id": workflow_id,
                    "t": tenant_id,
                    "n": workflow_name,
                    "u": user_row[0] if user_row else None,
                    "c": now,
                },
            )

        bind.execute(
            text(
                "UPDATE recordings SET workflow_id = :w "
                "WHERE tenant_id = :t AND workflow_name = :n AND workflow_id IS NULL"
            ),
            {"w": workflow_id, "t": tenant_id, "n": workflow_name},
        )


def downgrade() -> None:
    # Reverse the links but keep the workflows table and rows (the forward
    # migration created them from real data, so dropping them would lose work).
    op.get_bind().execute(text("UPDATE recordings SET workflow_id = NULL"))
