"""停写后的PG schema＋私有卷联合备份。凭据只从环境传给官方工具。"""
from __future__ import annotations
import argparse,json,os,subprocess,hashlib
from pathlib import Path
import psycopg
from psycopg.conninfo import conninfo_to_dict
from .source import safe_root,sha256_file
from .errors import TargetError
from .contract import EXPECTED_TARGET_TABLES
from scripts.joint_snapshot import private_files,copy_users

FORMAT="yingxiang-pg-joint-v1"

def tool_env(dsn: str) -> dict:
    env={k:v for k,v in os.environ.items() if not k.startswith("PG")}
    names={"host":"PGHOST","port":"PGPORT","dbname":"PGDATABASE","user":"PGUSER","password":"PGPASSWORD",
           "sslmode":"PGSSLMODE","sslrootcert":"PGSSLROOTCERT"}
    for key,value in conninfo_to_dict(dsn).items():
        if key not in names: raise TargetError("BACKUP_DSN_OPTION_UNSUPPORTED")
        env[names[key]]=value
    return env

def execute(tool,args,dsn,*,output=None,input_path=None):
    try:
        with (output.open("wb") if output else open(os.devnull,"wb")) as out:
            with (input_path.open("rb") if input_path else open(os.devnull,"rb")) as inp:
                result=subprocess.run([tool,*args],env=tool_env(dsn),stdin=inp,stdout=out,stderr=subprocess.PIPE,timeout=300)
        if result.returncode: raise TargetError("PG_TOOL_FAILED")
    except (OSError,subprocess.TimeoutExpired): raise TargetError("PG_TOOL_UNAVAILABLE_OR_TIMEOUT") from None

def inspect(dsn,schema):
    if schema!="yingxiang_migration": raise TargetError("BACKUP_SCHEMA_INVALID")
    with psycopg.connect(dsn,connect_timeout=10,autocommit=True) as connection:
        connection.read_only=True
        with connection.transaction():
            row=connection.execute("SELECT count(*) FROM yingxiang_migration.import_batches WHERE status=%s",("sealed",)).fetchone()
            if row[0]!=1: raise TargetError("BACKUP_REQUIRES_SEALED_BATCH")
            tables=connection.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=%s ORDER BY table_name",(schema,)).fetchall()
            if {name for name, in tables}!=set(EXPECTED_TARGET_TABLES): raise TargetError("BACKUP_SCHEMA_INCOMPLETE")
            result={}
            for name, in tables:
                rows=connection.execute(f'SELECT * FROM "yingxiang_migration"."{name}"').fetchall()
                encoded=sorted(json.dumps(row,ensure_ascii=True,default=str,separators=(",",":")) for row in rows)
                result[name]={"rows":len(rows),"sha256":hashlib.sha256("\n".join(encoded).encode()).hexdigest()}
            return result

def verify(root):
    root=safe_root(root)
    if (root/"INCOMPLETE").exists(): raise TargetError("BACKUP_INCOMPLETE")
    try:
        manifest=json.loads((root/"manifest.json").read_text())
        if manifest["format"]!=FORMAT or manifest["schema"]!="yingxiang_migration": raise ValueError()
        if sha256_file(root/"database.dump")!=manifest["dumpSha256"] or private_files(root)!=manifest["files"]: raise ValueError()
        return manifest
    except Exception: raise TargetError("BACKUP_VERIFY_FAILED") from None

def snapshot(dsn,schema,storage,destination,*,offline,runner=execute):
    if not offline: raise TargetError("BACKUP_REQUIRES_OFFLINE")
    storage,destination=safe_root(storage),safe_root(destination)
    if storage==destination or storage in destination.parents or destination in storage.parents: raise TargetError("BACKUP_PATH_OVERLAP")
    before=inspect(dsn,schema);files=private_files(storage)
    destination.mkdir(parents=True,exist_ok=False)
    (destination/"INCOMPLETE").touch()
    runner("pg_dump",["--format=custom","--no-acl","--schema="+schema],dsn,output=destination/"database.dump")
    copy_users(storage,destination,files)
    if before!=inspect(dsn,schema) or files!=private_files(storage): raise TargetError("BACKUP_SOURCE_CHANGED")
    manifest={"format":FORMAT,"schema":schema,"tables":before,"files":files,"dumpSha256":sha256_file(destination/"database.dump")}
    (destination/"manifest.json").write_text(json.dumps(manifest,sort_keys=True,ensure_ascii=True))
    (destination/"INCOMPLETE").unlink()
    verify(destination)
    return {"ok":True,"tables":len(before),"files":len(files)}

def restore(dsn,backup,storage,*,offline,runner=execute):
    if not offline: raise TargetError("RESTORE_REQUIRES_OFFLINE")
    backup,storage=safe_root(backup),safe_root(storage)
    if backup==storage or backup in storage.parents or storage in backup.parents: raise TargetError("RESTORE_PATH_OVERLAP")
    manifest=verify(backup)
    with psycopg.connect(dsn,connect_timeout=10,autocommit=True) as connection:
        if connection.execute("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='yingxiang_migration')").fetchone()[0]:
            raise TargetError("RESTORE_TARGET_SCHEMA_EXISTS")
    if storage.exists(): raise TargetError("RESTORE_STORAGE_EXISTS")
    storage.mkdir(parents=True)
    (storage/"INCOMPLETE").touch()
    runner("pg_restore",["--exit-on-error","--single-transaction","--no-owner","--no-acl","--dbname="+conninfo_to_dict(dsn).get("dbname","")],dsn,input_path=backup/"database.dump")
    copy_users(backup,storage,manifest["files"])
    if inspect(dsn,"yingxiang_migration")!=manifest["tables"] or private_files(storage)!=manifest["files"]:
        raise TargetError("RESTORE_VERIFY_FAILED")
    (storage/"INCOMPLETE").unlink()
    return {"ok":True,"tables":len(manifest["tables"]),"files":len(manifest["files"])}

def main():
    parser=argparse.ArgumentParser();parser.add_argument("action",choices=["snapshot","verify","restore"])
    parser.add_argument("--backup",type=Path,required=True);parser.add_argument("--storage",type=Path)
    parser.add_argument("--offline",action="store_true");parser.add_argument("--dsn-env",default="YINGXIANG_IMPORT_DSN")
    args=parser.parse_args()
    try:
        if args.action=="verify":
            value=verify(args.backup);report={"ok":True,"tables":len(value["tables"]),"files":len(value["files"])}
        else:
            dsn=os.environ.get(args.dsn_env,"")
            if not dsn or args.storage is None: raise TargetError("BACKUP_CONFIGURATION_MISSING")
            report=snapshot(dsn,"yingxiang_migration",args.storage,args.backup,offline=args.offline) if args.action=="snapshot" else restore(dsn,args.backup,args.storage,offline=args.offline)
        print(json.dumps(report));return 0
    except Exception:
        print(json.dumps({"ok":False,"code":"PG_JOINT_OPERATION_FAILED"}));return 1
if __name__=="__main__":raise SystemExit(main())
