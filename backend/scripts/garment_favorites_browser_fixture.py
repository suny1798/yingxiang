"""实际入口的临时合成账号浏览器验证；自动清理后核对全部业务表指纹。"""
from pathlib import Path
from urllib.parse import urlsplit
import hashlib,json,secrets,subprocess,time,uuid
import psycopg
from psycopg.conninfo import make_conninfo
from ops.pg_backup import inspect

ROOT=Path(__file__).resolve().parents[1]

def main():
    state=json.loads((ROOT/'backups/M22-current.json').read_text(encoding='utf-8-sig'));props=json.loads(Path(state['config']).read_text(encoding='utf-8-sig'));url=urlsplit(props['spring.datasource.url'].removeprefix('jdbc:'))
    dsn=make_conninfo(host=url.hostname,port=url.port,dbname=url.path.lstrip('/'),user=props['spring.datasource.username'],password=props['spring.datasource.password'],sslmode=props.get('spring.datasource.hikari.data-source-properties.sslmode','disable'))
    fixture=ROOT/'backups/garment-browser-fixture.json';assert not fixture.exists(),'Previous fixture must be cleaned first'
    before=inspect(dsn,'yingxiang_migration');users=[str(uuid.uuid4()),str(uuid.uuid4())];tokens=[secrets.token_hex(32),secrets.token_hex(32)]
    fixture.write_text(json.dumps({'users':users,'tokens':tokens}),encoding='utf-8')
    state_files=[]
    for index,token in enumerate(tokens):
        file=ROOT/'backups'/f'garment-browser-state-{index}.json'
        cookie=lambda name,value,httpOnly=False:{'name':name,'value':value,'domain':'127.0.0.1','path':'/','httpOnly':httpOnly,'secure':False,'sameSite':'Lax','expires':int(time.time())+900}
        file.write_text(json.dumps({'cookies':[cookie('yingxiang_session',token,True),cookie('yingxiang-locale','zh'),cookie('yingxiang-theme','light')],'origins':[]}),encoding='utf-8');state_files.append(file)
    frontend=ROOT.parent/'frontend';log=frontend/'output/garment-favorites-browser.log';code=1
    try:
        with psycopg.connect(dsn) as db:
            for index,user in enumerate(users):
                db.execute('INSERT INTO yingxiang_migration.users(id,username,salt,password_hash,created_at) VALUES(%s,%s,%s,%s,%s)',(user,'favorite_test_'+secrets.token_hex(4),'synthetic','synthetic',0))
                db.execute('INSERT INTO yingxiang_migration.auth_sessions(hash,user_id,expires_at) VALUES(%s,%s,%s)',(hashlib.sha256(tokens[index].encode()).hexdigest(),user,int(time.time()*1000)+900000))
        command=['npx.cmd','--yes','--package','@playwright/cli','playwright-cli','-s=wardrobe']
        for phase,index in [('guest',None),('a',0),('b',1),('verify-a',0)]:
            if index is None:
                loaded=subprocess.run([*command,'cookie-delete','yingxiang_session'],cwd=frontend,capture_output=True,timeout=30)
            else:
                loaded=subprocess.run([*command,'state-load',str(state_files[index])],cwd=frontend,capture_output=True,timeout=30)
            assert loaded.returncode==0,'Browser state load failed'
            navigation=subprocess.run([*command,'goto',f'http://127.0.0.1:8787/wardrobe?favorite-test={phase}'],cwd=frontend,capture_output=True,timeout=30)
            assert navigation.returncode==0,'Browser navigation failed'
            phase_log=frontend/'output'/f'garment-favorites-browser-{phase}.log'
            with phase_log.open('wb') as out:
                result=subprocess.run([*command,'run-code','--filename','scripts/browser/garment-favorites-check.js'],cwd=frontend,stdout=out,stderr=out,timeout=120)
            assert result.returncode==0,'Browser phase failed: '+phase
        code=0
    finally:
        with psycopg.connect(dsn) as db:
            db.execute('DELETE FROM yingxiang_migration.auth_sessions WHERE user_id=ANY(%s)',(users,))
            db.execute('DELETE FROM yingxiang_migration.users WHERE id=ANY(%s)',(users,))
        fixture.unlink(missing_ok=True)
        for file in state_files:file.unlink(missing_ok=True)
        unchanged=before==inspect(dsn,'yingxiang_migration')
        print(json.dumps({'browserExit':code,'syntheticAccountsRemoved':True,'allTablesUnchangedAfterCleanup':unchanged,'providerCalls':0}))
        assert unchanged,'Business table fingerprints changed during test; inspect private evidence'
    assert code==0,'Browser check failed; see ignored log'

if __name__=='__main__':main()
