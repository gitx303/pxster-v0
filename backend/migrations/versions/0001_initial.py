"""Initial workspace, media, publishing, and authentication records."""
from alembic import op
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint

revision = "0001"
down_revision = None
branch_labels = depends_on = None


def upgrade():
    op.create_table("users", Column("id", String(36), primary_key=True), Column("email", String(254), nullable=False, unique=True), Column("password_hash", Text, nullable=False), Column("created_at", DateTime(timezone=True), nullable=False))
    op.create_table("login_sessions", Column("token_hash", String(64), primary_key=True), Column("user_id", String(36), ForeignKey("users.id"), nullable=False), Column("expires_at", DateTime(timezone=True), nullable=False))
    op.create_table("oauth_states", Column("state_hash", String(64), primary_key=True), Column("owner_id", String(36), ForeignKey("users.id"), nullable=False), Column("platform", String(40), nullable=False), Column("expires_at", DateTime(timezone=True), nullable=False))
    op.create_table("connected_accounts", Column("id", String(36), primary_key=True), Column("owner_id", String(36), ForeignKey("users.id"), nullable=False), Column("platform", String(40), nullable=False), Column("platform_account_id", String(255), nullable=False), Column("display_name", String(255), nullable=False), Column("permissions", JSON, nullable=False), Column("encrypted_tokens", Text), Column("expires_at", DateTime(timezone=True)), Column("status", String(30), nullable=False), UniqueConstraint("owner_id", "platform", "platform_account_id"))
    op.create_table("media_assets", Column("id", String(36), primary_key=True), Column("owner_id", String(36), ForeignKey("users.id"), nullable=False), Column("object_key", Text, nullable=False, unique=True), Column("filename", String(255), nullable=False), Column("content_type", String(80), nullable=False), Column("size", Integer, nullable=False), Column("validation", JSON, nullable=False), Column("created_at", DateTime(timezone=True), nullable=False))
    op.create_table("posts", Column("id", String(36), primary_key=True), Column("owner_id", String(36), ForeignKey("users.id"), nullable=False), Column("caption", Text, nullable=False), Column("media_id", String(36), ForeignKey("media_assets.id"), nullable=False), Column("scheduled_at", DateTime(timezone=True), nullable=False), Column("state", String(30), nullable=False), Column("idempotency_key", String(100), nullable=False), Column("request_hash", String(64), nullable=False), Column("options", JSON, nullable=False), Column("created_at", DateTime(timezone=True), nullable=False), UniqueConstraint("owner_id", "idempotency_key"))
    op.create_table("post_destinations", Column("id", String(36), primary_key=True), Column("post_id", String(36), ForeignKey("posts.id"), nullable=False), Column("account_id", String(36), ForeignKey("connected_accounts.id"), nullable=False), Column("state", String(30), nullable=False), Column("next_attempt_at", DateTime(timezone=True), nullable=False), Column("lease_until", DateTime(timezone=True)), Column("attempt_count", Integer, nullable=False), Column("platform_post_id", String(255)), Column("provider_job_id", String(255)), Column("last_error", Text), UniqueConstraint("post_id", "account_id"))
    op.create_table("publish_attempts", Column("id", String(36), primary_key=True), Column("destination_id", String(36), ForeignKey("post_destinations.id"), nullable=False), Column("attempted_at", DateTime(timezone=True), nullable=False), Column("finished_at", DateTime(timezone=True)), Column("state", String(30), nullable=False), Column("error_code", String(80)), Column("error", Text), Column("retry_at", DateTime(timezone=True)), Column("platform_post_id", String(255)))
    for table, columns in {"login_sessions": ["user_id", "expires_at"], "connected_accounts": ["owner_id"], "media_assets": ["owner_id"], "posts": ["owner_id", "scheduled_at"], "post_destinations": ["post_id", "state", "next_attempt_at"], "publish_attempts": ["destination_id"]}.items():
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade():
    for table in ["publish_attempts", "post_destinations", "posts", "media_assets", "connected_accounts", "oauth_states", "login_sessions", "users"]:
        op.drop_table(table)
