"""已配置PG上的随机隔离schema＋合成账号／会话；不修改正式业务数据，不调用供应商。"""
from pathlib import Path
from urllib.parse import urlsplit
import hashlib,http.client,json,secrets,socket,subprocess,time,uuid
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

ROOT=Path(__file__).resolve().parents[1]

def main():
    state=json.loads((ROOT/'backups/M22-current.json').read_text(encoding='utf-8-sig'))
    props=json.loads(Path(state['config']).read_text(encoding='utf-8-sig'))
    url=urlsplit(props['spring.datasource.url'].removeprefix('jdbc:'))
    dsn=make_conninfo(host=url.hostname,port=url.port,dbname=url.path.lstrip('/'),user=props['spring.datasource.username'],password=props['spring.datasource.password'],sslmode=props.get('spring.datasource.hikari.data-source-properties.sslmode','disable'))
    schema='yingxiang_migration_it_'+secrets.token_hex(6)
    folder=ROOT/'target'/('garment-it-'+secrets.token_hex(6));folder.mkdir()
    jar=ROOT/'target/yingxiang-backend-0.1.0.jar'
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    config={k:v for k,v in props.items() if k.startswith(('spring.datasource.','spring.data.redis.'))}
    config.update({'migration.db-schema':schema,'migration.public-origin':f'http://127.0.0.1:{port}','migration.maintenance':True,'migration.allow-external-providers':False,'migration.scenes-enabled':False,'migration.stripe-live-enabled':False,'migration.redis-namespace':'yingxiang:migration:garment-it','migration.auth-enabled':True,'migration.account-read-enabled':True,'spring.datasource.hikari.read-only':False,'spring.datasource.hikari.maximum-pool-size':2,'spring.datasource.hikari.minimum-idle':0,'server.port':port})
    path=folder/'test.yml';path.write_text(json.dumps(config),encoding='utf-8')
    count=0;process=None;log=None
    def check(value,label):
        nonlocal count
        if not value:raise AssertionError(label)
        count+=1
    def call(method,path,body=None,owner=None,cookie=None,extra=None):
        headers={'Host':f'127.0.0.1:{port}','Origin':f'http://127.0.0.1:{port}','Content-Type':'application/json',**(extra or {})}
        if owner:headers['X-Garment-Owner']=owner
        if cookie:headers['Cookie']='yingxiang_session='+cookie
        connection=http.client.HTTPConnection('127.0.0.1',port,timeout=15)
        try:
            connection.request(method,path,json.dumps(body) if body is not None else None,headers)
            response=connection.getresponse();raw=response.read();return response.status,json.loads(raw) if raw else None
        finally:connection.close()
    def stop():
        nonlocal process,log
        if process:
            process.terminate()
            try:process.wait(timeout=15)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            process=None
        if log:log.close();log=None
    def start(maintenance=False):
        nonlocal process,log
        log=(folder/('maintenance.log' if maintenance else 'app.log')).open('ab')
        process=subprocess.Popen(['java','-jar',str(jar),f'--spring.config.additional-location=file:{path}',f'--migration.maintenance={str(maintenance).lower()}'],cwd=ROOT,stdout=log,stderr=log)
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            if process.poll() is not None:raise AssertionError('isolated API exited; see private test log')
            try:
                if call('GET','/api/internal/live')[0]==200:return
            except (OSError,TimeoutError,http.client.HTTPException):pass
            time.sleep(.3)
        raise AssertionError('isolated API startup timeout')
    try:
        with psycopg.connect(dsn) as db:
            db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
            db.execute(sql.SQL('COMMENT ON SCHEMA {} IS {}').format(sql.Identifier(schema),sql.Literal('yingxiang-m10b-integration:'+schema)))
        result=subprocess.run(['java','-Dloader.main=cn.yingxiang.manager.SchemaOperations','-cp',str(jar),'org.springframework.boot.loader.launch.PropertiesLauncher','migrate',str(path)],cwd=ROOT,capture_output=True,timeout=60)
        check(result.returncode==0,'V4 isolated Flyway migration')
        users=[str(uuid.uuid4()),str(uuid.uuid4())];tokens=[secrets.token_hex(32),secrets.token_hex(32)]
        with psycopg.connect(dsn) as db:
            for index,user in enumerate(users):
                db.execute(sql.SQL('INSERT INTO {}.users(id,username,salt,password_hash,created_at) VALUES(%s,%s,%s,%s,%s)').format(sql.Identifier(schema)),(user,'garment_test_'+str(index),'synthetic','synthetic',0))
                db.execute(sql.SQL('INSERT INTO {}.auth_sessions(hash,user_id,expires_at) VALUES(%s,%s,%s)').format(sql.Identifier(schema)),(hashlib.sha256(tokens[index].encode()).hexdigest(),user,int(time.time()*1000)+600000))
        start()
        endpoint='/api/garments/SPR-0001/favorite'
        check(call('GET','/api/garments/favorites')[0]==401,'anonymous rejected')
        check(call('GET','/api/garments/favorites',owner=users[0],cookie=tokens[0])[1]['data']['ids']==[],'owner initially empty')
        for _ in range(2):check(call('POST',endpoint,{'favorite':True},users[0],tokens[0])[0]==200,'idempotent save')
        check(call('GET','/api/garments/favorites',owner=users[0],cookie=tokens[0])[1]['data']['ids']==['SPR-0001'],'favorite read')
        check(call('GET','/api/garments/favorites',owner=users[1],cookie=tokens[1])[1]['data']['ids']==[],'second owner isolated')
        check(call('POST',endpoint,{'favorite':False},users[1],tokens[1])[0]==200,'second owner remove idempotent')
        check(call('GET','/api/garments/favorites',owner=users[0],cookie=tokens[0])[1]['data']['ids']==['SPR-0001'],'other owner cannot remove')
        check(call('POST',endpoint,{'favorite':True},users[1],tokens[0])[0]==409,'stale owner header rejected')
        check(call('POST',endpoint,{'favorite':True},users[0],tokens[0],{'Origin':'https://other.invalid'})[0]==403,'cross origin rejected')
        check(call('GET','/api/garments/favorites',owner=users[0],cookie=tokens[0],extra={'Sec-Fetch-Site':'cross-site'})[0]==403,'cross site read rejected')
        for body in [{'favorite':'true'},{'favorite':1},{'favorite':True,'owner':users[1]},{}]:check(call('POST',endpoint,body,users[0],tokens[0])[0]==400,'strict request body')
        check(call('POST','/api/garments/SPR-9999/favorite',{'favorite':True},users[0],tokens[0])[0]==404,'nonexistent catalog id')
        check(call('DELETE',endpoint,owner=users[0],cookie=tokens[0])[0]==405,'unsupported method')
        check(call('POST',endpoint,{'favorite':True},users[0],tokens[0],{'Content-Type':'text/plain'})[0]==415,'content type checked')
        stop();start()
        check(call('GET','/api/garments/favorites',owner=users[0],cookie=tokens[0])[1]['data']['ids']==['SPR-0001'],'restart persistence')
        check(call('POST',endpoint,{'favorite':False},users[0],tokens[0])[0]==200,'remove favorite')
        check(call('GET','/api/garments/favorites',owner=users[0],cookie=tokens[0])[1]['data']['ids']==[],'remove persisted')
        stop();start(True)
        check(call('POST',endpoint,{'favorite':True},users[0],tokens[0])[0]==503,'maintenance blocks writes')
        check(call('GET','/api/garments/favorites',owner=users[0],cookie=tokens[0])[0]==200,'maintenance allows own reads')
        print(json.dumps({'status':'OK','checks':count,'isolatedCloudSchema':True,'formalDataWritten':False,'providerCalls':0}))
    finally:
        stop()
        with psycopg.connect(dsn) as db:
            owner=db.execute('SELECT obj_description(oid,%s) FROM pg_namespace WHERE nspname=%s',('pg_namespace',schema)).fetchone()
            if owner and owner[0]=='yingxiang-m10b-integration:'+schema:db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
        # 测试连接配置不留存；日志仅位于受忽略的target目录。
        path.unlink(missing_ok=True)

if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'status':'FAILED','reason':str(error) if isinstance(error,AssertionError) else type(error).__name__}));raise SystemExit(1)
