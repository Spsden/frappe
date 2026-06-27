"""screenshot annotation key

Revision ID: 20260627_0002
Revises: 20260624_0001
Create Date: 2026-06-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260627_0002"
down_revision: str | None = "11e9989421cf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "screenshots",
        sa.Column("annotated_storage_key", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("screenshots", "annotated_storage_key")
