"""workflows

Revision ID: 20260802_0008
Revises: 20260721_0007
Create Date: 2026-08-02 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260802_0008"
down_revision: str | None = "20260721_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "workflows" not in existing_tables:
        op.create_table(
            "workflows",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tenant_id", "name", name="uq_workflow_tenant_name"
            ),
        )
        op.create_index("ix_workflows_tenant_id", "workflows", ["tenant_id"])
        op.create_index("ix_workflows_name", "workflows", ["name"])
        op.create_index("ix_workflows_created_by", "workflows", ["created_by"])

    recording_columns = {column["name"] for column in inspector.get_columns("recordings")}
    if "workflow_id" not in recording_columns:
        op.add_column(
            "recordings",
            sa.Column(
                "workflow_id",
                sa.String(length=36),
                sa.ForeignKey("workflows.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_recordings_workflow_id", "recordings", ["workflow_id"])
    if "reference" not in recording_columns:
        op.add_column(
            "recordings",
            sa.Column("reference", sa.String(length=300), nullable=True),
        )
        op.create_index("ix_recordings_reference", "recordings", ["reference"])
    if "recorded_by" not in recording_columns:
        op.add_column(
            "recordings",
            sa.Column(
                "recorded_by",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_recordings_recorded_by", "recordings", ["recorded_by"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    recording_columns = {column["name"] for column in inspector.get_columns("recordings")}
    if "recorded_by" in recording_columns:
        op.drop_index("ix_recordings_recorded_by", table_name="recordings")
        op.drop_column("recordings", "recorded_by")
    if "reference" in recording_columns:
        op.drop_index("ix_recordings_reference", table_name="recordings")
        op.drop_column("recordings", "reference")
    if "workflow_id" in recording_columns:
        op.drop_index("ix_recordings_workflow_id", table_name="recordings")
        op.drop_column("recordings", "workflow_id")

    existing_tables = set(inspector.get_table_names())
    if "workflows" in existing_tables:
        op.drop_index("ix_workflows_created_by", table_name="workflows")
        op.drop_index("ix_workflows_name", table_name="workflows")
        op.drop_index("ix_workflows_tenant_id", table_name="workflows")
        op.drop_table("workflows")
