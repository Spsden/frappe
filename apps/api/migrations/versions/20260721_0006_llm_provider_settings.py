"""llm provider settings

Revision ID: 20260721_0006
Revises: 20260721_0005
Create Date: 2026-07-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260721_0006"
down_revision: str | None = "20260721_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    existing_tables = sa.inspect(op.get_bind()).get_table_names()
    if "llm_provider_settings" in existing_tables:
        return
    op.create_table(
        "llm_provider_settings",
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tenant_id"),
    )


def downgrade() -> None:
    existing_tables = sa.inspect(op.get_bind()).get_table_names()
    if "llm_provider_settings" in existing_tables:
        op.drop_table("llm_provider_settings")
