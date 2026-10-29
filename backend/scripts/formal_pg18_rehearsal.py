"""M21-b：仅一次性官方PG18；正式目标模式、最小权限与联合恢复。"""
from __future__ import annotations
import json,secrets,subprocess,tempfile,time,shutil,sqlite3,hashlib,socket,http.client
from pathlib import Path
import psycopg
from psycopg import sql
from ops.source import Source
from ops.synthetic import build,SESSION_A,WORK_REALTIME,USER_A
from ops.target import Target
from ops.formal import create_plan
from ops.contract import EXPECTED_TARGET_TABLES
from ops.errors import TargetError
from ops import pg_backup
from scripts import joint_snapshot
from scripts.java_import_rehearsal import flyway_yaml

ROOT=Path(__file__).resolve().parents[1]
IMAGE="registry-1.docker.io/library/postgres@sha256:41fc5342eefba6cc2ccda736aaf034bbbb7c3df0fdb81516eba1ba33f360162c"
COUNT=0

def check(value,label):
 global COUNT
 COUNT+=1
 assert value,label

def docker(*args,input=None):
 result=subprocess.run(["docker",*args],input=input,capture_output=True,timeout=120)
 if result.returncode:raise RuntimeError("DOCKER_OPERATION_FAILED")
 return result.stdout

def reject(action,code):
 try:action()
 except TargetError as error:check(error.code==code,"controlled rejection "+code)
 else:raise AssertionError("expected rejection "+code)

def main():
 temp=Path(tempfile.mkdtemp(prefix="yingxiang-formal18-"));name="yingxiang-formal18-"+secrets.token_hex(5);started=False
 try:
  password=secrets.token_hex(24);migration_password=secrets.token_hex(24);runtime_password=secrets.token_hex(24)
  docker("run","--rm","-d","--name",name,"-e","POSTGRES_PASSWORD="+password,"-p","127.0.0.1::5432",IMAGE);started=True
  for _ in range(60):
   result=subprocess.run(["docker","exec",name,"pg_isready","-U","postgres"],capture_output=True)
   if result.returncode==0:break
   time.sleep(1)
  port=int(docker("port",name,"5432/tcp").decode().strip().rsplit(":",1)[1])
  admin=f"postgresql://postgres:{password}@127.0.0.1:{port}/postgres"
  dsn=f"postgresql://yingxiang_migrator:{migration_password}@127.0.0.1:{port}/postgres"
  runtime=f"postgresql://yingxiang_runtime:{runtime_password}@127.0.0.1:{port}/postgres"
  with psycopg.connect(admin,autocommit=True) as db:
   check(db.execute("SHOW server_version_num").fetchone()[0]=="180000","actual PG18.0")
   for role,key in [("yingxiang_migrator",migration_password),("yingxiang_runtime",runtime_password)]:
    db.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role),sql.Literal(key)))
   db.execute("GRANT CREATE ON DATABASE postgres TO yingxiang_migrator")
  config=temp/"migration.yml";flyway_yaml(config,port,migration_password,"yingxiang_migration")
  config.write_text(config.read_text().replace('username: "postgres"','username: "yingxiang_migrator"'))
  result=subprocess.run(["java","-Dloader.main=cn.yingxiang.manager.SchemaOperations","-cp",str(ROOT/"target/yingxiang-backend-0.1.0.jar"),"org.springframework.boot.loader.launch.PropertiesLauncher","migrate",str(config)],cwd=ROOT,capture_output=True,timeout=90)
  check(result.returncode==0,"PG18 Flyway V1-V3 by migration role")
  raw=build(temp/"raw")
  with sqlite3.connect(raw/"yingxiang.sqlite3") as db:
   db.execute("UPDATE auth_sessions SET hash=? WHERE hash=?",(hashlib.sha256(("c"*64).encode()).hexdigest(),SESSION_A))
  snapshot=temp/"frozen";source_root=temp/"source"
  joint_snapshot.snapshot(raw,snapshot,offline=True);joint_snapshot.restore(snapshot,source_root,offline=True)
  source=Source.load(source_root);volume=temp/"volume";plan=temp/"formal-plan.json"
  create_plan(source,snapshot,volume,"pg18-final",dsn,plan,offline=True)
  target=Target(source,dsn,"yingxiang_migration",volume,"pg18-final",formal_plan=plan)
  try:
   reject(lambda:Target(source,dsn,"yingxiang_migration",volume,"pg18-final",formal_plan=plan),"IMPORT_ALREADY_RUNNING")
   imported=target.import_source();check(imported["ok"],"formal 19 tables import")
   check(imported["unknown"]["attempts"]==1,"unknown preserved")
   check(imported["prompts"]==1,"prompt bytes preserved")
   check(imported["works"]["deleted"]==1,"deleted tombstone preserved")
   check(target.import_source()["mode"]=="verified-existing","duplicate no increments")
   check(target.seal()["status"]=="sealed","real verified import sealed")
  finally:target.close()
  reject(lambda:Target(source,dsn,"yingxiang_migration",temp/"wrong-volume","pg18-final",formal_plan=plan),"FORMAL_PLAN_INVALID")
  reject(lambda:Target(source,dsn,"yingxiang_migration",volume,"wrong-batch",formal_plan=plan),"FORMAL_PLAN_INVALID")
  reject(lambda:Target(source,admin,"yingxiang_migration",volume,"pg18-final",formal_plan=plan),"FORMAL_TARGET_IDENTITY_MISMATCH")
  reject(lambda:Target(source,dsn,"yingxiang_migration",volume,"pg18-final",formal_plan=plan,rehearsal=True),"FORMAL_MODE_INVALID")
  with psycopg.connect(dsn,autocommit=True) as db:
   db.execute("GRANT USAGE ON SCHEMA yingxiang_migration TO yingxiang_runtime")
   db.execute("GRANT SELECT ON ALL TABLES IN SCHEMA yingxiang_migration TO yingxiang_runtime")
   for table in set(EXPECTED_TARGET_TABLES)-{"flyway_schema_history","import_batches","import_batch_objects"}:
    db.execute(sql.SQL("GRANT INSERT,UPDATE,DELETE ON yingxiang_migration.{} TO yingxiang_runtime").format(sql.Identifier(table)))
  with psycopg.connect(runtime) as db:
   check(db.execute("SELECT count(*) FROM yingxiang_migration.users").fetchone()[0]==2,"runtime reads imported users");db.rollback()
   for statement in ["CREATE TABLE yingxiang_migration.permission_probe(x int)","CREATE SCHEMA permission_probe","UPDATE yingxiang_migration.import_batches SET status=status","DELETE FROM yingxiang_migration.flyway_schema_history"]:
    denied=False
    try:db.execute(statement)
    except psycopg.errors.InsufficientPrivilege:denied=True
    finally:db.rollback()
    check(denied,"runtime DDL/import metadata denied")
   db.execute("UPDATE yingxiang_migration.works SET favorite=favorite WHERE state='ready'");db.rollback();check(True,"runtime business DML allowed")
  # 最小权限运行账号实际启动Java；仅读取导入的合成会话与媒体，不调用供应商。
  (temp/"config").mkdir()
  runtime_config=temp/"config/application-local.yml";flyway_yaml(runtime_config,port,runtime_password,"yingxiang_migration")
  runtime_config.write_text(runtime_config.read_text().replace('username: "postgres"','username: "yingxiang_runtime"'))
  with socket.socket() as sock:
   sock.bind(("127.0.0.1",0));api_port=sock.getsockname()[1]
  with tempfile.TemporaryFile() as log:
   process=subprocess.Popen(["java","-jar",str(ROOT/"target/yingxiang-backend-0.1.0.jar"),f"--server.port={api_port}",
      "--migration.runtime-enabled=true","--migration.auth-enabled=true","--migration.maintenance=false",
      "--migration.works-enabled=true",f"--migration.storage-root={volume/'users'}"],cwd=temp,stdout=log,stderr=log)
   def call(path,headers=None):
    connection=http.client.HTTPConnection("127.0.0.1",api_port,timeout=5)
    try:
     connection.request("GET",path,headers={"Host":"127.0.0.1:8791",**(headers or {})});response=connection.getresponse()
     return response.status,response.read()
    finally:connection.close()
   try:
    deadline=time.monotonic()+60
    while True:
     assert process.poll() is None,"least privilege Java startup failed; raw log suppressed"
     try:
      if call("/api/internal/live")[0]==200:break
     except OSError:pass
     if time.monotonic()>deadline:raise AssertionError("least privilege startup deadline")
     time.sleep(.2)
    check(call("/api/internal/ready")[0]==200,"least privilege readiness and Flyway validate")
    (volume/"INCOMPLETE").touch()
    check(call("/api/internal/ready")[0]==503,"incomplete joint restore cannot be ready")
    (volume/"INCOMPLETE").unlink()
    check(call("/api/internal/ready")[0]==200,"completed private volume ready again")
    status,body=call("/api/account/me",{"Cookie":"yingxiang_session="+"c"*64})
    check(status==200 and json.loads(body)["user"]["id"]==USER_A,"imported compatible session reads account")
    status,body=call(f"/api/works/{WORK_REALTIME}/content",{"Cookie":"yingxiang_session="+"c"*64,"Range":"bytes=0-9"})
    check(status==206 and len(body)==10,"imported private media authorized Range")
   finally:
    process.terminate();process.wait(timeout=20)
  def runner(tool,args,dsn,*,output=None,input_path=None):
   command=["docker","exec","-i",name,tool,"-U","postgres"]+args
   if tool=="pg_dump":command += ["--dbname=postgres"]
   result=subprocess.run(command,input=input_path.read_bytes() if input_path else None,capture_output=True,timeout=90)
   check(result.returncode==0,"official "+tool)
   if output:output.write_bytes(result.stdout)
  backup=temp/"pg-joint"
  check(pg_backup.snapshot(dsn,"yingxiang_migration",volume,backup,offline=True,runner=runner)["ok"],"PG and media joint backup")
  check(pg_backup.verify(backup)["format"]==pg_backup.FORMAT,"backup verifies")
  with psycopg.connect(admin,autocommit=True) as db:db.execute("CREATE DATABASE restored")
  restored=admin.rsplit("/",1)[0]+"/restored";restored_volume=temp/"restored-volume"
  check(pg_backup.restore(restored,backup,restored_volume,offline=True,runner=runner)["ok"],"restore fresh DB and private volume")
  restored_plan=temp/"restored-plan.json";create_plan(source,snapshot,restored_volume,"pg18-final",restored,restored_plan,offline=True)
  target=Target(source,restored,"yingxiang_migration",restored_volume,"pg18-final",formal_plan=restored_plan)
  try:check(target.verify()["ok"],"restored rows balances unknown files and tombstones equal")
  finally:target.close()
  reject(lambda:pg_backup.restore(restored,backup,temp/"another-volume",offline=True,runner=runner),"RESTORE_TARGET_SCHEMA_EXISTS")
  (backup/"users"/next(iter((backup/"users").iterdir())).name/"tampered").write_bytes(b"x")
  reject(lambda:pg_backup.verify(backup),"BACKUP_VERIFY_FAILED")
  print(json.dumps({"ok":True,"checks":COUNT,"serverVersionNumber":180000,"realProviderCalls":0,"formalCloudWrites":0,"minimumPrivilegeRoles":True,"jointPgMediaRestore":True}))
 finally:
  if started:subprocess.run(["docker","rm","-f",name],capture_output=True)
  shutil.rmtree(temp,ignore_errors=True)
if __name__=="__main__":main()
