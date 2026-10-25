"""非过期沙盒积分包；原订单、事件完整保留。"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

def upgrade():
    # SQLite 重建被引用表前，在同一事务内保存并重建唯一依赖。
    op.execute("CREATE TEMP TABLE saved_payment_events AS SELECT * FROM payment_events")
    op.drop_table("payment_events")
    with op.batch_alter_table("orders", recreate="always") as batch:
        batch.drop_constraint(op.f("ck_orders_product"), type_="check")
        batch.alter_column("seconds", existing_type=sa.Integer(), nullable=True)
        batch.alter_column("count", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("plan_id", sa.String()))
        batch.add_column(sa.Column("credits", sa.Integer()))
        batch.create_check_constraint(op.f("ck_orders_product"), "amount > 0 AND currency='cny' AND ((plan_id IS NULL AND credits IS NULL AND seconds IS NOT NULL AND count IS NOT NULL AND seconds IN (15,30,60) AND count IN (1,5,10)) OR (plan_id IS NOT NULL AND plan_id IN ('light','creator','plus') AND credits IS NOT NULL AND credits > 0 AND seconds IS NULL AND count IS NULL))")
    op.create_table("payment_events", sa.Column("id", sa.String(), primary_key=True), sa.Column("order_id", sa.String(), sa.ForeignKey("orders.id")), sa.Column("source", sa.String(), nullable=False), sa.Column("created_at", sa.BigInteger(), nullable=False))
    op.execute("INSERT INTO payment_events SELECT * FROM saved_payment_events")
    op.execute("DROP TABLE saved_payment_events")
    op.create_table("sandbox_credit_packs",
        sa.Column("order_id", sa.String(), sa.ForeignKey("orders.id"), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("plan_id", sa.String(), nullable=False), sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("scenes", sa.Text(), nullable=False), sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("credits > 0", name="ck_sandbox_credit_packs_credits"))
    op.create_index("ix_sandbox_credit_packs_user_id", "sandbox_credit_packs", ["user_id"])

def downgrade():
    raise RuntimeError("禁止删除支付流水；请使用备份恢复流程")
