from contextlib import contextmanager
from pathlib import Path
import sqlite3

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

REVISION = "0002"


def wal_safe(version):
    v = tuple(map(int, version.split(".")))
    return v >= (3, 51, 3) or (3, 50, 7) <= v < (3, 51, 0) or (3, 44, 6) <= v < (3, 45, 0)


class Database:
    def __init__(self, path: Path, journal_mode="DELETE", *, initialize=False):
        self.path, self.journal_mode = Path(path).resolve(), journal_mode
        if journal_mode == "WAL" and not wal_safe(sqlite3.sqlite_version):
            raise RuntimeError("当前 SQLite 请使用 DELETE 模式；WAL 需已修复运行时")
        if initialize:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        # mode=rw 防止运行库被删后静默创建空库；只有显式迁移允许创建。
        mode = "rwc" if initialize else "rw"
        url = URL.create("sqlite", database=f"file:{self.path.as_posix()}", query={"mode": mode, "uri": "true"})
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 1}, poolclass=NullPool)

        @event.listens_for(self.engine, "connect")
        def connect(connection, _):
            connection.isolation_level = None
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA synchronous=FULL")
            cursor.execute("PRAGMA busy_timeout=1000")
            cursor.close()

        @event.listens_for(self.engine, "begin")
        def begin(connection):
            connection.exec_driver_sql("BEGIN IMMEDIATE" if connection.get_execution_options().get("write") else "BEGIN")

    @contextmanager
    def transaction(self, write=False):
        with self.engine.connect().execution_options(write=write) as conn:
            with conn.begin():
                with Session(bind=conn, expire_on_commit=False, join_transaction_mode="rollback_only") as session:
                    yield session
                    session.flush()

    def readiness(self):
        if not self.path.is_file():
            raise RuntimeError("数据库不存在")
        with self.transaction() as session:
            if session.execute(text("SELECT version_num FROM alembic_version")).scalar_one() != REVISION:
                raise RuntimeError("数据库版本不匹配")
            for pragma, expected in (("foreign_keys", 1), ("synchronous", 2), ("journal_mode", self.journal_mode.lower())):
                if session.execute(text(f"PRAGMA {pragma}")).scalar_one() != expected:
                    raise RuntimeError("数据库连接配置不匹配")
        return True

    def close(self):
        self.engine.dispose()
