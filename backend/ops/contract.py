"""M21-a 源/目标契约：表、列、类型、主键与导入顺序。

只描述当前 SQLite revision 0006 与 Flyway V1—V3 的交集；新增表必须显式登记，
未知表/列在 inventory 阶段非零退出。字段类型只区分文本、32 位整数与 64 位整数，
避免 SQLite 动态类型被静默转换。
"""
from __future__ import annotations

IMPORTER_VERSION = "m21a-1"
SOURCE_REVISION = "0006"
TARGET_SCHEMA_PATTERN = r"yingxiang_migration_it_[a-f0-9]{12}"

TEXT = "text"
INT = "int"
BIG = "big"

# 表 -> ((列, 类型), ...)，列顺序与 Flyway V1 一致。
TABLES: dict[str, tuple[tuple[str, str], ...]] = {
    "users": (
        ("id", TEXT), ("username", TEXT), ("salt", TEXT), ("password_hash", TEXT),
        ("algorithm", TEXT), ("created_at", BIG), ("role", TEXT), ("disabled", INT),
    ),
    "auth_sessions": (("hash", TEXT), ("user_id", TEXT), ("expires_at", BIG)),
    "auth_rate_limits": (("key", TEXT), ("count", INT), ("until", BIG)),
    "entitlement_grants": (
        ("id", TEXT), ("user_id", TEXT), ("seconds", INT), ("environment", TEXT),
        ("source", TEXT), ("source_key", TEXT), ("total", INT), ("reserved", INT),
        ("used", INT), ("revoked", INT),
    ),
    "entitlement_entries": (
        ("id", TEXT), ("grant_id", TEXT), ("operation_key", TEXT), ("kind", TEXT),
        ("quantity", INT), ("created_at", BIG),
    ),
    "usage_attempts": (
        ("id", TEXT), ("user_id", TEXT), ("grant_id", TEXT), ("scene", TEXT),
        ("seconds", INT), ("state", TEXT), ("account_state", TEXT), ("created_at", BIG),
        ("updated_at", BIG), ("observation", TEXT), ("outcome", TEXT),
    ),
    "orders": (
        ("id", TEXT), ("user_id", TEXT), ("request_id", TEXT), ("sku", TEXT),
        ("seconds", INT), ("count", INT), ("amount", INT), ("plan_id", TEXT),
        ("credits", INT), ("currency", TEXT), ("state", TEXT), ("created_at", BIG),
        ("session_id", TEXT), ("checkout_url", TEXT), ("expires_at", BIG),
        ("fulfilled_at", BIG), ("request_snapshot", TEXT), ("template_version", TEXT),
    ),
    "payment_events": (("id", TEXT), ("order_id", TEXT), ("source", TEXT), ("created_at", BIG)),
    "sandbox_credit_packs": (
        ("order_id", TEXT), ("user_id", TEXT), ("plan_id", TEXT), ("credits", INT),
        ("scenes", TEXT), ("created_at", BIG),
    ),
    "budget_campaigns": (("scene", TEXT), ("created_at", BIG)),
    "budget_reservations": (
        ("id", TEXT), ("scene", TEXT), ("user_id", TEXT), ("micro_usd", BIG),
        ("lease_until", BIG), ("created_at", BIG),
    ),
    "video_jobs": (
        ("id", TEXT), ("user_id", TEXT), ("state", TEXT), ("created_at", BIG),
        ("expires_at", BIG), ("seconds_milli", INT), ("micro_usd", BIG),
        ("provider_id", TEXT), ("checked_at", BIG),
    ),
    "video_history": (("job_id", TEXT), ("title", TEXT), ("archived", INT), ("updated_at", BIG)),
    "works": (
        ("id", TEXT), ("user_id", TEXT), ("kind", TEXT), ("source_id", TEXT),
        ("title", TEXT), ("state", TEXT), ("mime", TEXT), ("extension", TEXT),
        ("bytes", BIG), ("chunks", INT), ("duration_ms", INT), ("created_at", BIG),
        ("updated_at", BIG), ("error_code", TEXT), ("retries", INT), ("favorite", INT),
    ),
    "work_references": (
        ("id", TEXT), ("work_id", TEXT), ("mime", TEXT), ("extension", TEXT),
        ("bytes", BIG), ("created_at", BIG),
    ),
    "migration_imports": (
        ("fingerprint", TEXT), ("importer_version", TEXT), ("manifest", TEXT),
        ("summary", TEXT), ("created_at", BIG),
    ),
    "scene_access": (("scene", TEXT), ("value", TEXT)),
    "admin_audit": (
        ("id", TEXT), ("request_id", TEXT), ("actor_id", TEXT), ("action", TEXT),
        ("target", TEXT), ("reason", TEXT), ("changes", TEXT), ("created_at", BIG),
    ),
    "admin_settings": (("key", TEXT), ("value", TEXT), ("version", INT)),
}

PRIMARY_KEYS: dict[str, str] = {
    "users": "id",
    "auth_sessions": "hash",
    "auth_rate_limits": "key",
    "entitlement_grants": "id",
    "entitlement_entries": "id",
    "usage_attempts": "id",
    "orders": "id",
    "payment_events": "id",
    "sandbox_credit_packs": "order_id",
    "budget_campaigns": "scene",
    "budget_reservations": "id",
    "video_jobs": "id",
    "video_history": "job_id",
    "works": "id",
    "work_references": "id",
    "migration_imports": "fingerprint",
    "scene_access": "scene",
    "admin_audit": "id",
    "admin_settings": "key",
}

# 满足外键的插入顺序；不含 alembic_version。
INSERT_ORDER: tuple[str, ...] = (
    "users", "admin_settings", "scene_access", "auth_rate_limits", "budget_campaigns",
    "migration_imports", "entitlement_grants", "auth_sessions", "admin_audit",
    "entitlement_entries", "usage_attempts", "orders", "payment_events",
    "sandbox_credit_packs", "budget_reservations", "video_jobs", "video_history",
    "works", "work_references",
)

# V1 未包含、由 V2—V4 新建的运行时／导入／衣装收藏表；旧SQLite没有对应数据。
TARGET_ONLY_TABLES = (
    "background_tasks", "rate_limit_shadows", "rate_limit_gates", "upload_slots",
    "import_batches", "import_batch_objects", "garment_favorites",
)

EXPECTED_TARGET_TABLES = frozenset(TABLES) | frozenset(TARGET_ONLY_TABLES) | {"flyway_schema_history"}

# 明确不迁移的源目录/资产，供 inventory 与报告引用。
NOT_MIGRATED = (
    "data/backups/", "data/final-20261024/", "data/integration/", "data/integration-frontend/",
    "data/real-tests/", "data/rehearsal-20261024/", "data/prompt-composition-ui-20261025/",
    "data/sandbox-credit-verification-20261025/", "data/video-real-test-20261024/",
    "data/admin-audit/*.json", "data/pre-video-history-manifest.json", "data/restored-20261024.sqlite3",
    ".env / 长期密钥", "Redis 运行时键", "frontend/.cache 与构建产物", "日志与临时文件",
)
