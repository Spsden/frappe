"""analytics run modes

Renames the original analytics run mode value ``recording_comparison`` to the
explicit ``selected_comparison`` so it reads cleanly next to the new
``workforce`` population-overview mode. No schema change is required: ``mode``
is already a free-form string column, and result/snapshot JSON is self-describing.

Revision ID: 20260803_0012
Revises: 20260803_0011
Create Date: 2026-08-03 02:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260803_0012"
down_revision: str | None = "20260803_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE analytics_runs SET mode = 'selected_comparison' "
        "WHERE mode = 'recording_comparison'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE analytics_runs SET mode = 'recording_comparison' "
        "WHERE mode = 'selected_comparison'"
    )
