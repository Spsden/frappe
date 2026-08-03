"""editable SOP drafts and revision history

Revision ID: 20260803_0013
Revises: 20260803_0012
Create Date: 2026-08-03 06:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_0013"
down_revision: str | None = "20260803_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("sops")}
    with op.batch_alter_table("sops") as batch:
        if "parent_sop_id" not in columns:
            batch.add_column(sa.Column("parent_sop_id", sa.String(36), nullable=True))
            batch.create_foreign_key(
                "fk_sops_parent_sop_id", "sops", ["parent_sop_id"], ["id"], ondelete="SET NULL"
            )
        if "revision" not in columns:
            batch.add_column(
                sa.Column("revision", sa.Integer(), nullable=False, server_default="1")
            )
        if "updated_at" not in columns:
            batch.add_column(
                sa.Column(
                    "updated_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.func.now(),
                )
            )
        if "edited_by" not in columns:
            batch.add_column(sa.Column("edited_by", sa.String(36), nullable=True))
            batch.create_foreign_key(
                "fk_sops_edited_by", "users", ["edited_by"], ["id"], ondelete="SET NULL"
            )

    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("sops")}
    if "ix_sops_parent_sop_id" not in indexes:
        op.create_index("ix_sops_parent_sop_id", "sops", ["parent_sop_id"])

    if "sop_revisions" not in inspector.get_table_names():
        op.create_table(
            "sop_revisions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("sop_id", sa.String(36), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("snapshot_json", sa.JSON(), nullable=False),
            sa.Column("edited_by", sa.String(36), nullable=True),
            sa.Column("change_summary", sa.String(500), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["sop_id"], ["sops.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["edited_by"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("tenant_id", "sop_id", "revision", name="uq_sop_revision"),
        )
        op.create_index("ix_sop_revisions_tenant_id", "sop_revisions", ["tenant_id"])
        op.create_index("ix_sop_revisions_sop_id", "sop_revisions", ["sop_id"])


def downgrade() -> None:
    op.drop_table("sop_revisions")
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("sops")}
    if "ix_sops_parent_sop_id" in indexes:
        op.drop_index("ix_sops_parent_sop_id", table_name="sops")
    with op.batch_alter_table("sops") as batch:
        batch.drop_constraint("fk_sops_edited_by", type_="foreignkey")
        batch.drop_constraint("fk_sops_parent_sop_id", type_="foreignkey")
        batch.drop_column("edited_by")
        batch.drop_column("updated_at")
        batch.drop_column("revision")
        batch.drop_column("parent_sop_id")
