"""add commentaries.user_id foreign key and index

Revision ID: ec247765fb39
Revises: ba4d65f3c049
Create Date: 2026-08-01 00:00:00.000000

``Commentary.user_id`` was declared as ``Field(ForeignKey("users.id"))`` — passing the
``ForeignKey`` object as ``Field``'s first positional argument, ``default``, rather than
as the ``foreign_key`` keyword. The column has always been a plain, unindexed integer:
no constraint was ever created, and every history read full-scans the table. This adds
both, matching what ``commentary_jobs.user_id`` already has.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ec247765fb39"
down_revision: str | Sequence[str] | None = "ba4d65f3c049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("commentaries", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_commentaries_user_id"), ["user_id"], unique=False)
        batch_op.create_foreign_key("fk_commentaries_user_id_users", "users", ["user_id"], ["id"])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("commentaries", schema=None) as batch_op:
        batch_op.drop_constraint("fk_commentaries_user_id_users", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_commentaries_user_id"))
