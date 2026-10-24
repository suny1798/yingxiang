"""首版约束与索引；后续 revision 必须独立冻结，禁止修改已部署 revision。"""
from alembic import op
from migrations.schema_v0001 import metadata

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    metadata.create_all(op.get_bind(), checkfirst=False)


def downgrade():
    raise RuntimeError("禁止通过 downgrade 删除业务数据；请按恢复手册操作")
