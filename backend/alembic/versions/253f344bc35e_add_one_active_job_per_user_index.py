"""add one-active-job-per-user partial unique index

Revision ID: 253f344bc35e
Revises: ec247765fb39
Create Date: 2026-08-01 00:00:00.000000

Enforces at most one queued/running ``commentary_jobs`` row per user at the database
level, so two near-simultaneous ``POST /api/commentary/jobs/`` requests cannot both
pass a check-then-insert race and both start a pipeline run. Finished jobs
(succeeded/failed) are excluded from the constraint.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "253f344bc35e"
down_revision: str | Sequence[str] | None = "ec247765fb39"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_WHERE = "status IN ('queued', 'running')"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        "ix_commentary_jobs_one_active_per_user",
        "commentary_jobs",
        ["user_id"],
        unique=True,
        sqlite_where=sa.text(_WHERE),
        postgresql_where=sa.text(_WHERE),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_commentary_jobs_one_active_per_user", table_name="commentary_jobs")
