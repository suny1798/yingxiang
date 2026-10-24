"""数据库约束是最终防线；公开响应由服务层单独构建。"""
from sqlalchemy import MetaData, Table, Column, String, Integer, BigInteger, Text, ForeignKey, CheckConstraint, UniqueConstraint

metadata = MetaData(naming_convention={"ix": "ix_%(table_name)s_%(column_0_name)s", "uq": "uq_%(table_name)s_%(column_0_name)s", "ck": "ck_%(table_name)s_%(constraint_name)s", "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s", "pk": "pk_%(table_name)s"})

users = Table("users", metadata,
    Column("id", String, primary_key=True), Column("username", String, nullable=False, unique=True),
    Column("salt", String, nullable=False), Column("password_hash", String, nullable=False),
    Column("algorithm", String, nullable=False, server_default="scrypt-n16384-r8-p1-dk64"), Column("created_at", BigInteger, nullable=False))
sessions = Table("auth_sessions", metadata,
    Column("hash", String, primary_key=True), Column("user_id", ForeignKey("users.id"), nullable=False, index=True), Column("expires_at", BigInteger, nullable=False))
limits = Table("auth_rate_limits", metadata,
    Column("key", String, primary_key=True), Column("count", Integer, nullable=False), Column("until", BigInteger, nullable=False), CheckConstraint("count >= 0", name="count"))
grants = Table("entitlement_grants", metadata,
    Column("id", String, primary_key=True), Column("user_id", ForeignKey("users.id"), nullable=False, index=True),
    Column("seconds", Integer, nullable=False), Column("environment", String, nullable=False), Column("source", String, nullable=False),
    Column("source_key", String, unique=True, nullable=False), Column("total", Integer, nullable=False),
    Column("reserved", Integer, nullable=False, server_default="0"), Column("used", Integer, nullable=False, server_default="0"), Column("revoked", Integer, nullable=False, server_default="0"),
    CheckConstraint("seconds IN (15,30,60)", name="duration"), CheckConstraint("environment IN ('real_usage','stripe_sandbox')", name="environment"),
    CheckConstraint("total >= 0 AND reserved >= 0 AND used >= 0 AND revoked >= 0 AND reserved+used+revoked <= total", name="balance"))
entries = Table("entitlement_entries", metadata,
    Column("id", String, primary_key=True), Column("grant_id", ForeignKey("entitlement_grants.id"), nullable=False),
    Column("operation_key", String, nullable=False, unique=True), Column("kind", String, nullable=False), Column("quantity", Integer, nullable=False), Column("created_at", BigInteger, nullable=False),
    CheckConstraint("kind IN ('grant','reserve','consume','revoke')", name="kind"), CheckConstraint("quantity > 0", name="quantity"))
attempts = Table("usage_attempts", metadata,
    Column("id", String, primary_key=True), Column("user_id", ForeignKey("users.id"), nullable=False), Column("grant_id", ForeignKey("entitlement_grants.id")),
    Column("scene", String, nullable=False), Column("seconds", Integer, nullable=False), Column("state", String, nullable=False),
    Column("account_state", String), Column("created_at", BigInteger, nullable=False), Column("updated_at", BigInteger), Column("observation", Text), Column("outcome", String),
    CheckConstraint("scene IN ('studio','prompt')", name="scene"), CheckConstraint("state IN ('reserved','unknown','issued','finished')", name="state"),
    CheckConstraint("account_state IS NULL OR account_state IN ('review','used')", name="account_state"))
orders = Table("orders", metadata,
    Column("id", String, primary_key=True), Column("user_id", ForeignKey("users.id"), nullable=False), Column("request_id", String, nullable=False),
    Column("sku", String, nullable=False), Column("seconds", Integer, nullable=False), Column("count", Integer, nullable=False), Column("amount", Integer, nullable=False),
    Column("currency", String, nullable=False), Column("state", String, nullable=False), Column("created_at", BigInteger, nullable=False),
    Column("session_id", String, unique=True), Column("checkout_url", Text), Column("expires_at", BigInteger), Column("fulfilled_at", BigInteger),
    Column("request_snapshot", Text), Column("template_version", String, nullable=False, server_default="node-v1"),
    UniqueConstraint("user_id", "request_id"), CheckConstraint("state IN ('creating','pending','paid','failed','expired')", name="state"),
    CheckConstraint("seconds IN (15,30,60) AND count IN (1,5,10) AND amount > 0 AND currency='cny'", name="product"))
events = Table("payment_events", metadata,
    Column("id", String, primary_key=True), Column("order_id", ForeignKey("orders.id")), Column("source", String, nullable=False), Column("created_at", BigInteger, nullable=False))
campaigns = Table("budget_campaigns", metadata,
    Column("scene", String, primary_key=True), Column("created_at", BigInteger, nullable=False), CheckConstraint("scene IN ('prompt','video')", name="scene"))
reservations = Table("budget_reservations", metadata,
    Column("id", String, primary_key=True), Column("scene", ForeignKey("budget_campaigns.scene"), nullable=False), Column("user_id", ForeignKey("users.id"), nullable=False),
    Column("micro_usd", BigInteger, nullable=False), Column("lease_until", BigInteger, nullable=False), Column("created_at", BigInteger, nullable=False), CheckConstraint("micro_usd > 0", name="amount"))
jobs = Table("video_jobs", metadata,
    Column("id", String, primary_key=True), Column("user_id", ForeignKey("users.id"), nullable=False), Column("state", String, nullable=False),
    Column("created_at", BigInteger, nullable=False), Column("expires_at", BigInteger, nullable=False), Column("seconds_milli", Integer, nullable=False), Column("micro_usd", BigInteger, nullable=False),
    Column("provider_id", String, unique=True), Column("checked_at", BigInteger), CheckConstraint("state IN ('submitting','unknown','pending','processing','completed','failed')", name="state"))
video_history = Table("video_history", metadata,
    Column("job_id", ForeignKey("video_jobs.id"), primary_key=True),
    Column("title", String(60), nullable=False), Column("archived", Integer, nullable=False, server_default="0"),
    Column("updated_at", BigInteger, nullable=False),
    CheckConstraint("length(title) BETWEEN 1 AND 60", name="title"), CheckConstraint("archived IN (0,1)", name="archived"))
imports = Table("migration_imports", metadata,
    Column("fingerprint", String, primary_key=True), Column("importer_version", String, nullable=False), Column("manifest", Text, nullable=False), Column("summary", Text, nullable=False), Column("created_at", BigInteger, nullable=False))
# 只保存本机门禁 nonce；不保存模型 token、原始 SDK 诊断或媒体。
access = Table("scene_access", metadata, Column("scene", String, primary_key=True), Column("value", String, nullable=False))
