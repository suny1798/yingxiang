"""本人作品收藏与检索索引；保留全部已有作品和媒体文件。"""
from alembic import op


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    # 与0004相同使用SQLite原生ADD COLUMN，避免重建被参考表引用的works。
    op.execute("ALTER TABLE works ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_works_favorite CHECK (favorite IN (0,1))")
    op.create_index('ix_works_user_favorite_created', 'works', ['user_id', 'favorite', 'created_at'])


def downgrade():
    raise RuntimeError('作品收藏与文件需一致恢复，请使用备份恢复流程')
