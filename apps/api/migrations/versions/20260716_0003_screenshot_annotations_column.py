"""screenshot annotations column

Revision ID: 20260716_0003
Revises: 20260627_0002
Create Date: 2026-07-16 00:00:00.000000

Adds an authoritative per-screenshot annotation set. When present (non-null),
it overrides the annotations derived from recorded input events, powering the
evidence editor (manual drag edits, global offset, manual draw mode).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260716_0003"
down_revision: str | None = "20260627_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    existing_columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("screenshots")
    }
    if "annotations" not in existing_columns:
        op.add_column(
            "screenshots",
            sa.Column("annotations", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    existing_columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("screenshots")
    }
    if "annotations" in existing_columns:
        op.drop_column("screenshots", "annotations")
