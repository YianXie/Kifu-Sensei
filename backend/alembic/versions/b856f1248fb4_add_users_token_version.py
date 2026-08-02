"""add users.token_version

Revision ID: b856f1248fb4
Revises: 253f344bc35e
Create Date: 2026-08-02 00:00:00.000000

Backs server-side token revocation: stamped into every JWT and checked on every use
(``app.deps.get_current_user``, ``app.routers.auth.token_refresh``), bumped on password
change and on the new ``POST /auth/logout/``. A token minted before this column existed
carries no ``token_version`` claim at all and is rejected outright rather than treated
as a match, so deploying this once logs every existing session out — a one-time cost,
not a recurring one.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b856f1248fb4"
down_revision: str | Sequence[str] | None = "253f344bc35e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("token_version", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("token_version")
