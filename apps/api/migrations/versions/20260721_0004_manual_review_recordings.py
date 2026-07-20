"""manual review recordings

Revision ID: 20260721_0004
Revises: 20260716_0003
Create Date: 2026-07-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260721_0004"
down_revision: str | None = "20260716_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recordings",
        sa.Column("manual_mode", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "recordings",
        sa.Column("custom_sop_instruction", sa.Text(), nullable=True),
    )
    op.alter_column("recordings", "manual_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("recordings", "custom_sop_instruction")
    op.drop_column("recordings", "manual_mode")
