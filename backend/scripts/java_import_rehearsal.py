"""M21-a 真实临时 PostgreSQL／私有卷演练。

只读取正式数据副本，不停止 8787／8788，不连接正式 PG／Redis，不调用模型或支付。
命令在 backend/ 执行：
  .venv/Scripts/python.exe -m scripts.java_import_rehearsal
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback

import psycopg

from ops.synthetic import (
    GRANT_15, ORDER_PAID, USER_A, WORK_DELETED, WORK_VIDEO, build as build_synthetic,
)

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_FORMAL = Path(r"C:\Users\sun\Desktop\anyware\backend\data")


class RehearsalError(Exception):
    pass


class Checks:
    def __init__(self) -> None:
        self.count = 0

    def ok(self, condition: object, code: str) -> None:
        self.count += 1
        if not condition:
            raise RehearsalError(code)


def run(command: list[str], *, env: dict[str, str] | None = None,
        expect: int = 0, timeout: int = 600) -> tuple[int, dict[str, object] | None, str]:
    merged = {**os.environ, **(env or {})}
    result = subprocess.run(command, cwd=BACKEND, env=merged, capture_output=True, timeout=timeout)
    output = result.stdout.decode("utf-8", errors="replace").strip()
    report = None
    if output:
        try:
            value = json.loads(output.splitlines()[-1])
            if isinstance(value, dict):
                report = value
        except ValueError:
            pass
    if result.returncode != expect:
        raise RehearsalError(f"COMMAND_EXIT:{result.returncode}:{command[2] if len(command) > 2 else ''}")
    return result.returncode, report, output


def ops(args: list[str], dsn: str, *, expect: int = 0,
        fault: str | None = None) -> tuple[int, dict[str, object] | None]:
    env = {"YINGXIANG_IMPORT_DSN": dsn}
    if fault:
        env["YINGXIANG_M21A_FAULT"] = fault
    code, report, _ = run([sys.executable, "-m", "ops", *args], env=env, expect=expect)
    return code, report


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def database_ok(path: Path) -> bool:
    try:
        with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as db:
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                return False
            if db.execute("PRAGMA foreign_key_check").fetchall():
                return False
            return db.execute("SELECT version_num FROM alembic_version").fetchall() == [("0006",)]
    except sqlite3.Error:
        return False


def copy_formal(source: Path, destination: Path) -> tuple[str, bool]:
    """优先整目录只读复制；若运行中复制不一致，回退到 SQLite backup API。"""
    shutil.copytree(source, destination)
    if database_ok(destination / "yingxiang.sqlite3"):
        return "directory-copy", False
    shutil.rmtree(destination)
    destination.mkdir(parents=True)
    with sqlite3.connect(f"file:{(source / 'yingxiang.sqlite3').as_posix()}?mode=ro", uri=True) as src:
        with sqlite3.connect(destination / "yingxiang.sqlite3") as dst:
            src.backup(dst)
    shutil.copytree(source / "users", destination / "users")
    return "sqlite-backup-api", True


def docker(*args: str, timeout: int = 120) -> str:
    result = subprocess.run(["docker", *args], capture_output=True, timeout=timeout)
    if result.returncode != 0:
        raise RehearsalError("DOCKER_COMMAND_FAILED")
    return result.stdout.decode("utf-8", errors="replace").strip()


def start_postgres() -> tuple[str, int, str, str]:
    name = "yingxiang-m21a-" + secrets.token_hex(5)
    password = secrets.token_hex(24)
    docker("run", "--rm", "-d", "--name", name,
           "-e", f"POSTGRES_PASSWORD={password}", "-e", "POSTGRES_DB=postgres",
           "-p", "127.0.0.1::5432", "postgres:15-alpine")
    try:
        deadline = time.time() + 90
        while time.time() < deadline:
            result = subprocess.run(
                ["docker", "exec", name, "pg_isready", "-U", "postgres", "-d", "postgres"],
                capture_output=True,
            )
            if result.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RehearsalError("POSTGRES_NOT_READY")
        port_text = docker("port", name, "5432/tcp")
        port = int(port_text.rsplit(":", 1)[1])
        return name, port, password, f"postgresql://postgres:{password}@127.0.0.1:{port}/postgres"
    except Exception:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        raise


def flyway_yaml(path: Path, port: int, password: str, schema: str) -> None:
    path.write_text(f'''spring:
  datasource:
    driver-class-name: "org.postgresql.Driver"
    url: "jdbc:postgresql://127.0.0.1:{port}/postgres"
    username: "postgres"
    password: "{password}"
    hikari:
      maximum-pool-size: 2
      minimum-idle: 0
      read-only: false
      data-source-properties:
        sslmode: "disable"
  data:
    redis:
      host: "127.0.0.1"
      port: 1
      username: ""
      password: "synthetic"
      database: 0
      ssl:
        enabled: false
migration:
  public-origin: "http://127.0.0.1:8791"
  db-schema: "{schema}"
  redis-namespace: "yingxiang:migration:m21a"
  maintenance: true
  allow-external-providers: false
  scenes-enabled: false
  stripe-live-enabled: false
''', encoding="utf-8")


def migrate(temp: Path, port: int, password: str, schema: str, checks: Checks) -> None:
    path = temp / f"flyway-{schema}.yml"
    flyway_yaml(path, port, password, schema)
    code, report, _ = run([sys.executable, "-m", "scripts.java_schema", "migrate", "--file", str(path)])
    checks.ok(code == 0 and report and report.get("status") == "VALIDATED", "FLYWAY_NOT_VALIDATED")
    checks.ok(report and report.get("migrationsExecuted") == 3, "FLYWAY_V3_MISSING")


def drop_schema(dsn: str, schema: str) -> None:
    try:
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
    except psycopg.Error:
        pass


def target_counts(dsn: str, schema: str) -> dict[str, int]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema=%s", (schema,)
            )
            tables = sorted(row[0] for row in cur.fetchall()
                            if row[0] not in ("flyway_schema_history", "import_batches", "import_batch_objects"))
            counts = {}
            for table in tables:
                cur.execute(f'SELECT count(*) FROM "{schema}"."{table}"')
                counts[table] = int(cur.fetchone()[0])
            return counts


def batch_state(dsn: str, schema: str, batch: str) -> tuple[str | None, int, int]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f'SELECT status FROM "{schema}".import_batches WHERE id=%s', (batch,))
            row = cur.fetchone()
            cur.execute(f'SELECT count(*) FROM "{schema}".users')
            users = int(cur.fetchone()[0])
            cur.execute(f'SELECT count(*) FROM "{schema}".import_batch_objects WHERE batch_id=%s', (batch,))
            objects = int(cur.fetchone()[0])
            return (row[0] if row else None), users, objects


def media_count(root: Path) -> int:
    users = root / "users"
    if not users.exists():
        return 0
    return sum(1 for path in users.rglob("*") if path.is_file())


def mutate_sql(database: Path, statement: str, params: tuple[object, ...] = ()) -> None:
    with sqlite3.connect(database) as db:
        db.execute(statement, params)
        db.commit()


def anomaly_sources(temp: Path, synthetic: Path) -> list[tuple[str, Path]]:
    cases: list[tuple[str, Path]] = []

    def copy(name: str) -> Path:
        target = temp / f"anomaly-{name}"
        shutil.copytree(synthetic, target)
        cases.append((name, target))
        return target

    root = copy("unknown-table")
    mutate_sql(root / "yingxiang.sqlite3", "CREATE TABLE surprise (x TEXT)")
    root = copy("revision")
    mutate_sql(root / "yingxiang.sqlite3", "UPDATE alembic_version SET version_num='0005'")
    root = copy("type")
    mutate_sql(root / "yingxiang.sqlite3", "UPDATE users SET created_at='not-an-int' WHERE id=?", (USER_A,))
    root = copy("balance")
    mutate_sql(root / "yingxiang.sqlite3",
               "UPDATE entitlement_grants SET reserved=2, used=1 WHERE id=?", (GRANT_15,))
    root = copy("fulfillment")
    mutate_sql(root / "yingxiang.sqlite3", "UPDATE orders SET fulfilled_at=NULL WHERE id=?", (ORDER_PAID,))
    root = copy("missing-result")
    (root / "users" / USER_A / "works" / WORK_VIDEO / "result.mp4").unlink()
    root = copy("deleted-media")
    directory = root / "users" / USER_A / "works" / WORK_DELETED
    directory.mkdir(parents=True)
    (directory / "result.mp4").write_bytes(b"resurrected")
    root = copy("orphan-file")
    (root / "users" / USER_A / "works" / WORK_VIDEO / "orphan.bin").write_bytes(b"orphan")
    root = copy("prompts")
    (root / "users" / USER_A / "works" / WORK_VIDEO).mkdir(parents=True, exist_ok=True)
    (root / "users" / USER_A / "works" / WORK_VIDEO / "prompts.json").write_text("{bad", encoding="utf-8")
    return cases


def main() -> int:
    parser = argparse.ArgumentParser(description="M21-a 真实临时 PG／私有卷导入与恢复演练")
    parser.add_argument("--formal-data", type=Path, default=DEFAULT_FORMAL)
    parser.add_argument("--keep", action="store_true", help="保留临时目录用于排查（默认清理）")
    parser.add_argument("--debug", action="store_true", help="失败时输出本地堆栈（不含凭据）")
    args = parser.parse_args()

    started = time.time()
    checks = Checks()
    temp = Path(tempfile.mkdtemp(prefix="yingxiang-m21a-"))
    container = None
    dsn = ""
    summary: dict[str, object] = {"ok": False}
    try:
        if not (args.formal_data / "yingxiang.sqlite3").is_file():
            raise RehearsalError("FORMAL_DATA_MISSING")
        container, port, password, dsn = start_postgres()
        checks.ok(bool(port) and bool(dsn), "POSTGRES_STARTED")

        synthetic = temp / "synthetic"
        build_synthetic(synthetic)
        code, inv = ops(["inventory", "--source", str(synthetic)], dsn)
        checks.ok(code == 0 and inv and inv.get("ok") is True, "SYNTHETIC_INVENTORY")
        code, dry = ops(["dry-run", "--source", str(synthetic)], dsn)
        checks.ok(code == 0 and dry and dry.get("writes") is False, "SYNTHETIC_DRY_RUN")

        schema = "yingxiang_migration_it_" + secrets.token_hex(6)
        migrate(temp, port, password, schema, checks)
        volume = temp / "volume-synthetic"
        code, imported = ops(["import", "--source", str(synthetic), "--schema", schema,
                              "--storage", str(volume), "--batch", "synthetic-1", "--rehearsal"], dsn)
        checks.ok(code == 0 and imported and imported.get("ok") is True, "SYNTHETIC_IMPORT")
        checks.ok(imported and imported.get("prompts") == 1, "SYNTHETIC_PROMPTS")
        checks.ok(imported and imported.get("works", {}).get("deleted") == 1, "SYNTHETIC_TOMBSTONE")
        checks.ok(imported and imported.get("unknown", {}).get("attempts") == 1, "SYNTHETIC_UNKNOWN")
        checks.ok(imported and imported.get("orders", {}).get("paidWithPack") == 1, "SYNTHETIC_PACK")
        checks.ok(imported and imported.get("orders", {}).get("paidWithGrant") == 1, "SYNTHETIC_GRANT")
        before = target_counts(dsn, schema)
        code, duplicate = ops(["import", "--source", str(synthetic), "--schema", schema,
                               "--storage", str(volume), "--batch", "synthetic-1", "--rehearsal"], dsn)
        after = target_counts(dsn, schema)
        checks.ok(code == 0 and duplicate and duplicate.get("mode") == "verified-existing", "SYNTHETIC_DUPLICATE")
        checks.ok(before == after, "SYNTHETIC_DUPLICATE_COUNTS")
        code, sealed = ops(["seal", "--source", str(synthetic), "--schema", schema,
                            "--storage", str(volume), "--batch", "synthetic-1"], dsn)
        checks.ok(code == 0 and sealed and sealed.get("status") == "sealed", "SYNTHETIC_SEAL")

        changed = temp / "changed-source"
        shutil.copytree(synthetic, changed)
        mutate_sql(changed / "yingxiang.sqlite3",
                   "INSERT INTO auth_rate_limits (key,count,until) VALUES ('changed',1,?)",
                   (1_900_000_000_000,))
        code, rejected = ops(["import", "--source", str(changed), "--schema", schema,
                              "--storage", str(volume), "--batch", "changed-1", "--rehearsal"], dsn, expect=3)
        checks.ok(code == 3, "TARGET_NOT_EMPTY_REJECTED")
        checks.ok(target_counts(dsn, schema) == before, "TARGET_UNCHANGED_AFTER_REJECT")

        anomaly_results = []
        for name, source in anomaly_sources(temp, synthetic):
            code, _ = ops(["inventory", "--source", str(source)], dsn, expect=4)
            checks.ok(code == 4, f"ANOMALY_{name}")
            anomaly_results.append(name)

        # 数据库事务中断：batch 保持 importing，业务表为零；重跑恢复。
        schema_db = "yingxiang_migration_it_" + secrets.token_hex(6)
        migrate(temp, port, password, schema_db, checks)
        volume_db = temp / "volume-interrupt-db"
        code, _ = ops(["import", "--source", str(synthetic), "--schema", schema_db,
                       "--storage", str(volume_db), "--batch", "interrupt-db", "--rehearsal"],
                      dsn, expect=70, fault="abort-db")
        checks.ok(code == 70, "INTERRUPT_DB_EXIT")
        status, users, objects = batch_state(dsn, schema_db, "interrupt-db")
        checks.ok(status == "importing" and users == 0 and objects == 0, "INTERRUPT_DB_STATE")
        code, resumed_db = ops(["import", "--source", str(synthetic), "--schema", schema_db,
                                "--storage", str(volume_db), "--batch", "interrupt-db", "--rehearsal"], dsn)
        checks.ok(code == 0 and resumed_db and resumed_db.get("ok") is True, "INTERRUPT_DB_RESUME")
        checks.ok(batch_state(dsn, schema_db, "interrupt-db")[0] == "verified", "INTERRUPT_DB_VERIFIED")

        # 媒体复制中断：数据库已提交、部分文件存在；重跑补齐并核对。
        schema_media = "yingxiang_migration_it_" + secrets.token_hex(6)
        migrate(temp, port, password, schema_media, checks)
        volume_media = temp / "volume-interrupt-media"
        code, _ = ops(["import", "--source", str(synthetic), "--schema", schema_media,
                       "--storage", str(volume_media), "--batch", "interrupt-media", "--rehearsal"],
                      dsn, expect=71, fault="abort-media")
        checks.ok(code == 71, "INTERRUPT_MEDIA_EXIT")
        status, users, _ = batch_state(dsn, schema_media, "interrupt-media")
        checks.ok(status == "imported" and users == 2 and 0 < media_count(volume_media) < 8, "INTERRUPT_MEDIA_STATE")
        code, resumed_media = ops(["import", "--source", str(synthetic), "--schema", schema_media,
                                   "--storage", str(volume_media), "--batch", "interrupt-media", "--rehearsal"], dsn)
        checks.ok(code == 0 and resumed_media and resumed_media.get("mode") == "resumed-media", "INTERRUPT_MEDIA_RESUME")
        checks.ok(resumed_media and resumed_media.get("ok") is True and media_count(volume_media) == 8, "INTERRUPT_MEDIA_VERIFIED")

        # 正式数据只读副本：整目录复制后核对，导入与重复核对。
        formal = temp / "formal-source"
        copy_method, fallback = copy_formal(args.formal_data, formal)
        checks.ok(database_ok(formal / "yingxiang.sqlite3"), "FORMAL_COPY_INTEGRITY")
        formal_db_hash = sha256(formal / "yingxiang.sqlite3")
        code, formal_inv = ops(["inventory", "--source", str(formal)], dsn)
        checks.ok(code == 0 and formal_inv and formal_inv.get("ok") is True, "FORMAL_INVENTORY")
        code, formal_dry = ops(["dry-run", "--source", str(formal)], dsn)
        checks.ok(code == 0 and formal_dry and formal_dry.get("writes") is False, "FORMAL_DRY_RUN")
        schema_formal = "yingxiang_migration_it_" + secrets.token_hex(6)
        migrate(temp, port, password, schema_formal, checks)
        volume_formal = temp / "volume-formal"
        code, formal_import = ops(["import", "--source", str(formal), "--schema", schema_formal,
                                   "--storage", str(volume_formal), "--batch", "formal-readonly-1",
                                   "--rehearsal"], dsn)
        checks.ok(code == 0 and formal_import and formal_import.get("ok") is True, "FORMAL_IMPORT")
        checks.ok(formal_import and formal_import.get("users") == 3, "FORMAL_USERS")
        checks.ok(formal_import and formal_import.get("files", {}).get("checked") == 5, "FORMAL_FILES")
        checks.ok(formal_import and formal_import.get("files", {}).get("bytes") == 8_514_604, "FORMAL_FILE_BYTES")
        checks.ok(formal_import and formal_import.get("works", {}).get("deleted") == 2, "FORMAL_TOMBSTONES")
        checks.ok(formal_import and formal_import.get("unknown", {}).get("attempts") == 4, "FORMAL_UNKNOWN")
        checks.ok(formal_import and formal_import.get("orders", {}).get("paid") == 4, "FORMAL_ORDERS")
        checks.ok(formal_import and formal_import.get("prompts") == 0, "FORMAL_PROMPTS")
        code, formal_again = ops(["inventory", "--source", str(formal)], dsn)
        checks.ok(code == 0 and formal_again and formal_again.get("fingerprint") == formal_inv.get("fingerprint"),
                  "FORMAL_SOURCE_UNCHANGED")
        checks.ok(sha256(formal / "yingxiang.sqlite3") == formal_db_hash, "FORMAL_DB_UNCHANGED")

        # 联合快照／恢复：SQLite＋媒体 → 新数据根 → 新 PG schema／新卷。
        snapshot = temp / "formal-snapshot"
        code, snapshot_report, _ = run([sys.executable, "-m", "scripts.joint_snapshot", "snapshot",
                                        "--source", str(formal), "--destination", str(snapshot), "--offline"])
        checks.ok(code == 0 and snapshot_report and snapshot_report.get("ok") is True, "JOINT_SNAPSHOT")
        code, snapshot_verify, _ = run([sys.executable, "-m", "scripts.joint_snapshot", "verify",
                                        "--source", str(snapshot)])
        checks.ok(code == 0 and snapshot_verify and snapshot_verify.get("ok") is True, "JOINT_SNAPSHOT_VERIFY")
        restored = temp / "formal-restored"
        code, restore_report, _ = run([sys.executable, "-m", "scripts.joint_snapshot", "restore",
                                       "--source", str(snapshot), "--destination", str(restored), "--offline"])
        checks.ok(code == 0 and restore_report and restore_report.get("ok") is True, "JOINT_RESTORE")
        schema_recovery = "yingxiang_migration_it_" + secrets.token_hex(6)
        migrate(temp, port, password, schema_recovery, checks)
        volume_recovery = temp / "volume-recovery"
        code, recovery = ops(["import", "--source", str(restored), "--schema", schema_recovery,
                              "--storage", str(volume_recovery), "--batch", "formal-recovery-1",
                              "--rehearsal"], dsn)
        checks.ok(code == 0 and recovery and recovery.get("ok") is True, "RECOVERY_IMPORT")
        checks.ok(recovery and recovery.get("fingerprint") == formal_inv.get("fingerprint"),
                  "RECOVERY_FINGERPRINT")
        checks.ok(recovery and recovery.get("files", {}).get("checked") == 5, "RECOVERY_FILES")
        checks.ok(recovery and recovery.get("works", {}).get("deleted") == 2, "RECOVERY_TOMBSTONES")

        summary = {
            "ok": True,
            "checks": checks.count,
            "container": container,
            "formalCopy": {"method": copy_method, "fallback": fallback},
            "synthetic": {
                "tables": imported.get("tables") if imported else None,
                "files": imported.get("files") if imported else None,
                "works": imported.get("works") if imported else None,
                "orders": imported.get("orders") if imported else None,
                "unknown": imported.get("unknown") if imported else None,
                "duplicate": duplicate.get("mode") if duplicate else None,
                "seal": sealed.get("status") if sealed else None,
            },
            "formal": {
                "fingerprint": formal_inv.get("fingerprint") if formal_inv else None,
                "tables": formal_import.get("tables") if formal_import else None,
                "files": formal_import.get("files") if formal_import else None,
                "users": formal_import.get("users") if formal_import else None,
                "works": formal_import.get("works") if formal_import else None,
                "orders": formal_import.get("orders") if formal_import else None,
                "unknown": formal_import.get("unknown") if formal_import else None,
                "prompts": formal_import.get("prompts") if formal_import else None,
            },
            "anomalies": anomaly_results,
            "interruption": {
                "db": {"exit": 70, "resume": resumed_db.get("mode") if resumed_db else None},
                "media": {"exit": 71, "resume": resumed_media.get("mode") if resumed_media else None},
            },
            "recovery": {
                "fingerprint": recovery.get("fingerprint") if recovery else None,
                "files": recovery.get("files") if recovery else None,
                "tombstones": recovery.get("works", {}).get("deleted") if recovery else None,
            },
            "durationSeconds": round(time.time() - started, 2),
        }
        return 0
    except RehearsalError as error:
        summary = {"ok": False, "code": str(error), "checks": checks.count,
                   "durationSeconds": round(time.time() - started, 2)}
        return 1
    except Exception:
        if args.debug:
            traceback.print_exc()
        summary = {"ok": False, "code": "REHEARSAL_FAILED", "checks": checks.count,
                   "durationSeconds": round(time.time() - started, 2)}
        return 1
    finally:
        if container:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True)
        if dsn:
            for schema in list(locals().get("_schemas", [])):
                drop_schema(dsn, schema)
        if not args.keep:
            shutil.rmtree(temp, ignore_errors=True)
        print(json.dumps(summary, ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    raise SystemExit(main())
