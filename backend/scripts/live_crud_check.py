"""显式正式库CRUD验收：只创建/清理本轮临时账号与作品，不调用供应商。"""
import argparse,hashlib,http.client,json,secrets,time,uuid
from pathlib import Path
from urllib.parse import urlsplit
import psycopg
from psycopg.conninfo import make_conninfo

def main():
 parser=argparse.ArgumentParser();parser.add_argument("--state",type=Path,required=True);parser.add_argument("--confirm-live",action="store_true");args=parser.parse_args()
 assert args.confirm_live,"explicit live mode required"
 state=json.loads(args.state.read_text(encoding="utf-8-sig"));assert state.get("writeBoundaryAt"),"write boundary missing"
 props=json.loads(Path(state["config"]).read_text());url=urlsplit(props["spring.datasource.url"].removeprefix("jdbc:"))
 dsn=make_conninfo(host=url.hostname,port=url.port,dbname=url.path.lstrip("/"),user=props["spring.datasource.username"],password=props["spring.datasource.password"],sslmode=props.get("spring.datasource.hikari.data-source-properties.sslmode","disable"))
 checks=0;user=None;original_session=None;name="m22check_"+secrets.token_hex(5)
 def call(method,path,body=None,cookie=None,extra=None):
  headers={"Host":"127.0.0.1:8787","Origin":"http://127.0.0.1:8787","Content-Type":"application/json",**(extra or {})}
  if cookie:headers["Cookie"]=cookie
  connection=http.client.HTTPConnection("127.0.0.1",8792,timeout=15)
  try:
   connection.request(method,path,body=json.dumps(body).encode() if body is not None else None,headers=headers)
   response=connection.getresponse();data=response.read();return response.status,dict(response.getheaders()),data
  finally:connection.close()
 def check(value,label):
  nonlocal checks
  assert value,label
  checks+=1
 try:
  result=call("POST","/api/account/register",{"username":name,"password":secrets.token_urlsafe(24)})
  check(result[0]==200,"register on Java cloud DB")
  view=json.loads(result[2]);user=view["user"]["id"];cookie=result[1]["Set-Cookie"].split(";",1)[0]
  state["crudUser"]={"id":user,"username":name};args.state.write_text(json.dumps(state))
  result=call("GET","/api/account/me",cookie=cookie);check(result[0]==200 and json.loads(result[2])["user"]["id"]==user,"read registered account")
  work=str(uuid.uuid4());owner={"X-Work-Owner":user}
  result=call("POST","/api/works",{"id":work,"kind":"realtime","mime":"video/webm","seconds":15,"ownerId":user},cookie,owner)
  check(result[0]==201,"create work without generation")
  result=call("GET","/api/works/"+work,cookie=cookie);check(result[0]==200,"read own work")
  result=call("POST","/api/works/"+work,{"title":"M22 CRUD check"},cookie);check(result[0]==200 and json.loads(result[2])["title"]=="M22 CRUD check","update work title")
  result=call("POST","/api/works/"+work,{"favorite":True},cookie);check(result[0]==200 and json.loads(result[2])["favorite"] is True,"update favorite")
  check(call("GET","/api/works?favorite=true",cookie=cookie)[0]==200,"query filtered works")
  check(call("GET","/api/works/"+work)[0]==401,"anonymous cannot read private work")
  check(call("POST","/api/works/"+work+"/complete",{},cookie,owner)[0]==202,"finish empty synthetic recording")
  check(call("POST","/api/works/"+work,{"action":"delete"},cookie)[0]==200,"delete synthetic work")
  check(call("GET","/api/works/"+work,cookie=cookie)[0]==404,"deleted work no longer readable")
  check(call("POST","/api/account/logout",{},cookie)[0]==200,"logout")
  # 短期内部检查会话，仅用于验证已迁移账号和已有媒体，不返回会话或用户标识。
  with psycopg.connect(dsn) as db:
   row=db.execute("SELECT user_id,id FROM yingxiang_migration.works WHERE state='ready' ORDER BY created_at LIMIT 1").fetchone()
   token=secrets.token_hex(32);original_session=hashlib.sha256(token.encode()).hexdigest()
   db.execute("INSERT INTO yingxiang_migration.auth_sessions(hash,user_id,expires_at) VALUES (%s,%s,%s)",(original_session,row[0],int(time.time()*1000)+60000))
  oldcookie="yingxiang_session="+token
  result=call("GET","/api/account/me",cookie=oldcookie);check(result[0]==200 and json.loads(result[2])["user"]["id"]==row[0],"migrated account reads through Java")
  result=call("GET","/api/works/"+row[1]+"/content",cookie=oldcookie,extra={"Range":"bytes=0-9"})
  check(result[0]==206 and len(result[2])==10,"migrated media authenticated Range")
 finally:
  with psycopg.connect(dsn) as db:
   if original_session:db.execute("DELETE FROM yingxiang_migration.auth_sessions WHERE hash=%s",(original_session,))
   if user:
    assert db.execute("SELECT username FROM yingxiang_migration.users WHERE id=%s",(user,)).fetchone()==(name,),"cleanup identity mismatch"
    db.execute("DELETE FROM yingxiang_migration.background_tasks WHERE user_id=%s",(user,))
    db.execute("DELETE FROM yingxiang_migration.work_references WHERE work_id IN (SELECT id FROM yingxiang_migration.works WHERE user_id=%s)",(user,))
    db.execute("DELETE FROM yingxiang_migration.works WHERE user_id=%s",(user,))
    db.execute("DELETE FROM yingxiang_migration.auth_sessions WHERE user_id=%s",(user,))
    db.execute("DELETE FROM yingxiang_migration.entitlement_entries WHERE grant_id IN (SELECT id FROM yingxiang_migration.entitlement_grants WHERE user_id=%s)",(user,))
    db.execute("DELETE FROM yingxiang_migration.entitlement_grants WHERE user_id=%s",(user,))
    db.execute("DELETE FROM yingxiang_migration.users WHERE id=%s",(user,))
    db.execute("DELETE FROM yingxiang_migration.auth_rate_limits WHERE key=%s",("auth:"+name,))
    db.execute("DELETE FROM yingxiang_migration.rate_limit_shadows WHERE key=%s",("auth:"+name,))
  state.pop("crudUser",None);state["crudChecks"]=checks;state["crudCleanupComplete"]=True;args.state.write_text(json.dumps(state))
 print(json.dumps({"crudChecks":checks,"temporaryDataCleaned":True,"realProviderCalls":0,"payments":0}))
if __name__=="__main__":main()
