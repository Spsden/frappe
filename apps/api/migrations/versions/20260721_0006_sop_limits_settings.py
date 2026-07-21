"""sop limits settings

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
    # Per-tenant overrides for the SOP generation guardrails. NULL means "use the
    # env default" for that field (see Settings.sop_*).
    op.create_table(
        "sop_limits_settings",
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("sop_max_evidence_steps", sa.Integer(), nullable=True),
        sa.Column("sop_max_vision_frames", sa.Integer(), nullable=True),
        sa.Column("sop_image_max_dimension_px", sa.Integer(), nullable=True),
        sa.Column("sop_image_jpeg_quality", sa.Integer(), nullable=True),
        sa.Column("sop_max_output_tokens", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tenant_id"),
    )


def downgrade() -> None:
    op.drop_table("sop_limits_settings")
