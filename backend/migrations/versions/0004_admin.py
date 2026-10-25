"""两级角色、账号暂停、管理设置与审计；不自动按用户名授予权限。"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    # ADD COLUMN 避免重建被多张业务表引用的 users。
    op.execute("ALTER TABLE users ADD COLUMN role VARCHAR NOT NULL DEFAULT 'user' CONSTRAINT ck_users_role CHECK (role IN ('user','admin'))")
    op.execute("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_users_disabled CHECK (disabled IN (0,1))")
    op.create_table("admin_audit",
        sa.Column("id", sa.String(), primary_key=True), sa.Column("request_id", sa.String(), unique=True, nullable=False),
        sa.Column("actor_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(), nullable=False), sa.Column("target", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False), sa.Column("changes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False))
    op.create_table("admin_settings", sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False), sa.Column("version", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    raise RuntimeError("禁止自动丢弃管理审计；请使用备份恢复流程")
