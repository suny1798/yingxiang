"""M12-b3：仅本机替身，临时PG＋实际Jar与原FastAPI/SQLite的签发观测对照。"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import tempfile
import threading
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import insert, select, text
from app.core import Settings, iso, now_ms
from app.db import Database
from app.generation import Generation, STUDIO
from app.main import create_app
from app.models import metadata, attempts, admin_settings
from scripts.ops import initialize
from scripts.java_account_contracts import fixtures, java_fixture, ORIGIN
from scripts.java_auth_contracts import LiveJava
from scripts.java_quota_contracts import old_snapshot
from scripts.java_quota_contracts import call as quota_call

KEY = 'synthetic-studio-permanent-key'


class Stub:
    def __init__(self):
        self.calls, self.old_calls, self.errors = 0, 0, []
        self.accepted, self.release = threading.Event(), threading.Event()
        self.mode, self.token = 'valid', {}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass

            def do_POST(self):
                owner.calls += 1
                request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path != '/v1/client/tokens' or self.headers.get('X-API-KEY') != KEY:
                    owner.errors.append('invalid request path/key')
                owner.check_request(request)
                if owner.mode == 'crash':
                    owner.accepted.set()
                    if not owner.release.wait(10): owner.errors.append('crash fixture deadline')
                status, body = owner.response()
                if owner.mode == 'disconnect': self.close_connection = True; return
                try:
                    self.send_response(status)
                    if status == 302: self.send_header('Location', '/v1/client/tokens')
                    self.send_header('Content-Length', str(len(body))); self.end_headers()
                    self.wfile.write(body)
                except OSError:
                    if owner.mode not in ('crash', 'oversize'): owner.errors.append('unexpected fixture disconnect')

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def check_request(self, body):
        expected = {'expiresIn': 10, 'allowedModels': [STUDIO['model']], 'allowedOrigins': [ORIGIN],
                    'constraints': {'realtime': {'maxSessionDuration': self.seconds}}}
        if body != expected: self.errors.append('scope mismatch')

    def response(self):
        token = deepcopy(self.token)
        if self.mode == 'permanent': token['apiKey'] = KEY
        elif self.mode == 'model': token['permissions']['models'].append('extra-model')
        elif self.mode == 'origin': token['permissions']['origins'] = ['https://wrong.invalid']
        elif self.mode == 'duration': token['constraints']['realtime']['maxSessionDuration'] = self.seconds + 1
        elif self.mode == 'expired': token['expiresAt'] = iso(now_ms() - 1)
        elif self.mode == 'ttl': token['expiresAt'] = iso(now_ms() + 60_000)
        if self.mode == 'oversize': return 200, b'{"padding":"' + b'x' * 16_385 + b'"}'
        if self.mode == 'malformed': return 200, b'{broken'
        if self.mode == 'redirect': return 302, b'{}'
        if self.mode == 'rejected': return 403, b'{}'
        return 200, json.dumps(token).encode()

    def old(self, request):
        self.old_calls += 1
        assert request.headers['x-api-key'] == KEY
        self.check_request(json.loads(request.content))
        if self.mode in ('disconnect', 'crash'): raise httpx.ReadError('synthetic disconnect')
        status, body = self.response()
        return httpx.Response(status, content=body, headers={'Location': '/v1/client/tokens'} if status == 302 else {})

    def __enter__(self): self.thread.start(); return self
    def __exit__(self, *args): self.release.set(); self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=5)


def main():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    tables, ids, tokens = fixtures()
    tables['usage_attempts'] = []
    tables['entitlement_grants'] = []
    for owner, seconds, environment in [(0, 15, 'real_usage'), (0, 30, 'real_usage'), (1, 15, 'stripe_sandbox')]:
        tables['entitlement_grants'].append({'id': str(uuid4()), 'user_id': ids[owner], 'seconds': seconds, 'environment': environment,
            'source': 'synthetic', 'source_key': str(uuid4()), 'total': 100, 'reserved': 0, 'used': 0, 'revoked': 0})
    count, created, stub_calls = 0, False, 0
    try:
        java_fixture('setup', schema, {'tables': tables}); created = True
        with tempfile.TemporaryDirectory(prefix='yingxiang-m12b-contract-') as temporary, ExitStack() as stack:
            settings = Settings(data_dir=Path(temporary), public_origin=ORIGIN, allowed_origins=(ORIGIN,), maintenance=False,
                                env={'YINGXIANG_STUDIO_ENABLED': 'true', 'DECART_API_KEY': KEY})
            initialize(settings)
            db = Database(settings.database); stack.callback(db.close)
            with db.transaction(True) as session:
                for name, rows in tables.items():
                    if rows: session.execute(insert(metadata.tables[name]), rows)
            stub = stack.enter_context(Stub())
            upstream = httpx.AsyncClient(transport=httpx.MockTransport(stub.old), follow_redirects=False)
            stack.callback(lambda: asyncio.run(upstream.aclose()))
            app = create_app(settings); stack.callback(app.state.db.close)
            app.state.generation = Generation(db, app.state.accounts, settings, upstream)
            old = TestClient(app, base_url=ORIGIN); stack.callback(old.close)  # 不启动后台Worker。
            overrides = {'migration.studio-fixture-enabled': 'true',
                'migration.studio-fixture-url': f'http://127.0.0.1:{stub.server.server_port}/v1/client/tokens'}
            jvm_options = ['-Djdk.httpclient.disableRetryConnect=true', '-Djdk.httpclient.enableAllMethodRetry=false']
            server = stack.enter_context(LiveJava(schema, overrides, jvm_options=jvm_options))
            access_old = old.get('/api/studio/status').json()['access']
            status, _, raw_status = server.request('GET', '/api/studio/status')
            assert status == 200
            access_java = json.loads(raw_status)['access']

            def normalize(body):
                value = deepcopy(body)
                if 'requestId' in value: value['requestId'] = '<request-id>'
                if 'access' in value: value['access'] = '<access>'
                return value

            def compare(label, payload=None, *, path='/api/studio/token', method='POST', raw=None, owner=0, headers=None, access=True):
                nonlocal count
                body = raw if raw is not None else json.dumps(payload).encode() if payload is not None else None
                common = {'Host': '127.0.0.1:8791', 'Origin': ORIGIN, 'Content-Type': 'application/json', **(headers or {})}
                h_old = {**common, 'X-Studio-Access': access_old if access else 'invalid'}
                h_java = {**common, 'X-Studio-Access': access_java if access else 'invalid'}
                cookie = f'yingxiang_session={tokens[owner]}' if owner is not None else None
                old.cookies.clear()
                if cookie: h_old['Cookie'] = cookie
                expected = old.request(method, path, content=body, headers={k:v for k,v in h_old.items() if v is not None})
                status, actual_headers, data = server.request(method, path, body, cookie, h_java)
                assert status == expected.status_code, label + ': HTTP status mismatch'
                actual = json.loads(data)
                assert normalize(actual) == normalize(expected.json()), label + ': JSON mismatch; raw payload suppressed'
                for key in ('content-type', 'cache-control', 'x-content-type-options'):
                    assert actual_headers.get(key) == expected.headers.get(key), label + ': header mismatch'
                assert not {'set-cookie', 'www-authenticate', 'location'} & actual_headers.keys(), label + ': unexpected auth response'
                count += 1
                return actual

            def request_body(seconds=15):
                return {'attemptId': str(uuid4()), 'consentVersion': STUDIO['consentVersion'], 'durationSec': seconds}

            compare('status-ready', method='GET', path='/api/studio/status', owner=None)
            compare('anonymous-before-body', raw=b'{broken', owner=None)
            compare('access-before-body', raw=b'{broken', access=False)
            compare('expired-session', request_body(), owner=2)
            compare('disabled-user', request_body(), owner=3)
            compare('wrong-origin', request_body(), headers={'Origin': 'https://wrong.invalid'})
            compare('wrong-host', request_body(), headers={'Host': 'wrong.invalid'})
            compare('missing-origin', request_body(), headers={'Origin': None})
            for raw in [b'[]', b'{} {}', b'{broken', b'\xff', b'\xef\xbb\xbf{}', b'{' + b'x' * 4096]:
                compare('invalid-body', raw=raw)
            compare('wrong-content-type', {}, headers={'Content-Type': 'text/plain'})
            for invalid in [{}, {**request_body(), 'attemptId':'bad'}, {**request_body(), 'consentVersion':'bad'}, {**request_body(), 'extra':True}]:
                compare('invalid-consent-or-id', invalid)
            for duration in [None, True, '15', 15.1, 0, 120]: compare('invalid-duration', request_body(duration))
            compare('missing-duration-quota', request_body(60))
            compare('sandbox-isolated', request_body(), owner=1)

            unknowns = []
            for mode, seconds in [('valid', 15), ('valid', 30), ('permanent', 15), ('model', 15), ('origin', 15), ('duration', 15),
                                  ('expired', 15), ('ttl', 15), ('oversize', 15), ('malformed', 15), ('redirect', 15), ('rejected', 15), ('disconnect', 15)]:
                stub.mode, stub.seconds = mode, seconds
                stub.token = {'apiKey':'synthetic-client-key', 'expiresAt':iso(now_ms()+10_000),
                    'permissions':{'models':[STUDIO['model']], 'origins':[ORIGIN]}, 'constraints':{'realtime':{'maxSessionDuration':seconds}}}
                body = request_body(seconds)
                if mode == 'valid' and seconds == 15: body.pop('durationSec')
                before = stub.calls, stub.old_calls
                actual = compare('issue-' + mode, body)
                assert (stub.calls, stub.old_calls) == (before[0]+1, before[1]+1), 'must make exactly one POST'
                assert ('apiKey' in actual) == (mode == 'valid')
                compare('duplicate-no-post', body)
                assert (stub.calls, stub.old_calls) == (before[0]+1, before[1]+1), 'duplicate sent another POST'
                if mode != 'valid': unknowns.append(body['attemptId'])
                elif seconds == 15: success = body['attemptId']

            stub.mode, stub.seconds = 'valid', 15
            stub.token['expiresAt'] = iso(now_ms()+10_000)
            java_fixture('fail-consume', schema)
            with db.transaction(True) as session:
                session.execute(text("CREATE TRIGGER reject_consume BEFORE INSERT ON entitlement_entries WHEN NEW.kind='consume' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END"))
            try:
                failure = request_body(); actual = compare('confirmation-rollback', failure)
                assert actual['error']['code'] == 'TOKEN_RESULT_UNKNOWN' and 'apiKey' not in actual
                unknowns.append(failure['attemptId'])
            finally:
                java_fixture('restore-free-grant', schema)
                with db.transaction(True) as session: session.execute(text('DROP TRIGGER reject_consume'))

            def observation(ident):
                return {'attemptId':ident, 'firstFrameMs':123.5, 'localTracksEnded':True, 'outcome':'ended', 'providerReportedSeconds':None}

            compare('observe-success', observation(success), path='/api/studio/observation')
            compare('observe-repeat', {**observation(success), 'outcome':'error'}, path='/api/studio/observation')
            compare('observe-unknown', observation(unknowns[0]), path='/api/studio/observation')
            compare('observe-not-owner', observation(success), path='/api/studio/observation', owner=1)
            compare('observe-no-attempt', observation(str(uuid4())), path='/api/studio/observation')
            compare('observe-bad-shape', {}, path='/api/studio/observation')
            for value in [True, -1, 120001, '1']:
                compare('observe-bad-number', {**observation(success), 'firstFrameMs':value}, path='/api/studio/observation')
            compare('observe-body-before-access', raw=b'{broken', path='/api/studio/observation', access=False)
            compare('observe-access-before-type', observation(success), path='/api/studio/observation', access=False, headers={'Content-Type':'text/plain'})

            # 替身已收到完整请求但尚未返回：强制结束Java进程，验证新进程不能重发。
            stub.mode, stub.seconds = 'crash', 15
            stub.token['expiresAt'] = iso(now_ms()+10_000)
            crash = request_body()
            h_old = {'Origin':ORIGIN,'Content-Type':'application/json','X-Studio-Access':access_old,'Cookie':f'yingxiang_session={tokens[0]}'}
            assert old.post('/api/studio/token', content=json.dumps(crash), headers=h_old).json()['error']['code'] == 'TOKEN_RESULT_UNKNOWN'
            before = stub.calls
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(server.request, 'POST', '/api/studio/token', json.dumps(crash), f'yingxiang_session={tokens[0]}',
                                     {'Content-Type':'application/json','X-Studio-Access':access_java})
                try:
                    assert stub.accepted.wait(10), 'provider substitute did not receive committed request'
                    server.process.kill(); server.process.wait(timeout=5)
                finally: stub.release.set()
                try: future.result(timeout=5)
                except OSError: pass
                else: raise AssertionError('killed process unexpectedly returned credentials')
            assert stub.calls == before + 1
            server = stack.enter_context(LiveJava(schema, overrides, jvm_options=jvm_options))
            compare('restarted-duplicate-no-post', crash)
            assert stub.calls == before + 1
            unknowns.append(crash['attemptId']); count += 1

            java_fixture('studio-setting', schema, {'paused':True})
            with db.transaction(True) as session: session.execute(insert(admin_settings).values(key='services',value='{"studio":true}',version=0))
            compare('paused-status', method='GET', path='/api/studio/status')
            compare('paused-no-post', request_body())
            rejection = quota_call('quota-reserve', schema, {'hashed':tables['auth_sessions'][0]['hash'], 'attemptId':str(uuid4()), 'seconds':15})
            assert rejection.get('code') == 'SERVICE_PAUSED', 'transaction must recheck pause before reserving'
            count += 1

            actual = java_fixture('quota-state', schema, {'username':tables['users'][0]['username']})
            assert {k:actual[k] for k in ('grants','attempts','entries')} == old_snapshot(db,tables['users'][0]['username']), 'ledger mismatch'
            count += 1
            for ident in [success, unknowns[0], unknowns[-1]]:
                actual = java_fixture('studio-attempt', schema, {'attemptId':ident})['attempt']
                with db.transaction() as session: row = session.execute(select(attempts).where(attempts.c.id==ident)).mappings().one()
                assert actual == {'state':row['state'],'accountState':row['account_state'], 'observation':json.loads(row['observation']) if row['observation'] else None,'outcome':row['outcome']}
                count += 1
            assert not stub.errors, 'upstream request scope mismatch'
            assert stub.calls == stub.old_calls, 'upstream request count mismatch'
            stub_calls = stub.calls
    finally:
        if created: java_fixture('cleanup', schema)
    print(json.dumps({'status':'OK','checks':count,'javaStubPosts':stub_calls,'realProviderCalls':0,'temporarySchemaCleaned':True}))


if __name__ == '__main__': main()
