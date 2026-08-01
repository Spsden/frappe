"""Backfill helper that folds legacy recordings under per-name workflows.

Extracted from the alembic migration so it can be exercised directly by tests
(alembic's ``op`` thread-local proxy is awkward to drive outside a real
migration run). The migration imports and calls this with ``op.get_bind()``;
tests call it with a plain SQLAlchemy connection.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import text


def group_recordings_into_workflows(bind) -> None:
    """Link every recording that still has a ``workflow_name`` but no
    ``workflow_id`` to one workflow per ``(tenant_id, workflow_name)``.

    Recordings are never deleted. When a workflow of the same name already
    exists it is reused, so duplicate names collapse into a single workflow
    rather than producing near-duplicates.
    """
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
                    "SELECT id FROM users WHERE tenant_id = :t "
                    "ORDER BY created_at LIMIT 1"
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
