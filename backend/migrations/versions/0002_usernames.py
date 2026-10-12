"""Add optional unique usernames while preserving existing email-only accounts."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("username", sa.String(32), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade():
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
