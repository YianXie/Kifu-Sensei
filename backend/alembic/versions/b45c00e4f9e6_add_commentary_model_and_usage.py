"""add commentary model and usage

Revision ID: b45c00e4f9e6
Revises: 09675a91ba0d
Create Date: 2026-07-26 15:14:27.608863

Adds the Claude model name and the aggregated Anthropic token usage to each saved
commentary. Both are nullable so rows written before this revision keep NULL rather
than a fabricated model name or a zeroed token count that would read as real data.
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b45c00e4f9e6"
down_revision: str | Sequence[str] | None = "09675a91ba0d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # batch_alter_table so this also works on SQLite, which cannot ALTER a column in
    # place; it is a no-op wrapper on PostgreSQL.
    with op.batch_alter_table("commentaries", schema=None) as batch_op:
        batch_op.add_column(sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column("usage", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("commentaries", schema=None) as batch_op:
        batch_op.drop_column("usage")
        batch_op.drop_column("model")
