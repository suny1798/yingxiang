"""PostgreSQL 目标导入、核对、重复运行与私有卷复制。

默认只接受隔离schema；正式schema必须提供绑定冻结快照与目标身份的计划。
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import time
from typing import Any

import psycopg

from .contract import (
    EXPECTED_TARGET_TABLES, IMPORTER_VERSION, INSERT_ORDER, PRIMARY_KEYS, TABLES,
    TARGET_SCHEMA_PATTERN,
)
from .errors import StorageError, TargetError
from .source import (
    Source, SourceError, _plan_media, _user_summary, hash_rows, is_link, safe_root,
    sha256_file,
)

MARKER = ".m21a-batch.json"


def now_ms() -> int:
    return int(time.time() * 1000)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _table(schema: str, table: str) -> str:
    return f"{_quote(schema)}.{_quote(table)}"


def _csv_field(value: object) -> str:
    if value is None:
        return r"\N"
    text = str(value)
    if text == r"\N" or any(character in text for character in ',"\r\n'):
        return '"' + text.replace('"', '""') + '"'
    return text


def _csv_line(row: tuple[object, ...]) -> str:
    return ",".join(_csv_field(value) for value in row) + "\n"


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True)
class Batch:
    id: str
    fingerprint: str
    importer_version: str
    status: str


class Target:
    def __init__(self, source: Source, dsn: str, schema: str, storage: str | Path,
                 batch_id: str, *, rehearsal: bool = False, formal_plan: Path | None = None):
        plan = None
        if formal_plan is not None:
            from .formal import validate_plan
            if schema != "yingxiang_migration" or rehearsal or os.environ.get("YINGXIANG_M21A_FAULT"):
                raise TargetError("FORMAL_MODE_INVALID")
            plan = validate_plan(formal_plan, source, Path(storage), batch_id)
        elif not re.fullmatch(TARGET_SCHEMA_PATTERN, schema):
            raise TargetError("TARGET_SCHEMA_NOT_ISOLATED")
        if not batch_id or len(batch_id) > 120 or not re.fullmatch(r"[A-Za-z0-9._:-]+", batch_id):
            raise TargetError("BATCH_ID_INVALID")
        self.source = source
        self.schema = schema
        self.batch_id = batch_id
        self.rehearsal = rehearsal
        try:
            self.storage = safe_root(storage)
        except SourceError:
            raise StorageError("STORAGE_PATH_INVALID") from None
        try:
            self.conn = psycopg.connect(dsn, connect_timeout=10)
            self.conn.autocommit = True
            if plan is not None:
                from .formal import identity
                if identity(self.conn) != plan["target"]:
                    self.conn.close()
                    raise TargetError("FORMAL_TARGET_IDENTITY_MISMATCH")
            locked = self.conn.execute("SELECT pg_try_advisory_lock(hashtextextended(%s,0))",
                                       ("yingxiang-import:" + schema,)).fetchone()[0]
            if not locked:
                self.conn.close()
                raise TargetError("IMPORT_ALREADY_RUNNING")
        except psycopg.Error:
            if hasattr(self, "conn"):
                self.conn.close()
            raise TargetError("TARGET_UNAVAILABLE") from None

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass

    # ---------- schema / batch ----------

    def ensure_schema(self) -> None:
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema=%s",
                    (self.schema,),
                )
                tables = {row[0] for row in cur.fetchall()}
                if tables != set(EXPECTED_TARGET_TABLES):
                    raise TargetError("TARGET_SCHEMA_OUTDATED")
                cur.execute(
                    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=%s",
                    (self.schema,),
                )
                columns: dict[str, set[str]] = {}
                for table, column in cur.fetchall():
                    columns.setdefault(table, set()).add(column)
                for table, expected in TABLES.items():
                    if columns.get(table) != {name for name, _ in expected}:
                        raise TargetError(f"TARGET_COLUMN_SET_MISMATCH:{table}")
                cur.execute(
                    f"SELECT version, success FROM {_table(self.schema, 'flyway_schema_history')}"
                )
                versions = {row[0] for row in cur.fetchall() if row[1] is True}
                if not {"1", "2", "3"} <= versions:
                    raise TargetError("TARGET_FLYWAY_INCOMPLETE")
        except TargetError:
            raise
        except psycopg.Error:
            raise TargetError("TARGET_SCHEMA_UNREADABLE") from None

    def _batch(self, ident: str) -> Batch | None:
        with self.conn.cursor() as cur:
            cur.execute(
                f"SELECT id, source_fingerprint, importer_version, status "
                f"FROM {_table(self.schema, 'import_batches')} WHERE id=%s", (ident,)
            )
            row = cur.fetchone()
        return Batch(*row) if row else None

    def _resolve_batch(self) -> Batch | None:
        return self._batch(self.batch_id) or self._verified_by_fingerprint()

    def _verified_by_fingerprint(self) -> Batch | None:
        with self.conn.cursor() as cur:
            cur.execute(
                f"SELECT id, source_fingerprint, importer_version, status "
                f"FROM {_table(self.schema, 'import_batches')} "
                f"WHERE source_fingerprint=%s AND importer_version=%s "
                f"AND status IN ('verified','sealed') ORDER BY created_at LIMIT 1",
                (self.source.fingerprint, IMPORTER_VERSION),
            )
            row = cur.fetchone()
        return Batch(*row) if row else None

    def _business_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        with self.conn.cursor() as cur:
            for table in TABLES:
                cur.execute(f"SELECT count(*) FROM {_table(self.schema, table)}")
                counts[table] = int(cur.fetchone()[0])
        return counts

    def _insert_batch(self, status: str) -> None:
        now = now_ms()
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {_table(self.schema, 'import_batches')} "
                    f"(id, source_fingerprint, importer_version, status, source_manifest, summary, created_at, updated_at) "
                    f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (self.batch_id, self.source.fingerprint, IMPORTER_VERSION, status,
                     _json(self.source.manifest), _json(self.source.summary()), now, now),
                )

    def _set_status(self, status: str) -> None:
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {_table(self.schema, 'import_batches')} "
                    f"SET status=%s, updated_at=%s WHERE id=%s",
                    (status, now_ms(), self.batch_id),
                )
                if cur.rowcount != 1:
                    raise TargetError("BATCH_MISSING")

    # ---------- private volume ----------

    def _prepare_storage(self) -> None:
        root = self.storage
        try:
            if root.exists():
                if is_link(root) or not root.is_dir():
                    raise StorageError("STORAGE_ROOT_INVALID")
                for item in root.iterdir():
                    if item.name.startswith(".tmp-") and item.is_file() and not is_link(item):
                        item.unlink(missing_ok=True)
                marker = root / MARKER
                if marker.exists():
                    if is_link(marker) or not marker.is_file():
                        raise StorageError("STORAGE_MARKER_INVALID")
                    try:
                        value = json.loads(marker.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        raise StorageError("STORAGE_MARKER_INVALID") from None
                    if value.get("fingerprint") != self.source.fingerprint:
                        raise TargetError("STORAGE_FINGERPRINT_MISMATCH")
                    if {item.name for item in root.iterdir()} - {MARKER, "users"}:
                        raise TargetError("STORAGE_NOT_EMPTY")
                    return
                if any(root.iterdir()):
                    raise TargetError("STORAGE_NOT_EMPTY")
            else:
                root.mkdir(parents=True, exist_ok=False)
            marker = root / MARKER
            temporary = root / f".tmp-{os.getpid()}"
            temporary.write_text(
                json.dumps({"fingerprint": self.source.fingerprint, "importerVersion": IMPORTER_VERSION,
                            "batch": self.batch_id}, ensure_ascii=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, marker)
        except (StorageError, TargetError):
            raise
        except OSError:
            raise StorageError("STORAGE_PREPARE_FAILED") from None

    def _cleanup_temporary_files(self) -> None:
        users = self.storage / "users"
        if not users.exists():
            return
        for path in users.rglob(".tmp-*"):
            if path.is_file() and not is_link(path):
                path.unlink(missing_ok=True)

    def _copy_media(self) -> None:
        self._cleanup_temporary_files()
        copied = 0
        for item in self.source.media:
            source_path = self.source.root.joinpath(*Path(item.path).parts)
            target_path = self.storage.joinpath(*Path(item.path).parts)
            parent = target_path.parent
            try:
                parent.mkdir(parents=True, exist_ok=True)
                for part in (parent, target_path):
                    if is_link(part):
                        raise StorageError("STORAGE_LINK_REJECTED")
                if target_path.exists():
                    if is_link(target_path) or not target_path.is_file():
                        raise StorageError("STORAGE_TARGET_INVALID")
                    if target_path.stat().st_size != item.size or sha256_file(target_path) != item.sha256:
                        raise StorageError("STORAGE_TARGET_CONFLICT")
                    continue
                temporary = parent / f".tmp-{os.getpid()}-{copied}"
                with source_path.open("rb") as source, temporary.open("xb") as destination:
                    shutil.copyfileobj(source, destination, 1024 * 1024)
                    destination.flush()
                    os.fsync(destination.fileno())
                if sha256_file(temporary) != item.sha256:
                    temporary.unlink(missing_ok=True)
                    raise StorageError("STORAGE_COPY_HASH_MISMATCH")
                os.replace(temporary, target_path)
                copied += 1
                if self.rehearsal and os.environ.get("YINGXIANG_M21A_FAULT") == "abort-media" and copied == 1:
                    os._exit(71)
            except (StorageError, TargetError):
                raise
            except OSError:
                raise StorageError("STORAGE_COPY_FAILED") from None

    # ---------- import ----------

    def import_source(self) -> dict[str, Any]:
        self.ensure_schema()
        batch = self._batch(self.batch_id)
        verified = self._verified_by_fingerprint()
        counts = self._business_counts()
        resumed_database = False

        if batch:
            if batch.fingerprint != self.source.fingerprint:
                raise TargetError("BATCH_FINGERPRINT_MISMATCH")
            if batch.importer_version != IMPORTER_VERSION:
                raise TargetError("IMPORTER_VERSION_MISMATCH")
            if batch.status in ("verified", "sealed"):
                report = self.verify()
                report["mode"] = "verified-existing"
                report["batch"] = batch.id
                return report
            if batch.status == "imported":
                self._prepare_storage()
                self._copy_media()
                report = self.verify()
                if report["ok"]:
                    self._set_status("verified")
                    report["status"] = "verified"
                report["mode"] = "resumed-media"
                return report
            if batch.status == "importing":
                if any(counts.values()):
                    raise TargetError("BATCH_INCONSISTENT")
                resumed_database = True
            elif batch.status == "failed":
                if any(counts.values()):
                    raise TargetError("TARGET_NOT_EMPTY")
                self._set_status("importing")
                resumed_database = True
        elif verified:
            report = self.verify()
            report["mode"] = "verified-existing"
            report["batch"] = verified.id
            return report
        else:
            if any(counts.values()):
                raise TargetError("TARGET_NOT_EMPTY")
            self._insert_batch("importing")

        self._prepare_storage()
        self._copy_database()
        self._copy_media()
        report = self.verify()
        if report["ok"]:
            self._set_status("verified")
            report["status"] = "verified"
            report["mode"] = "resumed-db" if resumed_database else "imported"
        else:
            report["mode"] = "imported-with-differences"
        return report

    def _copy_database(self) -> None:
        try:
            with self.conn.transaction():
                with self.conn.cursor() as cur:
                    for table in INSERT_ORDER:
                        columns = ", ".join(_quote(name) for name, _ in TABLES[table])
                        statement = (
                            f"COPY {_table(self.schema, table)} ({columns}) "
                            f"FROM STDIN WITH (FORMAT csv, NULL '\\N')"
                        )
                        with cur.copy(statement) as copy:
                            for row in self.source.rows[table]:
                                copy.write(_csv_line(row))
                    cur.execute(
                        f"DELETE FROM {_table(self.schema, 'import_batch_objects')} WHERE batch_id=%s",
                        (self.batch_id,),
                    )
                    cur.executemany(
                        f"INSERT INTO {_table(self.schema, 'import_batch_objects')} "
                        f"(batch_id, kind, object_key, rows, bytes, sha256) VALUES (%s,%s,%s,%s,%s,%s)",
                        [(self.batch_id, *item) for item in
                         (self.source.table_object_rows() + self.source.file_object_rows())],
                    )
                    cur.execute(
                        f"UPDATE {_table(self.schema, 'import_batches')} "
                        f"SET status='imported', updated_at=%s WHERE id=%s",
                        (now_ms(), self.batch_id),
                    )
                    if self.rehearsal and os.environ.get("YINGXIANG_M21A_FAULT") == "abort-db":
                        os._exit(70)
        except psycopg.Error:
            raise TargetError("TARGET_IMPORT_FAILED") from None

    # ---------- verify ----------

    def _batch_objects(self, batch_id: str) -> dict[tuple[str, str], tuple[object, ...]]:
        with self.conn.cursor() as cur:
            cur.execute(
                f"SELECT kind, object_key, rows, bytes, sha256 "
                f"FROM {_table(self.schema, 'import_batch_objects')} "
                f"WHERE batch_id=%s ORDER BY kind, object_key", (batch_id,)
            )
            return {(row[0], row[1]): (row[2], row[3], row[4]) for row in cur.fetchall()}

    def _read_rows(self, table: str) -> tuple[tuple[object, ...], ...]:
        columns = ", ".join(_quote(name) for name, _ in TABLES[table])
        with self.conn.cursor() as cur:
            cur.execute(
                f"SELECT {columns} FROM {_table(self.schema, table)} "
                f"ORDER BY {_quote(PRIMARY_KEYS[table])}"
            )
            return tuple(cur.fetchall())

    def verify(self) -> dict[str, Any]:
        self.ensure_schema()
        target_rows = {table: self._read_rows(table) for table in TABLES}
        differences: list[dict[str, object]] = []

        for table in TABLES:
            source_rows = self.source.rows[table]
            target = target_rows[table]
            source_hash = self.source.table_hashes[table]
            target_hash = hash_rows(target)
            if len(source_rows) != len(target) or source_hash != target_hash:
                differences.append({"category": "table", "name": table,
                                    "sourceRows": len(source_rows), "targetRows": len(target)})

        try:
            target_media = _plan_media(self.storage, target_rows)
            media_code = None
        except SourceError as error:
            target_media = ()
            media_code = error.code
        source_media = {item.path: (item.size, item.sha256) for item in self.source.media}
        target_media_map = {item.path: (item.size, item.sha256) for item in target_media}
        missing = len(set(source_media) - set(target_media_map))
        extra = len(set(target_media_map) - set(source_media))
        mismatched = sum(1 for key in set(source_media) & set(target_media_map)
                         if source_media[key] != target_media_map[key])
        if media_code or missing or extra or mismatched:
            differences.append({"category": "media", "code": media_code or "MEDIA_DIFFERENCES",
                                "missing": missing, "extra": extra, "mismatched": mismatched})

        source_users = self.source.user_summary
        target_users = _user_summary(target_rows)
        user_differences = [key for key in set(source_users) | set(target_users)
                            if source_users.get(key) != target_users.get(key)]
        if user_differences:
            differences.append({"category": "per-user", "users": len(user_differences)})

        source_balance = _balance_totals(source_users)
        target_balance = _balance_totals(target_users)
        balance_differences = sum(1 for key in set(source_balance) | set(target_balance)
                                  if source_balance.get(key) != target_balance.get(key))
        if balance_differences:
            differences.append({"category": "balance", "groups": balance_differences})

        source_unknown = _unknown_counts(self.source.rows)
        target_unknown = _unknown_counts(target_rows)
        if source_unknown != target_unknown:
            differences.append({"category": "unknown", "source": source_unknown, "target": target_unknown})

        source_orders = _order_counts(self.source.rows)
        target_orders = _order_counts(target_rows)
        if source_orders != target_orders:
            differences.append({"category": "orders", "source": source_orders, "target": target_orders})

        source_works = _work_counts(self.source.rows)
        target_works = _work_counts(target_rows)
        if source_works != target_works:
            differences.append({"category": "works", "source": source_works, "target": target_works})

        source_prompts = sum(1 for item in self.source.media if item.role == "prompts")
        target_prompts = sum(1 for item in target_media if item.role == "prompts")
        if source_prompts != target_prompts:
            differences.append({"category": "prompts", "source": source_prompts, "target": target_prompts})

        batch = self._resolve_batch()
        batch_objects = self._batch_objects(batch.id if batch else self.batch_id)
        expected_objects = {
            (item[0], item[1]): (item[2], item[3], item[4])
            for item in (self.source.table_object_rows() + self.source.file_object_rows())
        }
        if batch_objects != expected_objects:
            differences.append({"category": "batch-objects",
                                "source": len(expected_objects), "target": len(batch_objects)})

        report = {
            "ok": not differences,
            "batch": batch.id if batch else self.batch_id,
            "status": batch.status if batch else "unknown",
            "fingerprint": self.source.fingerprint,
            "tables": {"checked": len(TABLES), "rows": sum(len(rows) for rows in target_rows.values())},
            "files": {"checked": len(target_media), "bytes": sum(item.size for item in target_media)},
            "users": len(target_rows["users"]),
            "balance": {"groups": len(target_balance)},
            "unknown": target_unknown,
            "orders": target_orders,
            "works": target_works,
            "prompts": target_prompts,
            "differences": differences,
        }
        if differences:
            report["code"] = "VERIFY_DIFFERENCES"
        return report

    def seal(self) -> dict[str, Any]:
        report = self.verify()
        if not report["ok"]:
            return report
        self._set_status("sealed")
        report["status"] = "sealed"
        report["mode"] = "sealed"
        return report


def _balance_totals(summary: dict[str, dict[str, object]]) -> dict[str, dict[str, int]]:
    totals: dict[str, dict[str, int]] = {}
    for user in summary.values():
        for key, value in user["balance"].items():
            item = totals.setdefault(key, {"total": 0, "reserved": 0, "used": 0, "revoked": 0, "remaining": 0})
            for name in item:
                item[name] += int(value[name])
    return totals


def _unknown_counts(rows: dict[str, tuple[tuple[object, ...], ...]]) -> dict[str, int]:
    return {
        "attempts": sum(1 for row in rows["usage_attempts"] if row[5] == "unknown"),
        "videoJobs": sum(1 for row in rows["video_jobs"] if row[2] == "unknown"),
    }


def _order_counts(rows: dict[str, tuple[tuple[object, ...], ...]]) -> dict[str, int]:
    states: dict[str, int] = {}
    for row in rows["orders"]:
        states[row[10]] = states.get(row[10], 0) + 1
    paid = states.get("paid", 0)
    grants = {row[5] for row in rows["entitlement_grants"]}
    packs = {row[0] for row in rows["sandbox_credit_packs"]}
    paid_with_grant = sum(1 for row in rows["orders"] if row[10] == "paid" and row[7] is None and f"order:{row[0]}" in grants)
    paid_with_pack = sum(1 for row in rows["orders"] if row[10] == "paid" and row[7] is not None and row[0] in packs)
    return {**states, "paid": paid, "paidWithGrant": paid_with_grant, "paidWithPack": paid_with_pack}


def _work_counts(rows: dict[str, tuple[tuple[object, ...], ...]]) -> dict[str, int]:
    states: dict[str, int] = {}
    for row in rows["works"]:
        states[row[5]] = states.get(row[5], 0) + 1
    deleted = states.get("deleted", 0)
    deleted_refs = sum(1 for row in rows["work_references"]
                       if any(work[0] == row[1] and work[5] == "deleted" for work in rows["works"]))
    return {**states, "deleted": deleted, "deletedReferences": deleted_refs}
