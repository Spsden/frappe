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
            sa.UniqueConstraint("tenant_id", "name", name="uq_workflow_tenant_name"),
        )
        op.create_index("ix_workflows_tenant_id", "workflows", ["tenant_id"])
        op.create_index("ix_workflows_name", "workflows", ["name"])
        op.create_index("ix_workflows_created_by", "workflows", ["created_by"])

    # ``recordings`` gains three columns. Two of them carry foreign keys, and
    # SQLite cannot ``ALTER TABLE ... ADD COLUMN`` with an inline FK constraint,
    # so the additions go through batch mode (a cheap native ``ALTER`` on
    # Postgres and a copy-and-move table rebuild on SQLite).
    recording_columns = {column["name"] for column in inspector.get_columns("recordings")}
    with op.batch_alter_table("recordings", schema=None) as batch_op:
        if "workflow_id" not in recording_columns:
            batch_op.add_column(
                sa.Column(
                    "workflow_id",
                    sa.String(length=36),
                    sa.ForeignKey(
                        "workflows.id",
                        ondelete="SET NULL",
                        name="fk_recordings_workflow_id",
                    ),
                    nullable=True,
                )
            )
        if "reference" not in recording_columns:
            batch_op.add_column(sa.Column("reference", sa.String(length=300), nullable=True))
        if "recorded_by" not in recording_columns:
            batch_op.add_column(
                sa.Column(
                    "recorded_by",
                    sa.String(length=36),
                    sa.ForeignKey(
                        "users.id",
                        ondelete="SET NULL",
                        name="fk_recordings_recorded_by",
                    ),
                    nullable=True,
                )
            )

    # Indexes are created outside batch mode so the column-existence guards
    # above remain the single source of truth for idempotency.
    final_recording_columns = {
        column["name"] for column in sa.inspect(bind).get_columns("recordings")
    }
    existing_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("recordings")}
    if "workflow_id" in final_recording_columns and "ix_recordings_workflow_id" not in existing_indexes:
        op.create_index("ix_recordings_workflow_id", "recordings", ["workflow_id"])
    if "reference" in final_recording_columns and "ix_recordings_reference" not in existing_indexes:
        op.create_index("ix_recordings_reference", "recordings", ["reference"])
    if "recorded_by" in final_recording_columns and "ix_recordings_recorded_by" not in existing_indexes:
        op.create_index("ix_recordings_recorded_by", "recordings", ["recorded_by"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_indexes = {index["name"] for index in inspector.get_indexes("recordings")}
    if "ix_recordings_recorded_by" in existing_indexes:
        op.drop_index("ix_recordings_recorded_by", table_name="recordings")
    if "ix_recordings_reference" in existing_indexes:
        op.drop_index("ix_recordings_reference", table_name="recordings")
    if "ix_recordings_workflow_id" in existing_indexes:
        op.drop_index("ix_recordings_workflow_id", table_name="recordings")

    recording_columns = {column["name"] for column in inspector.get_columns("recordings")}
    if {"workflow_id", "reference", "recorded_by"} & recording_columns:
        with op.batch_alter_table("recordings", schema=None) as batch_op:
            if "recorded_by" in recording_columns:
                batch_op.drop_column("recorded_by")
            if "reference" in recording_columns:
                batch_op.drop_column("reference")
            if "workflow_id" in recording_columns:
                batch_op.drop_column("workflow_id")

    existing_tables = set(inspector.get_table_names())
    if "workflows" in existing_tables:
        op.drop_index("ix_workflows_created_by", table_name="workflows")
        op.drop_index("ix_workflows_name", table_name="workflows")
        op.drop_index("ix_workflows_tenant_id", table_name="workflows")
        op.drop_table("workflows")
