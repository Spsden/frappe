"""sop document

Revision ID: 20260721_0005
Revises: 20260721_0004
Create Date: 2026-07-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260721_0005"
down_revision: str | None = "20260721_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Optional supporting narrative for an SOP draft (purpose / overview).
    # Stored on the single SOP row so we never need a fake "full document"
    # version again.
    existing_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("sops")}
    if "document" not in existing_columns:
        op.add_column(
            "sops",
            sa.Column("document", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    existing_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("sops")}
    if "document" in existing_columns:
        op.drop_column("sops", "document")
