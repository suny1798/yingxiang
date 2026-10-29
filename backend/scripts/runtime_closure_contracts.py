"""M20-r: disposable PG/Redis and provider fixtures only; never reads local secrets."""
from pathlib import Path
import importlib, json, secrets, shutil, subprocess, tempfile, time, socket
from scripts.java_import_rehearsal import start_postgres, flyway_yaml

ROOT=Path(__file__).resolve().parents[1]

def main():
    temp=Path(tempfile.mkdtemp(prefix="yingxiang-closure-"))
    pg=None
    redis_name="yingxiang-m17-redis"
    redis_started=False
    try:
        pg,port,password,dsn=start_postgres()
        result=subprocess.run(["docker","run","--rm","-d","--name",redis_name,"-p","127.0.0.1:56379:6379","redis:6-alpine","redis-server","--requirepass","synthetic_redis_password"],capture_output=True)
        if result.returncode: raise RuntimeError("Isolated Redis port/name unavailable")
        redis_started=True
        (temp/"config").mkdir()
        config=temp/"config/application-local.yml"
        flyway_yaml(config,port,password,"yingxiang_migration")
        text=config.read_text().replace('port: 1','port: 56379').replace('password: "synthetic"','password: "synthetic_redis_password"')
        config.write_text(text)
        for name in ["java_worker_contracts","java_worker_lease_contracts","java_redis_gate_contracts","java_full_entry"]:
            module=importlib.import_module("scripts."+name)
            module.BACKEND=temp
            module.CONFIG=config
            module.main()
        runtime_check(temp,config,dsn)
    finally:
        if redis_started: subprocess.run(["docker","rm","-f",redis_name],capture_output=True)
        if pg: subprocess.run(["docker","rm","-f",pg],capture_output=True)
        shutil.rmtree(temp,ignore_errors=True)

def runtime_check(temp,config,dsn):
    import psycopg, http.client
    jar=ROOT/"target/yingxiang-backend-0.1.0.jar"
    command=["java","-Dloader.main=cn.yingxiang.bootstrap.SchemaOperations","-cp",str(jar),"org.springframework.boot.loader.launch.PropertiesLauncher","migrate",str(config)]
    result=subprocess.run(command,cwd=temp,capture_output=True)
    assert result.returncode==0,"runtime schema migration"
    with psycopg.connect(dsn) as db:
        db.execute("INSERT INTO yingxiang_migration.import_batches VALUES ('synthetic','synthetic','test','sealed','{}','{}',0,0)")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]
    common=["java","-jar",str(jar),"--migration.runtime-enabled=true","--migration.allow-external-providers=true","--migration.scenes-enabled=true","--migration.auth-enabled=true","--migration.maintenance=false","--migration.db-schema=yingxiang_migration","--spring.datasource.hikari.read-only=false",f"--server.port={port}","--migration.works-enabled=true",f"--migration.storage-root={temp/'users'}","--migration.studio-enabled=true","--migration.studio-key=dct_synthetic_offline_key","--migration.studio-token-url=https://api.decart.ai/v1/client/tokens","--migration.prompt-enabled=true","--migration.prompt-key=dct_synthetic_offline_key","--migration.prompt-token-url=https://api.decart.ai/v1/client/tokens","--migration.prompt-unlimited-usernames=suny","--migration.prompt-allowed-usernames=suny","--migration.video-enabled=true","--migration.video-provider-url=https://api.decart.ai","--migration.video-key=dct_synthetic_offline_key","--migration.video-budget-usd=5","--migration.video-max-jobs=20","--migration.video-allowed-usernames=suny","--migration.payments-enabled=true","--migration.stripe-api-base=https://api.stripe.com","--migration.stripe-secret=sk_test_synthetic_offline","--migration.stripe-webhook-secret=whsec_synthetic","--migration.stripe-expected-account=acct_synthetic"]
    def call(path):
        c=http.client.HTTPConnection("127.0.0.1",port,timeout=5)
        try:
            c.request("GET",path,headers={"Host":"127.0.0.1:8791"}); r=c.getresponse(); return r.status,json.loads(r.read())
        finally: c.close()
    with tempfile.TemporaryFile() as log:
        process=subprocess.Popen(common,cwd=temp,stdout=log,stderr=log)
        try:
            deadline=time.monotonic()+60
            while True:
                assert process.poll() is None,"runtime startup failed; raw log suppressed"
                try:
                    if call("/api/internal/live")[0]==200: break
                except OSError: pass
                assert time.monotonic()<deadline,"runtime startup timeout"
                time.sleep(.2)
            assert call("/api/internal/ready")[0]==200,"runtime readiness"
            assert call("/api/studio/status")[0]==200,"runtime studio configured"
            assert call("/api/payments/status")[0]==200,"runtime sandbox configured"
            with psycopg.connect(dsn) as db: db.execute("UPDATE yingxiang_migration.import_batches SET status='verified'")
            assert call("/api/internal/ready")[0]==503,"unsealed database rejected"
        finally:
            process.terminate();process.wait(timeout=20)
    with tempfile.TemporaryFile() as log:
        rejected=subprocess.Popen(common,cwd=temp,stdout=log,stderr=log)
        try:
            assert rejected.wait(timeout=60)!=0,"unsealed runtime must reject startup before opening writes"
        finally:
            if rejected.poll() is None: rejected.terminate(); rejected.wait(timeout=20)
    print(json.dumps({"runtimeChecks":5,"realProviderCalls":0,"formalDatabaseTouched":False}))

if __name__=="__main__":main()
