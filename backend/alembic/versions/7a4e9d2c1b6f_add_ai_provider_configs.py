"""add provider-neutral AI configurations

The table is introduced before the settings endpoint switches to it.  Existing
Claude ciphertext is copied without decryption; the legacy column remains in
place until a later cleanup migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7a4e9d2c1b6f"
down_revision: str | Sequence[str] | None = "ec247765fb39"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_provider_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("encrypted_api_key", sa.String(), nullable=True),
        sa.Column("base_url", sa.String(), nullable=True),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_provider_configs_user_id", "ai_provider_configs", ["user_id"], unique=True
    )
    op.execute(
        sa.text(
            """
            INSERT INTO ai_provider_configs
                (user_id, provider, encrypted_api_key, base_url, model, created_at, updated_at)
            SELECT id, 'claude', claude_api, NULL, 'claude-sonnet-5',
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM users
            WHERE claude_api IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_ai_provider_configs_user_id", table_name="ai_provider_configs")
    op.drop_table("ai_provider_configs")
