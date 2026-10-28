"""只读源校验、指纹与媒体计划；不连接目标库、不写源目录。"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from typing import Iterable

from .contract import (
    BIG, IMPORTER_VERSION, INT, NOT_MIGRATED, PRIMARY_KEYS, SOURCE_REVISION, TABLES, TEXT,
)
from .errors import SourceError

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
MAX_PROMPT_STATES = 128
MAX_PROMPT_HISTORY = 4 * 1024 * 1024
INT32_MIN, INT32_MAX = -(2 ** 31), 2 ** 31 - 1
INT64_MIN, INT64_MAX = -(2 ** 63), 2 ** 63 - 1


def is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def safe_root(value: str | Path) -> Path:
    path = Path(value).absolute()
    for parent in (path, *path.parents):
        if is_link(parent):
            raise SourceError("SOURCE_LINK_REJECTED")
    return path.resolve()


def sha256_file(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def js_length(value: str) -> int:
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def _affinity(declared: str) -> str | None:
    upper = (declared or "").upper()
    if "BIGINT" in upper:
        return BIG
    if "INT" in upper:
        return INT
    if any(token in upper for token in ("CHAR", "CLOB", "TEXT")):
        return TEXT
    return None


def _row_json(row: Iterable[object]) -> str:
    return json.dumps(list(row), ensure_ascii=True, separators=(",", ":"))


def hash_rows(rows: Iterable[tuple[object, ...]]) -> str:
    value = hashlib.sha256()
    first = True
    for row in rows:
        if not first:
            value.update(b"\n")
        value.update(_row_json(row).encode("ascii"))
        first = False
    return value.hexdigest()


@dataclass(frozen=True)
class MediaFile:
    path: str
    size: int
    sha256: str
    role: str

    def as_dict(self) -> dict[str, object]:
        return {"path": self.path, "bytes": self.size, "sha256": self.sha256, "role": self.role}


class Source:
    """已校验的冻结源；所有字段只读，不保留明文密码/会话值的输出。"""

    def __init__(self, root: Path, rows: dict[str, tuple[tuple[object, ...], ...]],
                 columns: dict[str, tuple[str, ...]], schema_sha: str,
                 media: tuple[MediaFile, ...], table_hashes: dict[str, str],
                 user_summary: dict[str, dict[str, object]]):
        self.root = root
        self.rows = rows
        self.columns = columns
        self.schema_sha = schema_sha
        self.media = media
        self.table_hashes = table_hashes
        self.user_summary = user_summary
        self.media_by_path = {item.path: item for item in media}
        self.manifest = {
            "format": "yingxiang-import-source-v1",
            "revision": SOURCE_REVISION,
            "importerVersion": IMPORTER_VERSION,
            "schemaSha256": schema_sha,
            "tables": {name: {"rows": len(rows[name]), "sha256": table_hashes[name]}
                       for name in TABLES},
            "files": [item.as_dict() for item in media],
        }
        canonical = json.dumps(self.manifest, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        self.fingerprint = hashlib.sha256(canonical.encode("ascii")).hexdigest()

    @classmethod
    def load(cls, root_value: str | Path) -> "Source":
        root = safe_root(root_value)
        if not root.is_dir():
            raise SourceError("SOURCE_ROOT_INVALID")
        database = root / "yingxiang.sqlite3"
        if is_link(database) or not database.is_file():
            raise SourceError("SOURCE_DATABASE_INVALID")
        try:
            with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as connection:
                connection.execute("PRAGMA query_only=ON")
                if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise SourceError("SOURCE_INTEGRITY_FAILED")
                if connection.execute("PRAGMA foreign_key_check").fetchall():
                    raise SourceError("SOURCE_FOREIGN_KEY_FAILED")
                if connection.execute("SELECT version_num FROM alembic_version").fetchall() != [(SOURCE_REVISION,)]:
                    raise SourceError("SOURCE_REVISION_INVALID")
                objects = connection.execute(
                    "SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
                ).fetchall()
                if any(kind in ("trigger", "view") for kind, _ in objects):
                    raise SourceError("SOURCE_OBJECT_UNEXPECTED")
                tables = {name for kind, name in objects if kind == "table"}
                if tables != set(TABLES) | {"alembic_version"}:
                    raise SourceError("SOURCE_TABLE_SET_MISMATCH")
                columns: dict[str, tuple[str, ...]] = {}
                schema: dict[str, object] = {}
                for table, expected in TABLES.items():
                    info = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
                    columns[table] = tuple(name for name, _ in expected)
                    actual = {row[1]: _affinity(row[2]) for row in info}
                    if set(actual) != {name for name, _ in expected}:
                        raise SourceError(f"SOURCE_COLUMN_SET_MISMATCH:{table}")
                    if any(actual[name] != kind for name, kind in expected):
                        raise SourceError(f"SOURCE_COLUMN_TYPE_MISMATCH:{table}")
                    # 列顺序可因历史 ADD COLUMN 不同；按列名规范化，导入始终按契约列名选择。
                    schema[table] = sorted(
                        [[row[1], row[2], int(row[3]), int(row[5])] for row in info],
                        key=lambda item: item[0],
                    )
                schema_sha = hashlib.sha256(
                    json.dumps(schema, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
                ).hexdigest()
                rows: dict[str, tuple[tuple[object, ...], ...]] = {}
                table_hashes: dict[str, str] = {}
                for table, expected in TABLES.items():
                    select = ", ".join(f'"{name}"' for name, _ in expected)
                    info = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
                    notnull = {row[1]: bool(row[3]) for row in info}
                    values = connection.execute(
                        f'SELECT {select} FROM "{table}" ORDER BY "{PRIMARY_KEYS[table]}"'
                    ).fetchall()
                    for row in values:
                        _validate_row(table, expected, notnull, row)
                    rows[table] = tuple(values)
                    table_hashes[table] = hash_rows(values)
        except SourceError:
            raise
        except sqlite3.Error:
            raise SourceError("SOURCE_DATABASE_UNREADABLE") from None

        source = cls(root, rows, columns, schema_sha, (), table_hashes, {})
        media = _plan_media(root, rows)
        source.media = media
        source.media_by_path = {item.path: item for item in media}
        source.user_summary = _user_summary(rows)
        _validate_invariants(rows)
        source.manifest["files"] = [item.as_dict() for item in media]
        canonical = json.dumps(source.manifest, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        source.fingerprint = hashlib.sha256(canonical.encode("ascii")).hexdigest()
        return source

    def summary(self) -> dict[str, object]:
        roles: dict[str, int] = {}
        role_bytes: dict[str, int] = {}
        for item in self.media:
            roles[item.role] = roles.get(item.role, 0) + 1
            role_bytes[item.role] = role_bytes.get(item.role, 0) + item.size
        return {
            "revision": SOURCE_REVISION,
            "importerVersion": IMPORTER_VERSION,
            "fingerprint": self.fingerprint,
            "schemaSha256": self.schema_sha,
            "tables": {name: len(self.rows[name]) for name in TABLES},
            "tableHashes": dict(self.table_hashes),
            "files": len(self.media),
            "fileBytes": sum(item.size for item in self.media),
            "fileRoles": roles,
            "fileRoleBytes": role_bytes,
            "users": len(self.rows["users"]),
            "unknownAttempts": sum(1 for row in self.rows["usage_attempts"] if row[5] == "unknown"),
            "unknownVideoJobs": sum(1 for row in self.rows["video_jobs"] if row[2] == "unknown"),
            "deletedWorks": sum(1 for row in self.rows["works"] if row[5] == "deleted"),
            "notMigrated": list(NOT_MIGRATED),
        }

    def table_object_rows(self) -> list[tuple[str, str, int, None, str]]:
        return [("table", name, len(self.rows[name]), None, self.table_hashes[name]) for name in TABLES]

    def file_object_rows(self) -> list[tuple[str, str, None, int, str]]:
        return [("file", item.path, None, item.size, item.sha256) for item in self.media]


def _validate_row(table: str, expected: tuple[tuple[str, str], ...],
                  notnull: dict[str, bool], row: tuple[object, ...]) -> None:
    if len(row) != len(expected):
        raise SourceError(f"SOURCE_ROW_WIDTH:{table}")
    for (name, kind), value in zip(expected, row):
        if value is None:
            if notnull.get(name, False):
                raise SourceError(f"SOURCE_NULL_INVALID:{table}.{name}")
            continue
        if kind == TEXT:
            if type(value) is not str:
                raise SourceError(f"SOURCE_TYPE_INVALID:{table}.{name}")
            if "\x00" in value:
                raise SourceError(f"SOURCE_TEXT_NUL:{table}.{name}")
        else:
            if type(value) is not int:
                raise SourceError(f"SOURCE_TYPE_INVALID:{table}.{name}")
            low, high = (INT32_MIN, INT32_MAX) if kind == INT else (INT64_MIN, INT64_MAX)
            if not low <= value <= high:
                raise SourceError(f"SOURCE_RANGE_INVALID:{table}.{name}")


def _plan_media(root: Path, rows: dict[str, tuple[tuple[object, ...], ...]]) -> tuple[MediaFile, ...]:
    users = {row[0] for row in rows["users"]}
    works = {row[0]: row for row in rows["works"]}
    refs: dict[str, list[tuple[object, ...]]] = {}
    for row in rows["work_references"]:
        refs.setdefault(row[1], []).append(row)

    expected: dict[str, MediaFile] = {}
    seen_work_dirs: set[str] = set()
    users_root = root / "users"
    if is_link(users_root):
        raise SourceError("SOURCE_MEDIA_LINK_REJECTED")
    if users_root.exists() and not users_root.is_dir():
        raise SourceError("SOURCE_MEDIA_ROOT_INVALID")

    if users_root.exists():
        for current, dirnames, filenames in os.walk(users_root, followlinks=False):
            current_path = Path(current)
            if is_link(current_path):
                raise SourceError("SOURCE_MEDIA_LINK_REJECTED")
            relative = current_path.relative_to(root)
            parts = relative.parts
            if len(parts) >= 2 and parts[0] == "users":
                if not UUID_RE.fullmatch(parts[1]) or parts[1] not in users:
                    raise SourceError("SOURCE_MEDIA_ORPHAN_USER")
            if len(parts) == 2:
                if set(dirnames) - {"works"} or filenames:
                    raise SourceError("SOURCE_MEDIA_ORPHAN")
            if len(parts) == 3:
                if parts[2] != "works":
                    raise SourceError("SOURCE_MEDIA_ORPHAN")
            if len(parts) == 4:
                work_id = parts[3]
                if not UUID_RE.fullmatch(work_id) or work_id not in works:
                    raise SourceError("SOURCE_MEDIA_ORPHAN_WORK")
                if work_id in seen_work_dirs:
                    raise SourceError("SOURCE_MEDIA_DUPLICATE_WORK")
                seen_work_dirs.add(work_id)
                work = works[work_id]
                if work[1] != parts[1]:
                    raise SourceError("SOURCE_MEDIA_OWNER_MISMATCH")
                if work[5] == "deleted":
                    if filenames:
                        raise SourceError("SOURCE_DELETED_MEDIA_PRESENT")
                    if refs.get(work_id):
                        raise SourceError("SOURCE_DELETED_REFERENCE_PRESENT")
                elif work[5] == "ready":
                    _require_file(root, expected, current_path, f"result.{work[7]}", work[8], "result")
                elif work[9]:
                    total = 0
                    for index in range(work[9]):
                        item = _require_file(root, expected, current_path, f"chunk-{index:06d}", None, "chunk")
                        total += item.size
                    if total != work[8]:
                        raise SourceError("SOURCE_CHUNK_BYTES_MISMATCH")
                if work[2] == "edit":
                    _optional_prompts(root, expected, current_path)
                elif (current_path / "prompts.json").exists():
                    raise SourceError("SOURCE_PROMPTS_UNEXPECTED")
                for ref in refs.get(work_id, ()):
                    _require_file(root, expected, current_path,
                                  f"reference-{ref[0]}.{ref[3]}", ref[4], "reference")
            if len(parts) > 4:
                raise SourceError("SOURCE_MEDIA_NESTED")
            for name in filenames:
                path = current_path / name
                if is_link(path):
                    raise SourceError("SOURCE_MEDIA_LINK_REJECTED")
                relative_path = path.relative_to(root).as_posix()
                if relative_path not in expected:
                    raise SourceError("SOURCE_MEDIA_ORPHAN_FILE")

    for work_id, work in works.items():
        if work[5] == "deleted":
            continue
        if work[5] == "ready" and work[0] not in seen_work_dirs:
            raise SourceError("SOURCE_RESULT_MISSING")
        if work[9] and work[5] in ("capturing", "saving", "failed") and work[0] not in seen_work_dirs:
            raise SourceError("SOURCE_CHUNK_MISSING")
        for ref in refs.get(work_id, ()):
            path = f"users/{work[1]}/works/{work_id}/reference-{ref[0]}.{ref[3]}"
            if path not in expected:
                raise SourceError("SOURCE_REFERENCE_MISSING")
    return tuple(expected[key] for key in sorted(expected))


def _require_file(root: Path, expected: dict[str, MediaFile], directory: Path,
                  name: str, size: int | None, role: str) -> MediaFile:
    path = directory / name
    if is_link(path) or not path.is_file():
        raise SourceError(f"SOURCE_MEDIA_FILE_MISSING:{role}")
    actual = path.stat().st_size
    if size is not None and actual != size:
        raise SourceError(f"SOURCE_MEDIA_SIZE_MISMATCH:{role}")
    item = MediaFile(path.relative_to(root).as_posix(), actual, sha256_file(path), role)
    expected[item.path] = item
    return item


def _optional_prompts(root: Path, expected: dict[str, MediaFile], directory: Path) -> None:
    path = directory / "prompts.json"
    if not path.exists():
        return
    if is_link(path) or not path.is_file():
        raise SourceError("SOURCE_PROMPTS_INVALID")
    if path.stat().st_size > MAX_PROMPT_HISTORY:
        raise SourceError("SOURCE_PROMPTS_TOO_LARGE")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, list) or len(value) > MAX_PROMPT_STATES:
            raise ValueError
        previous = 0
        for index, state in enumerate(value):
            if not isinstance(state, dict) or set(state) != {"atMs", "instructions"}:
                raise ValueError
            at, items = state["atMs"], state["instructions"]
            if type(at) is not int or not 0 <= at <= 15_000:
                raise ValueError
            if at < previous or (index == 0 and at != 0):
                raise ValueError
            previous = at
            if not isinstance(items, list) or not 1 <= len(items) <= 12:
                raise ValueError
            for text in items:
                if not isinstance(text, str) or not text.strip() or js_length(text) > 500 or "\x00" in text:
                    raise ValueError
                text.encode("utf-8")
    except (OSError, ValueError, UnicodeError):
        raise SourceError("SOURCE_PROMPTS_INVALID") from None
    item = MediaFile(path.relative_to(root).as_posix(), path.stat().st_size, sha256_file(path), "prompts")
    expected[item.path] = item


def _user_summary(rows: dict[str, tuple[tuple[object, ...], ...]]) -> dict[str, dict[str, object]]:
    users = {row[0]: row[1] for row in rows["users"]}
    summary: dict[str, dict[str, object]] = {
        user_id: {
            "sessions": 0, "grants": 0, "entries": 0, "attempts": 0, "unknownAttempts": 0,
            "orders": 0, "ordersByState": {}, "works": 0, "worksByState": {},
            "references": 0, "balance": {},
        }
        for user_id in users
    }
    for row in rows["auth_sessions"]:
        summary[row[1]]["sessions"] += 1
    for row in rows["entitlement_grants"]:
        summary[row[1]]["grants"] += 1
    for row in rows["entitlement_entries"]:
        grant = next((g for g in rows["entitlement_grants"] if g[0] == row[1]), None)
        if grant:
            summary[grant[1]]["entries"] += 1
    for row in rows["usage_attempts"]:
        summary[row[1]]["attempts"] += 1
        if row[5] == "unknown":
            summary[row[1]]["unknownAttempts"] += 1
    for row in rows["orders"]:
        summary[row[1]]["orders"] += 1
        states = summary[row[1]]["ordersByState"]
        states[row[10]] = states.get(row[10], 0) + 1
    for row in rows["works"]:
        summary[row[1]]["works"] += 1
        states = summary[row[1]]["worksByState"]
        states[row[5]] = states.get(row[5], 0) + 1
    for row in rows["work_references"]:
        work = next((w for w in rows["works"] if w[0] == row[1]), None)
        if work:
            summary[work[1]]["references"] += 1
    for user_id in users:
        balance = {}
        for environment in ("real_usage", "stripe_sandbox"):
            for seconds in (15, 30, 60):
                items = [g for g in rows["entitlement_grants"]
                         if g[1] == user_id and g[3] == environment and g[2] == seconds]
                if items:
                    balance[f"{environment}:{seconds}"] = {
                        "total": sum(g[6] for g in items), "reserved": sum(g[7] for g in items),
                        "used": sum(g[8] for g in items), "revoked": sum(g[9] for g in items),
                        "remaining": sum(g[6] - g[7] - g[8] - g[9] for g in items),
                    }
        summary[user_id]["balance"] = balance
    return summary


def _validate_invariants(rows: dict[str, tuple[tuple[object, ...], ...]]) -> None:
    users = {row[0] for row in rows["users"]}
    grants = {row[0]: row for row in rows["entitlement_grants"]}
    works = {row[0]: row for row in rows["works"]}
    orders = {row[0]: row for row in rows["orders"]}

    for row in rows["users"]:
        if not UUID_RE.fullmatch(row[0]) or not row[1] or row[6] not in ("user", "admin") or row[7] not in (0, 1):
            raise SourceError("USERS_INVALID")

    for row in rows["auth_sessions"]:
        if row[1] not in users:
            raise SourceError("SESSION_OWNER_INVALID")

    entries_by_grant: dict[str, dict[str, int]] = {}
    operation_keys: set[str] = set()
    for row in rows["entitlement_entries"]:
        grant = grants.get(row[1])
        if not grant:
            raise SourceError("ENTRY_GRANT_INVALID")
        if row[3] not in ("grant", "reserve", "consume", "revoke") or row[4] <= 0:
            raise SourceError("ENTRY_INVALID")
        if row[2] in operation_keys:
            raise SourceError("ENTRY_OPERATION_DUPLICATE")
        operation_keys.add(row[2])
        entries_by_grant.setdefault(row[1], {}).setdefault(row[3], 0)
        entries_by_grant[row[1]][row[3]] += row[4]
    for grant_id, grant in grants.items():
        total, reserved, used, revoked = grant[6], grant[7], grant[8], grant[9]
        if not (total >= 0 and reserved >= 0 and used >= 0 and revoked >= 0 and reserved + used + revoked <= total):
            raise SourceError("GRANT_BALANCE_INVALID")
        ledger = entries_by_grant.get(grant_id, {})
        if (ledger.get("grant", 0) != total
                or ledger.get("reserve", 0) - ledger.get("consume", 0) != reserved
                or ledger.get("consume", 0) != used
                or ledger.get("revoke", 0) != revoked):
            raise SourceError("GRANT_LEDGER_INVALID")

    for row in rows["usage_attempts"]:
        if row[1] not in users or (row[2] is not None and row[2] not in grants):
            raise SourceError("ATTEMPT_OWNER_INVALID")
        if row[3] not in ("studio", "prompt") or row[5] not in ("reserved", "unknown", "issued", "finished"):
            raise SourceError("ATTEMPT_STATE_INVALID")
        if row[6] not in (None, "review", "used"):
            raise SourceError("ATTEMPT_ACCOUNT_STATE_INVALID")

    packs = {row[0]: row for row in rows["sandbox_credit_packs"]}
    grant_keys = {row[5]: row for row in rows["entitlement_grants"]}
    for order in rows["orders"]:
        order_id, user_id, seconds, count, amount, plan_id, credits, currency, state, fulfilled = (
            order[0], order[1], order[4], order[5], order[6], order[7], order[8], order[9], order[10], order[15],
        )
        if user_id not in users or amount <= 0 or currency != "cny":
            raise SourceError("ORDER_INVALID")
        if plan_id is None:
            if credits is not None or seconds not in (15, 30, 60) or count not in (1, 5, 10):
                raise SourceError("ORDER_PRODUCT_INVALID")
        elif credits is None or credits <= 0 or seconds is not None or count is not None or plan_id not in ("light", "creator", "plus"):
            raise SourceError("ORDER_PRODUCT_INVALID")
        if state == "paid":
            if fulfilled is None:
                raise SourceError("ORDER_FULFILLMENT_MISSING")
            if plan_id is None:
                grant = grant_keys.get(f"order:{order_id}")
                if (not grant or grant[1] != user_id or grant[2] != seconds or grant[3] != "stripe_sandbox"
                        or grant[6] != count or order_id in packs):
                    raise SourceError("ORDER_GRANT_MISMATCH")
            else:
                pack = packs.get(order_id)
                if (not pack or pack[1] != user_id or pack[2] != plan_id or pack[3] != credits
                        or f"order:{order_id}" in grant_keys):
                    raise SourceError("ORDER_PACK_MISMATCH")
        else:
            if fulfilled is not None or f"order:{order_id}" in grant_keys or order_id in packs:
                raise SourceError("ORDER_UNFULFILLED_STATE_INVALID")

    for row in rows["payment_events"]:
        if row[1] is not None and row[1] not in orders:
            raise SourceError("PAYMENT_EVENT_ORDER_INVALID")

    for row in rows["sandbox_credit_packs"]:
        order = orders.get(row[0])
        if not order or order[1] != row[1] or order[7] != row[2] or order[8] != row[3] or order[10] != "paid":
            raise SourceError("CREDIT_PACK_INVALID")
        try:
            scenes = json.loads(row[4])
        except (TypeError, ValueError):
            raise SourceError("CREDIT_PACK_SCENES_INVALID") from None
        if not isinstance(scenes, list) or not all(isinstance(item, str) for item in scenes):
            raise SourceError("CREDIT_PACK_SCENES_INVALID")

    campaigns = {row[0] for row in rows["budget_campaigns"]}
    for row in rows["budget_reservations"]:
        if row[1] not in campaigns or row[2] not in users or row[3] <= 0:
            raise SourceError("RESERVATION_INVALID")

    for row in rows["video_jobs"]:
        if row[1] not in users or row[2] not in ("submitting", "unknown", "pending", "processing", "completed", "failed"):
            raise SourceError("VIDEO_JOB_INVALID")
    for row in rows["video_history"]:
        if row[0] not in {job[0] for job in rows["video_jobs"]} or not 1 <= len(row[1]) <= 60 or row[2] not in (0, 1):
            raise SourceError("VIDEO_HISTORY_INVALID")

    for row in rows["works"]:
        if (row[1] not in users or row[2] not in ("realtime", "video", "edit")
                or row[5] not in ("capturing", "waiting", "saving", "ready", "failed", "deleted")
                or row[7] not in ("mp4", "webm") or row[8] < 0 or row[9] < 0 or row[15] not in (0, 1)):
            raise SourceError("WORK_INVALID")
        if row[5] == "deleted" and (row[4] != "" or row[15] != 0):
            raise SourceError("WORK_TOMBSTONE_INVALID")
        if row[5] == "ready" and row[8] <= 0:
            raise SourceError("WORK_READY_BYTES_INVALID")
    for row in rows["work_references"]:
        work = works.get(row[1])
        if not work or work[5] == "deleted" or row[3] not in ("png", "jpg", "webp") or row[4] <= 0:
            raise SourceError("WORK_REFERENCE_INVALID")

    for row in rows["auth_rate_limits"]:
        if row[1] < 0:
            raise SourceError("RATE_LIMIT_INVALID")
    for row in rows["admin_audit"]:
        if row[2] not in users:
            raise SourceError("ADMIN_AUDIT_ACTOR_INVALID")
    for row in rows["admin_settings"]:
        if row[2] < 0:
            raise SourceError("ADMIN_SETTING_INVALID")
    for row in rows["scene_access"]:
        if row[0] not in ("prompt", "studio") or not row[1]:
            raise SourceError("SCENE_ACCESS_INVALID")
