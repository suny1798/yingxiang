import argparse
from dataclasses import replace
from pathlib import Path
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from contextlib import closing

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.core import ROOT, Settings
from app.db import Database
from app.legacy import import_snapshot, source_manifest


def initialize(settings):
    config = Config(str(ROOT / "alembic.ini"))
    config.attributes["settings"] = settings
    command.upgrade(config, "head")


def integrity(path):
    with closing(sqlite3.connect(f"file:{Path(path).resolve().as_posix()}?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or connection.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("数据库完整性检查失败")


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_file() or destination.exists() or source == destination:
        raise ValueError("备份源不存在或目标已存在")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # O_EXCL 防止误覆盖；SQLite backup API 包含一致的 WAL 状态。
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with closing(sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(destination)) as dst:
                src.backup(dst)
        integrity(destination)
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def snapshot(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_dir() or destination.exists() or destination == source or source in destination.parents:
        raise ValueError("快照路径无效或目标已存在")
    before, manifest = source_manifest(source)
    destination.mkdir(parents=True, mode=0o700)
    for scene in ("accounts", "studio", "prompt", "video-jobs", "poc"):
        directory = source / scene
        if directory.exists():
            for path in directory.rglob("*"):
                if path.is_symlink():
                    raise ValueError("源快照不接受符号链接")
                if path.is_file():
                    # 私有目录中的完整运行记录都保留；不包含衣橱/测试媒体目录。
                    target = destination / path.relative_to(source)
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with target.open("xb") as stream:
                        stream.write(path.read_bytes())
                    os.chmod(target, 0o600)
    if source_manifest(source)[0] != before or source_manifest(destination)[0] != before:
        raise ValueError("快照期间源发生变化，请停写后重新创建新快照")
    (destination / "manifest.json").write_text(json.dumps({"fingerprint": before, "files": manifest}, indent=2), encoding="utf-8")
    return {"fingerprint": before, "files": len(manifest)}


def main():
    parser = argparse.ArgumentParser(description="映想显式数据库运维（不发起上游调用）")
    parser.add_argument("action", choices=("init", "check", "snapshot", "dry-run", "import", "backup", "restore", "openapi", "grant-admin"))
    parser.add_argument("--username")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args()
    settings = Settings.load()
    result = {"action": args.action, "ok": True}
    if args.action == "grant-admin":
        if not args.username:
            parser.error('grant-admin 需要已有账号 username')
        from app.models import users, admin_audit
        from app.core import now_ms
        from sqlalchemy import select, update, insert
        from uuid import uuid4
        db = Database(settings.database, settings.journal_mode)
        try:
            db.readiness()
            with db.transaction(True) as session:
                user = session.execute(select(users).where(users.c.username == args.username.lower())).mappings().first()
                if not user or user['disabled']:
                    raise ValueError('需要已存在且可用的账号')
                if user['role'] != 'admin':
                    session.execute(update(users).where(users.c.id == user['id']).values(role='admin'))
                    session.execute(insert(admin_audit).values(id=str(uuid4()), request_id=str(uuid4()), actor_id=user['id'], action='admin.bootstrap', target=user['id'], reason='本机运维显式授权管理员', changes=json.dumps({'before': user['role'], 'after': 'admin', 'via': 'local-cli'}), created_at=now_ms()))
                result['role'] = 'admin'
        finally:
            db.close()
    elif args.action == "snapshot":
        if args.source is None or args.destination is None:
            parser.error("snapshot 需要 source 和 destination")
        result.update(snapshot(args.source, args.destination))
    elif args.action == "init":
        initialize(settings)
    elif args.action in ("dry-run", "import"):
        if args.source is None:
            parser.error("导入需要显式 source 快照目录")
        if args.action == "dry-run":
            with tempfile.TemporaryDirectory(prefix="yingxiang-import-") as temp:
                test_settings = replace(settings, data_dir=Path(temp))
                initialize(test_settings)
                db = Database(test_settings.database, test_settings.journal_mode)
                try:
                    result.update(import_snapshot(db, args.source, settings.public_origin))
                    again = import_snapshot(db, args.source, settings.public_origin)
                    if not again["alreadyImported"]:
                        raise ValueError("重复导入验证失败")
                    integrity(test_settings.database)
                    target = Path(temp) / "backup.sqlite3"
                    backup(test_settings.database, target)
                    backup(target, Path(temp) / "restored.sqlite3")
                    result["repeatImportAndRestore"] = True
                finally:
                    db.close()
        else:
            db = Database(settings.database, settings.journal_mode)
            try:
                db.readiness()
                result.update(import_snapshot(db, args.source, settings.public_origin))
                integrity(settings.database)
            finally:
                db.close()
    elif args.action in ("backup", "restore"):
        if args.destination is None:
            parser.error("备份/恢复需要显式 destination，禁止覆盖现有文件")
        source = args.source or settings.database
        if args.action == "restore" and args.source is None:
            parser.error("恢复需要显式 source 备份文件")
        backup(source, args.destination)
    elif args.action == "openapi":
        from app.main import create_app
        destination = args.destination or ROOT.parent / "docs/api/openapi.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        app = create_app(settings)
        try:
            destination.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        finally:
            app.state.db.close()
    else:
        db = Database(settings.database, settings.journal_mode)
        try:
            db.readiness()
            integrity(settings.database)
            result.update(sqlite=sqlite3.sqlite_version, journalMode=settings.journal_mode)
        finally:
            db.close()
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # 不回显源对象、凭据、完整 SDK/SQL 异常。
        print(json.dumps({"ok": False, "error": "OPERATION_FAILED", "message": "操作未通过；源数据不变。请在受控诊断中核查结构、路径、约束和进程状态。"}), file=sys.stderr)
        sys.exit(1)
