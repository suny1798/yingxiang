"""追加历史视频管理元数据；保留原任务及所有预算流水。"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("video_history",
        sa.Column("job_id", sa.String(), sa.ForeignKey("video_jobs.id"), primary_key=True),
        sa.Column("title", sa.String(60), nullable=False),
        sa.Column("archived", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 60", name="ck_video_history_title"),
        sa.CheckConstraint("archived IN (0,1)", name="ck_video_history_archived"))


def downgrade():
    raise RuntimeError("禁止通过downgrade删除历史信息；请按备份恢复手册操作")
