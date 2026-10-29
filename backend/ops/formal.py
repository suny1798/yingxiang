"""正式导入计划：绑定冻结联合快照、源、目标、卷与批次；不替代操作者停写。"""
from __future__ import annotations
import json
from pathlib import Path
import time
import psycopg
from .errors import TargetError
from .source import Source, safe_root, sha256_file

FORMAT = "yingxiang-formal-import-v1"

def identity(connection) -> dict:
    row=connection.execute("SELECT current_database(),current_user,oid FROM pg_database WHERE datname=current_database()").fetchone()
    return {"host":connection.info.host,"port":connection.info.port,"database":row[0],"role":row[1],"databaseOid":row[2]}

def frozen_source(source: Source, snapshot: str | Path) -> Path:
    from scripts.joint_snapshot import verify, database_state, private_files
    try:
        root=safe_root(snapshot)
        verify(root)
        manifest=json.loads((root/"manifest.json").read_text(encoding="utf-8"))
        if database_state(source.root/"yingxiang.sqlite3")!=manifest["database"] or private_files(source.root)!=manifest["files"]:
            raise ValueError()
        return root
    except Exception:
        raise TargetError("FROZEN_SNAPSHOT_MISMATCH") from None

def create_plan(source: Source, snapshot: Path, storage: Path, batch: str, dsn: str, destination: Path, *, offline: bool) -> None:
    if not offline: raise TargetError("FORMAL_REQUIRES_OFFLINE")
    frozen=frozen_source(source,snapshot)
    volume=safe_root(storage)
    if source.root==volume or source.root in volume.parents or volume in source.root.parents:
        raise TargetError("FORMAL_STORAGE_OVERLAPS_SOURCE")
    with psycopg.connect(dsn,connect_timeout=10,autocommit=True) as connection:
        target=identity(connection)
    plan={"format":FORMAT,"schema":"yingxiang_migration","source":str(source.root),
          "fingerprint":source.fingerprint,"snapshot":str(frozen),
          "snapshotSha256":sha256_file(frozen/"manifest.json"),"storage":str(volume),"batch":batch,
          "target":target,"expiresAt":int(time.time())+7200,"offline":True}
    destination=safe_root(destination)
    for protected in (source.root, frozen, volume):
        if destination==protected or protected in destination.parents:
            raise TargetError("FORMAL_PLAN_PATH_OVERLAP")
    destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open("x",encoding="utf-8") as stream:
        json.dump(plan,stream,ensure_ascii=True,sort_keys=True)

def validate_plan(path: Path, source: Source, storage: Path, batch: str) -> dict:
    try:
        path=safe_root(path)
        if path.stat().st_size>65536: raise ValueError()
        plan=json.loads(path.read_text(encoding="utf-8"))
        expected={"format","schema","source","fingerprint","snapshot","snapshotSha256","storage","batch","target","expiresAt","offline"}
        if set(plan)!=expected or plan["format"]!=FORMAT or plan["schema"]!="yingxiang_migration" or plan["offline"] is not True:
            raise ValueError()
        if type(plan["expiresAt"]) is not int or not int(time.time())<plan["expiresAt"]<=int(time.time())+7200: raise ValueError()
        if plan["source"]!=str(source.root) or plan["fingerprint"]!=source.fingerprint or plan["storage"]!=str(safe_root(storage)) or plan["batch"]!=batch:
            raise ValueError()
        frozen=frozen_source(source,plan["snapshot"])
        if sha256_file(frozen/"manifest.json")!=plan["snapshotSha256"]: raise ValueError()
        return plan
    except TargetError: raise
    except Exception: raise TargetError("FORMAL_PLAN_INVALID") from None
