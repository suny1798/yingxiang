"""合成源：覆盖账号、账本、订单、视频、作品媒体/提示词/墓碑与限流窗口。

只用于 M21-a 演练与单元测试；不读取正式数据，不调用模型或支付。
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3

USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
SESSION_A = "a" * 64
SESSION_B = "b" * 64
GRANT_15 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
GRANT_30 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
GRANT_ORDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
ORDER_PAID = "10000000-0000-4000-8000-000000000001"
ORDER_PACK = "10000000-0000-4000-8000-000000000002"
ORDER_PENDING = "10000000-0000-4000-8000-000000000003"
ORDER_EXPIRED = "10000000-0000-4000-8000-000000000004"
JOB_DONE = "30000000-0000-4000-8000-000000000001"
JOB_UNKNOWN = "30000000-0000-4000-8000-000000000002"
JOB_PENDING = "30000000-0000-4000-8000-000000000003"
WORK_REALTIME = "40000000-0000-4000-8000-000000000001"
WORK_EDIT = "40000000-0000-4000-8000-000000000002"
WORK_VIDEO = "40000000-0000-4000-8000-000000000003"
WORK_DELETED = "40000000-0000-4000-8000-000000000004"
WORK_CAPTURING = "40000000-0000-4000-8000-000000000005"
WORK_FAILED = "40000000-0000-4000-8000-000000000006"
REF_REALTIME = "50000000-0000-4000-8000-000000000001"
REF_EDIT = "50000000-0000-4000-8000-000000000002"
NOW = 1_800_000_000_000


def build(root: Path) -> Path:
    root = root.absolute()
    if root.exists():
        raise FileExistsError(root)
    root.mkdir(parents=True)
    from app.core import Settings
    from scripts.ops import initialize

    initialize(Settings(data_dir=root))
    database = root / "yingxiang.sqlite3"
    with sqlite3.connect(database) as db:
        db.execute("PRAGMA foreign_keys=ON")
        _users(db)
        _accounts(db)
        _orders(db)
        _video(db)
        _works(db)
        _misc(db)
    _media(root)
    return root


def _users(db: sqlite3.Connection) -> None:
    db.executemany(
        'INSERT INTO users (id,username,salt,password_hash,algorithm,created_at,role,disabled) '
        'VALUES (?,?,?,?,?,?,?,?)',
        [
            (USER_A, "synthetic_admin", "11" * 16, "22" * 64, "scrypt-n16384-r8-p1-dk64", NOW, "admin", 0),
            (USER_B, "synthetic_user", "33" * 16, "44" * 64, "scrypt-n16384-r8-p1-dk64", NOW + 1, "user", 0),
        ],
    )
    db.executemany(
        'INSERT INTO auth_sessions (hash,user_id,expires_at) VALUES (?,?,?)',
        [(SESSION_A, USER_A, NOW + 86_400_000), (SESSION_B, USER_B, NOW + 86_400_000)],
    )


def _accounts(db: sqlite3.Connection) -> None:
    db.executemany(
        'INSERT INTO entitlement_grants '
        '(id,user_id,seconds,environment,source,source_key,total,reserved,used,revoked) '
        'VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
            (GRANT_15, USER_A, 15, "real_usage", "free", f"signup:{USER_A}", 5, 1, 2, 0),
            (GRANT_30, USER_B, 30, "stripe_sandbox", "synthetic", "synthetic:sandbox", 5, 0, 0, 0),
            (GRANT_ORDER, USER_A, 15, "stripe_sandbox", "paid", f"order:{ORDER_PAID}", 1, 0, 0, 0),
        ],
    )
    entries = [
        ("e0000000-0000-4000-8000-000000000001", GRANT_15, f"grant:signup:{USER_A}", "grant", 5, NOW),
        ("e0000000-0000-4000-8000-000000000002", GRANT_15, "reserve:attempt-a", "reserve", 3, NOW + 1),
        ("e0000000-0000-4000-8000-000000000003", GRANT_15, "consume:attempt-a", "consume", 2, NOW + 2),
        ("e0000000-0000-4000-8000-000000000004", GRANT_30, "grant:synthetic:sandbox", "grant", 5, NOW + 3),
        ("e0000000-0000-4000-8000-000000000005", GRANT_ORDER, f"grant:order:{ORDER_PAID}", "grant", 1, NOW + 4),
    ]
    db.executemany(
        'INSERT INTO entitlement_entries (id,grant_id,operation_key,kind,quantity,created_at) '
        'VALUES (?,?,?,?,?,?)', entries,
    )
    db.executemany(
        'INSERT INTO usage_attempts '
        '(id,user_id,grant_id,scene,seconds,state,account_state,created_at,updated_at,observation,outcome) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [
            ("60000000-0000-4000-8000-000000000001", USER_A, None, "prompt", 15, "unknown", None, NOW, NOW, "synthetic", "error"),
            ("60000000-0000-4000-8000-000000000002", USER_A, None, "prompt", 15, "issued", None, NOW + 1, NOW + 1, None, None),
            ("60000000-0000-4000-8000-000000000003", USER_A, GRANT_15, "studio", 15, "finished", "used", NOW + 2, NOW + 3, None, "ended"),
            ("60000000-0000-4000-8000-000000000004", USER_A, GRANT_15, "studio", 15, "reserved", "review", NOW + 4, None, None, None),
        ],
    )


def _orders(db: sqlite3.Connection) -> None:
    db.executemany(
        'INSERT INTO orders '
        '(id,user_id,request_id,sku,seconds,count,amount,currency,state,created_at,session_id,'
        'checkout_url,expires_at,fulfilled_at,request_snapshot,template_version,plan_id,credits) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
            (ORDER_PAID, USER_A, "req-paid", "tryon-v1-15-1", 15, 1, 690, "cny", "paid", NOW, "cs_paid", "https://example.invalid/paid", NOW + 86_400_000, NOW + 10, "{}", "node-v1", None, None),
            (ORDER_PACK, USER_B, "req-pack", "credits-v1-plus", None, None, 32900, "cny", "paid", NOW + 1, "cs_pack", "https://example.invalid/pack", NOW + 86_400_000, NOW + 11, "{}", "credits-v1", "plus", 1200),
            (ORDER_PENDING, USER_A, "req-pending", "tryon-v1-30-5", 30, 5, 5690, "cny", "pending", NOW + 2, "cs_pending", "https://example.invalid/pending", NOW + 86_400_000, None, "{}", "node-v1", None, None),
            (ORDER_EXPIRED, USER_A, "req-expired", "credits-v1-light", None, None, 3900, "cny", "expired", NOW + 3, "cs_expired", "https://example.invalid/expired", NOW + 86_400_000, None, "{}", "credits-v1", "light", 120),
        ],
    )
    db.executemany(
        'INSERT INTO payment_events (id,order_id,source,created_at) VALUES (?,?,?,?)',
        [("evt_synthetic_paid", ORDER_PAID, "stripe_sandbox", NOW + 10),
         ("evt_synthetic_legacy", None, "legacy", NOW + 11)],
    )
    db.execute(
        'INSERT INTO sandbox_credit_packs (order_id,user_id,plan_id,credits,scenes,created_at) '
        'VALUES (?,?,?,?,?,?)',
        (ORDER_PACK, USER_B, "plus", 1200, json.dumps(["tryon", "video", "edit"]), NOW + 11),
    )


def _video(db: sqlite3.Connection) -> None:
    db.executemany(
        'INSERT INTO video_jobs (id,user_id,state,created_at,expires_at,seconds_milli,micro_usd,provider_id,checked_at) '
        'VALUES (?,?,?,?,?,?,?,?,?)',
        [
            (JOB_DONE, USER_A, "completed", NOW, NOW + 86_400_000, 15_000, 1_500_000, "provider-synthetic-1", NOW + 5),
            (JOB_UNKNOWN, USER_A, "unknown", NOW + 1, NOW + 86_400_000, 30_000, 2_000_000, "provider-synthetic-2", None),
            (JOB_PENDING, USER_B, "pending", NOW + 2, NOW + 86_400_000, 60_000, 3_000_000, None, None),
        ],
    )
    db.execute(
        'INSERT INTO video_history (job_id,title,archived,updated_at) VALUES (?,?,?,?)',
        (JOB_DONE, "合成视频任务", 1, NOW + 6),
    )


def _works(db: sqlite3.Connection) -> None:
    db.executemany(
        'INSERT INTO works '
        '(id,user_id,kind,source_id,title,state,mime,extension,bytes,chunks,duration_ms,created_at,updated_at,error_code,retries,favorite) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
            (WORK_REALTIME, USER_A, "realtime", None, "合成实时作品", "ready", "video/mp4", "mp4", 1024, 2, 15_000, NOW, NOW, None, 0, 1),
            (WORK_EDIT, USER_B, "edit", None, "合成编辑作品", "ready", "video/webm", "webm", 2048, 1, 15_000, NOW + 1, NOW + 1, None, 0, 0),
            (WORK_VIDEO, USER_A, "video", JOB_DONE, "合成视频作品", "ready", "video/mp4", "mp4", 1536, 0, 15_000, NOW + 2, NOW + 2, None, 0, 0),
            (WORK_DELETED, USER_A, "video", JOB_UNKNOWN, "", "deleted", "video/mp4", "mp4", 0, 0, 30_000, NOW + 3, NOW + 3, None, 0, 0),
            (WORK_CAPTURING, USER_A, "realtime", None, "合成录制中", "capturing", "video/webm", "webm", 1280, 2, 5_000, NOW + 4, NOW + 4, None, 0, 0),
            (WORK_FAILED, USER_B, "video", JOB_PENDING, "合成失败作品", "failed", "video/mp4", "mp4", 0, 0, 60_000, NOW + 5, NOW + 5, "SOURCE_EXPIRED", 0, 0),
        ],
    )
    db.executemany(
        'INSERT INTO work_references (id,work_id,mime,extension,bytes,created_at) VALUES (?,?,?,?,?,?)',
        [
            (REF_REALTIME, WORK_REALTIME, "image/png", "png", 256, NOW),
            (REF_EDIT, WORK_EDIT, "image/jpeg", "jpg", 300, NOW + 1),
        ],
    )


def _misc(db: sqlite3.Connection) -> None:
    db.executemany(
        'INSERT INTO budget_campaigns (scene,created_at) VALUES (?,?)',
        [("prompt", NOW), ("video", NOW)],
    )
    db.executemany(
        'INSERT INTO budget_reservations (id,scene,user_id,micro_usd,lease_until,created_at) VALUES (?,?,?,?,?,?)',
        [("70000000-0000-4000-8000-000000000001", "prompt", USER_A, 300_000, NOW + 45_000, NOW),
         ("70000000-0000-4000-8000-000000000002", "video", USER_B, 1_000_000, NOW + 45_000, NOW + 1)],
    )
    db.executemany(
        'INSERT INTO auth_rate_limits (key,count,until) VALUES (?,?,?)',
        [("auth:global", 2, NOW + 900_000), ("signup", 1, NOW - 1)],
    )
    db.execute(
        'INSERT INTO admin_settings (key,value,version) VALUES (?,?,?)',
        ("announcement", json.dumps({"text": "合成公告"}), 1),
    )
    db.execute(
        'INSERT INTO admin_audit (id,request_id,actor_id,action,target,reason,changes,created_at) '
        'VALUES (?,?,?,?,?,?,?,?)',
        ("80000000-0000-4000-8000-000000000001", "req-audit", USER_A, "announcement.update",
         "announcement", "合成", "{}", NOW),
    )
    db.execute('INSERT INTO scene_access (scene,value) VALUES (?,?)', ("prompt", "synthetic-nonce-prompt"))
    db.execute('INSERT INTO scene_access (scene,value) VALUES (?,?)', ("studio", "synthetic-nonce-studio"))
    db.execute(
        'INSERT INTO migration_imports (fingerprint,importer_version,manifest,summary,created_at) '
        'VALUES (?,?,?,?,?)',
        ("synthetic-old", "old-1", "{}", "{}", NOW),
    )


def _media(root: Path) -> None:
    realtime = root / "users" / USER_A / "works" / WORK_REALTIME
    edit = root / "users" / USER_B / "works" / WORK_EDIT
    video = root / "users" / USER_A / "works" / WORK_VIDEO
    capturing = root / "users" / USER_A / "works" / WORK_CAPTURING
    for directory in (realtime, edit, video, capturing):
        directory.mkdir(parents=True, exist_ok=True)
    (realtime / "result.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"A" * (1024 - 12))
    (realtime / f"reference-{REF_REALTIME}.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"C" * (256 - 8))
    (edit / "result.webm").write_bytes(b"\x1aE\xdf\xa3" + b"B" * (2048 - 4))
    (edit / f"reference-{REF_EDIT}.jpg").write_bytes(b"\xff\xd8\xff\xe0" + b"D" * (300 - 4))
    (edit / "prompts.json").write_text(
        json.dumps([{"atMs": 0, "instructions": ["把外套换成红色"]},
                    {"atMs": 5000, "instructions": ["再加一条围巾", "保持背景"]}],
                   ensure_ascii=False),
        encoding="utf-8",
    )
    (video / "result.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"E" * (1536 - 12))
    (capturing / "chunk-000000").write_bytes(b"F" * 512)
    (capturing / "chunk-000001").write_bytes(b"G" * 768)
