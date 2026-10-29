"""正式计划与备份拒绝边界；不连接真实数据库。"""
import json,time
from pathlib import Path
import pytest
from ops.errors import TargetError
from ops.source import Source,sha256_file
from ops.synthetic import build
from ops.formal import FORMAT,validate_plan,create_plan
from ops.target import Target
from ops.pg_backup import snapshot,restore,tool_env
from scripts import joint_snapshot

@pytest.fixture
def planned(tmp_path):
 raw=build(tmp_path/"raw");frozen=tmp_path/"frozen";source_root=tmp_path/"source"
 joint_snapshot.snapshot(raw,frozen,offline=True);joint_snapshot.restore(frozen,source_root,offline=True)
 source=Source.load(source_root);volume=tmp_path/"volume";plan=tmp_path/"plan.json"
 value={"format":FORMAT,"schema":"yingxiang_migration","source":str(source.root),"fingerprint":source.fingerprint,
  "snapshot":str(frozen),"snapshotSha256":sha256_file(frozen/"manifest.json"),"storage":str(volume),"batch":"final",
  "target":{},"expiresAt":int(time.time())+600,"offline":True}
 plan.write_text(json.dumps(value));return source,volume,plan,value

def test_valid_frozen_plan(planned):
 source,volume,plan,value=planned
 assert validate_plan(plan,source,volume,"final")["fingerprint"]==source.fingerprint

@pytest.mark.parametrize("field,value",[("offline",False),("expiresAt",0),("fingerprint","changed"),("schema","public"),("batch","other"),("expiresAt",99999999999)])
def test_mismatched_plan_refused(planned,field,value):
 source,volume,plan,body=planned;body[field]=value;plan.write_text(json.dumps(body))
 with pytest.raises(TargetError):validate_plan(plan,source,volume,"final")

def test_changed_frozen_media_refused(planned):
 source,volume,plan,body=planned
 target=next((Path(body["snapshot"])/"users").rglob("result.mp4"));target.write_bytes(b"changed")
 with pytest.raises(TargetError):validate_plan(plan,source,volume,"final")

def test_formal_fault_mode_rejected_before_connect(planned,monkeypatch):
 source,volume,plan,_=planned;monkeypatch.setenv("YINGXIANG_M21A_FAULT","abort-db")
 with pytest.raises(TargetError,match="FORMAL_MODE_INVALID"):
  Target(source,"invalid","yingxiang_migration",volume,"final",formal_plan=plan)

def test_offline_required_before_any_connection(planned,tmp_path):
 source,volume,plan,body=planned
 with pytest.raises(TargetError,match="FORMAL_REQUIRES_OFFLINE"):
  create_plan(source,Path(body["snapshot"]),volume,"final","invalid",tmp_path/"new",offline=False)
 with pytest.raises(TargetError,match="BACKUP_REQUIRES_OFFLINE"):
  snapshot("invalid","yingxiang_migration",volume,tmp_path/"backup",offline=False)
 with pytest.raises(TargetError,match="RESTORE_REQUIRES_OFFLINE"):
  restore("invalid",tmp_path/"backup",volume,offline=False)

def test_credentials_not_in_tool_arguments(monkeypatch):
 monkeypatch.setenv("PGPASSWORD","stale-secret")
 env=tool_env("postgresql://synthetic_user:synthetic_secret@127.0.0.1:5432/db?sslmode=verify-full")
 assert env["PGPASSWORD"]=="synthetic_secret" and env["PGSSLMODE"]=="verify-full"
 assert "stale-secret" not in str(env)
