"""Add transcript to workflow_sessions

Revision ID: 11e9989421cf
Revises: 20260624_0001
Create Date: 2026-06-27 19:50:56.847070
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '11e9989421cf'
down_revision: str | None = '20260624_0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    existing_columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("workflow_sessions")
    }
    if "transcript" not in existing_columns:
        op.add_column("workflow_sessions", sa.Column("transcript", sa.JSON(), nullable=True))


def downgrade() -> None:
    existing_columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("workflow_sessions")
    }
    if "transcript" in existing_columns:
        op.drop_column("workflow_sessions", "transcript")
