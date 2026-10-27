"""本人作品、异步保存状态与多张服装参考图；媒体存私有用户目录。"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    # 冻结本次结构，不随未来app.models修改而改变历史迁移。
    op.create_table('works',
        sa.Column('id', sa.String(), primary_key=True), sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('kind', sa.String(), nullable=False), sa.Column('source_id', sa.String()), sa.Column('title', sa.String(60), nullable=False),
        sa.Column('state', sa.String(), nullable=False), sa.Column('mime', sa.String(), nullable=False), sa.Column('extension', sa.String(), nullable=False),
        sa.Column('bytes', sa.BigInteger(), nullable=False, server_default='0'), sa.Column('chunks', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('duration_ms', sa.Integer(), nullable=False, server_default='0'), sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False), sa.Column('error_code', sa.String()), sa.Column('retries', sa.Integer(), nullable=False, server_default='0'),
        sa.UniqueConstraint('kind', 'source_id'), sa.CheckConstraint("kind IN ('realtime','video','edit')", name='kind'),
        sa.CheckConstraint("state IN ('capturing','waiting','saving','ready','failed','deleted')", name='state'),
        sa.CheckConstraint("extension IN ('mp4','webm') AND bytes >= 0 AND chunks >= 0", name='media'))
    op.create_index('ix_works_user_id', 'works', ['user_id'])
    op.create_table('work_references',
        sa.Column('id', sa.String(), primary_key=True), sa.Column('work_id', sa.String(), sa.ForeignKey('works.id'), nullable=False),
        sa.Column('mime', sa.String(), nullable=False), sa.Column('extension', sa.String(), nullable=False), sa.Column('bytes', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False))
    op.create_index('ix_work_references_work_id', 'work_references', ['work_id'])


def downgrade():
    raise RuntimeError('作品文件与索引需一致恢复，请使用备份恢复流程')
