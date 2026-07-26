"""add commentary jobs

Revision ID: ba4d65f3c049
Revises: b45c00e4f9e6
Create Date: 2026-07-26 15:26:45.928280

Backs the async commentary endpoints. A Manifest V3 extension service worker is killed
when a single fetch takes over 30 seconds, so the browser submits a job and polls it
instead of holding the multi-minute request open.
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ba4d65f3c049"
down_revision: str | Sequence[str] | None = "b45c00e4f9e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "commentary_jobs",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("progress_done", sa.Integer(), nullable=False),
        sa.Column("progress_total", sa.Integer(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error_code", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("error_detail", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("retry_after", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("commentary_jobs", schema=None) as batch_op:
        # user_id backs both the ownership check on every poll and retention pruning;
        # created_at backs the pruning cutoff; status backs operational queries.
        batch_op.create_index(
            batch_op.f("ix_commentary_jobs_created_at"), ["created_at"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_commentary_jobs_status"), ["status"], unique=False)
        batch_op.create_index(batch_op.f("ix_commentary_jobs_user_id"), ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("commentary_jobs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_commentary_jobs_user_id"))
        batch_op.drop_index(batch_op.f("ix_commentary_jobs_status"))
        batch_op.drop_index(batch_op.f("ix_commentary_jobs_created_at"))

    op.drop_table("commentary_jobs")
