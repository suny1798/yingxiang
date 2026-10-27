"""M12-a：两个独立JVM／真实PG的权益竞争与原SQLite状态对照；不调用供应商。"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import secrets
import subprocess
import tempfile
from uuid import uuid4

from sqlalchemy import insert, select, update, text
from app.accounts import Accounts
from app.core import BusinessError, Settings, UUID
from app.db import Database
from app.models import metadata, users, grants, attempts, entries
from scripts.ops import initialize
from scripts.java_account_contracts import BACKEND, fixtures, java_fixture


def call(action, schema, payload):
    result = subprocess.run(['java', '-Duser.language=en', '-Duser.country=US',
        '-Dlogback.configurationFile=migration-probe-logback.xml',
        '-Dloader.main=cn.yingxiang.bootstrap.AccountIntegrationFixture', '-cp', str(BACKEND/'target/yingxiang-backend-0.1.0.jar'),
        'org.springframework.boot.loader.launch.PropertiesLauncher', action, str(BACKEND/'config/application-local.yml'), schema],
        cwd=BACKEND, input=json.dumps(payload).encode(), capture_output=True, timeout=60)
    try: report = json.loads(result.stdout)
    except Exception: raise AssertionError('Quota fixture output suppressed') from None
    assert result.returncode in (0, 1, 2), 'Unexpected quota process exit'
    assert report.get('status') in {'OK', 'DOMAIN_REJECTED', 'FIXTURE_FAILED'}, 'Unexpected quota report'
    return report


def old_snapshot(db, name):
    with db.transaction() as session:
        user_id = session.execute(select(users.c.id).where(users.c.username == name)).scalar_one()
        gs = session.execute(select(grants).where(grants.c.user_id == user_id).order_by(grants.c.id)).mappings().all()
        aa = session.execute(select(attempts).where(attempts.c.user_id == user_id).order_by(attempts.c.id)).mappings().all()
        ee = session.execute(select(entries).join(grants, grants.c.id == entries.c.grant_id).where(grants.c.user_id == user_id).order_by(entries.c.operation_key)).mappings().all()
        return {'grants': [{key:r[key] for key in ('id','seconds','environment','total','reserved','used','revoked')} for r in gs],
                'attempts': [{'id':r['id'],'seconds':r['seconds'],'state':r['state'],'accountState':r['account_state']} for r in aa],
                'entries': [{'operationKey':r['operation_key'],'kind':r['kind'],'quantity':r['quantity']} for r in ee]}


def main():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    tables, ids, tokens = fixtures()
    hashed = [hashlib.sha256(token.encode()).hexdigest() for token in tokens]
    tables['usage_attempts'] = []
    tables['entitlement_grants'] = []
    for owner, seconds, total, environment in [(0,15,1,'real_usage'),(0,30,2,'real_usage'),(1,15,99,'stripe_sandbox'),(1,30,1,'real_usage')]:
        tables['entitlement_grants'].append({'id':str(uuid4()),'user_id':ids[owner],'seconds':seconds,'environment':environment,
            'source':'synthetic','source_key':str(uuid4()),'total':total,'reserved':0,'used':0,'revoked':0})
    created = False
    checks = 0
    try:
        java_fixture('setup', schema, {'tables':tables}); created = True
        with tempfile.TemporaryDirectory(prefix='yingxiang-m12a-contract-') as directory:
            settings = Settings(data_dir=Path(directory), maintenance=True)
            initialize(settings); db = Database(settings.database); accounts = Accounts(db)
            try:
                with db.transaction(True) as session:
                    for name, rows in tables.items():
                        if rows: session.execute(insert(metadata.tables[name]), rows)

                def oracle(action, payload):
                    try:
                        ident = payload['attemptId']
                        if not isinstance(ident,str) or not UUID.fullmatch(ident):
                            raise BusinessError('INVALID_REQUEST','体验编号或云端处理确认无效，请重新确认。')
                        if action == 'quota-reserve':
                            if payload['seconds'] not in (15,30,60): raise BusinessError('INVALID_DURATION','请选择15秒、30秒或1分钟。')
                            with db.transaction(True) as session: accounts.reserve(session,payload['hashed'],ident,payload['seconds'])
                        else: accounts.issued(ident)
                        return {'status':'OK'}
                    except BusinessError as error: return {'status':'DOMAIN_REJECTED','code':error.code,'httpStatus':error.status,'message':error.message}
                    except Exception: return {'status':'FIXTURE_FAILED'}

                def compare(action,payload,label):
                    nonlocal checks
                    actual,expected = call(action,schema,payload),oracle(action,payload)
                    assert {key:actual.get(key) for key in expected} == expected, label+': outcome differs (payload suppressed)'
                    checks += 1
                    return actual

                def state(owner=0):
                    nonlocal checks
                    name='m10b_synthetic_'+str(owner)
                    actual=call('quota-state',schema,{'username':name})
                    expected=old_snapshot(db,name)
                    assert actual['status']=='OK'
                    assert {key:actual[key] for key in expected} == expected, 'Quota ledger/state differs from SQLite'
                    checks += 1
                    return actual

                for actor, seconds in [('',15),(hashed[2],15),(hashed[3],15),(hashed[1],15),(hashed[0],60)]:
                    compare('quota-reserve',{'hashed':actor,'attemptId':str(uuid4()),'seconds':seconds},'identity-or-duration')
                compare('quota-reserve',{'hashed':hashed[0],'attemptId':'invalid','seconds':15},'invalid-attempt')
                compare('quota-reserve',{'hashed':hashed[0],'attemptId':str(uuid4()),'seconds':45},'invalid-duration')
                state(0);state(1)
                print(json.dumps({'phase':'identity-and-sandbox','checks':checks}),flush=True)

                ids_race=[str(uuid4()),str(uuid4())]
                payloads=[{'hashed':hashed[0],'attemptId':ident,'seconds':15} for ident in ids_race]
                with ThreadPoolExecutor(max_workers=2) as executor:
                    results=list(executor.map(lambda payload:call('quota-reserve',schema,payload),payloads))
                winners=[i for i,result in enumerate(results) if result['status']=='OK']
                assert len(winners)==1 and sorted(result['status'] for result in results)==['DOMAIN_REJECTED','OK']
                winner=winners[0];loser=1-winner
                assert results[loser]['code']=='TRIAL_USED'
                assert oracle('quota-reserve',payloads[winner])['status']=='OK'
                assert oracle('quota-reserve',payloads[loser])['code']=='TRIAL_USED'
                checks += 2
                snapshot=state();attempt_id=ids_race[winner]
                assert snapshot['attempts'][0]['state']=='unknown' and snapshot['attempts'][0]['accountState']=='review'
                # 每次CLI是独立JVM；新进程读取仍保留unknown和reserved，不依赖进程内缓存。
                compare('quota-reserve',payloads[winner],'duplicate-attempt')
                compare('quota-reserve',{'hashed':hashed[0],'attemptId':str(uuid4()),'seconds':15},'unknown-keeps-quota')
                state()
                print(json.dumps({'phase':'last-entitlement-race-and-unknown','checks':checks}),flush=True)

                with ThreadPoolExecutor(max_workers=2) as executor:
                    results=list(executor.map(lambda _:call('quota-confirm',schema,{'attemptId':attempt_id}),range(2)))
                assert all(result['status']=='OK' for result in results)
                assert sorted(result['transitionApplied'] for result in results)==[False,True]
                assert oracle('quota-confirm',{'attemptId':attempt_id})['status']=='OK'
                checks += 2
                state()
                compare('quota-confirm',{'attemptId':attempt_id},'repeat-confirm')
                state()

                alice30,bob30 = str(uuid4()),str(uuid4())
                compare('quota-reserve',{'hashed':hashed[0],'attemptId':alice30,'seconds':30},'alice-reserve')
                compare('quota-reserve',{'hashed':hashed[1],'attemptId':alice30,'seconds':30},'other-user-cannot-repeat-id')
                compare('quota-reserve',{'hashed':hashed[1],'attemptId':bob30,'seconds':30},'bob-own-grant')
                state(0);state(1)
                java_fixture('disable',schema,{'userId':ids[0]})
                with db.transaction(True) as session: session.execute(update(users).where(users.c.id==ids[0]).values(disabled=1))
                compare('quota-reserve',{'hashed':hashed[0],'attemptId':str(uuid4()),'seconds':30},'pause-rechecked')

                java_fixture('fail-free-grant',schema)
                with db.transaction(True) as session:
                    session.execute(text("CREATE TRIGGER reject_test_grant BEFORE INSERT ON entitlement_entries BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END"))
                compare('quota-confirm',{'attemptId':alice30},'confirmation-failure-rollback')
                state(0)
                java_fixture('restore-free-grant',schema)
                with db.transaction(True) as session: session.execute(text('DROP TRIGGER reject_test_grant'))
                # 已接受上游操作的确认不因后来停用而退回unknown占用；只由内部可信适配器调用。
                compare('quota-confirm',{'attemptId':alice30},'confirmation-after-accepted-reservation')
                state(0);state(1)
                print(json.dumps({'phase':'confirmation-rollback-and-ownership','checks':checks}),flush=True)
            finally: db.close()
    finally:
        if created: java_fixture('cleanup',schema)
    print(json.dumps({'status':'PASSED','checks':checks,'independentJvmRace':True,'reservationWinners':1,
        'confirmationWinners':1,'unknownRetained':True,'temporarySchemaRemoved':created,'providerCalls':0}))


if __name__=='__main__':main()
