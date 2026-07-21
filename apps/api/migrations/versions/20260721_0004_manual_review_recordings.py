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
    bind = op.get_bind()
    existing_columns = {column["name"] for column in sa.inspect(bind).get_columns("recordings")}
    if "manual_mode" not in existing_columns:
        op.add_column(
            "recordings",
            sa.Column("manual_mode", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        if bind.dialect.name != "sqlite":
            op.alter_column("recordings", "manual_mode", server_default=None)
    if "custom_sop_instruction" not in existing_columns:
        op.add_column(
            "recordings",
            sa.Column("custom_sop_instruction", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    existing_columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("recordings")
    }
    if "custom_sop_instruction" in existing_columns:
        op.drop_column("recordings", "custom_sop_instruction")
    if "manual_mode" in existing_columns:
        op.drop_column("recordings", "manual_mode")
