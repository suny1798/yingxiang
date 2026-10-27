"""M11：临时PG schema中测试账号写入，与旧FastAPI合成SQLite对照。"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from dataclasses import replace
from datetime import datetime
import http.client
import json
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile
import time

from fastapi.testclient import TestClient
from sqlalchemy import insert, update
from app.core import Settings, password_hash
from app.db import Database
from app.main import create_app
from app.models import metadata, limits
from scripts.ops import initialize
from scripts.java_account_contracts import fixtures, java_fixture, BACKEND, ORIGIN


PASSWORD = 'legacy-映想-😀-password'
SALT = '00112233445566778899aabbccddeeff'


class LiveJava:
    def __init__(self, schema, overrides=None):
        self.schema, self.overrides = schema, overrides or {}

    def __enter__(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); self.port = sock.getsockname()[1]
        options = {'server.port': self.port, 'migration.db-schema': self.schema,
                   'migration.auth-enabled': 'true', 'migration.maintenance': 'false',
                   'spring.datasource.hikari.read-only': 'false', **self.overrides}
        self.log = tempfile.TemporaryFile()
        self.process = subprocess.Popen(['java', '-jar', 'target/yingxiang-backend-0.1.0.jar',
            *[f'--{key}={value}' for key, value in options.items()]], cwd=BACKEND, stdout=self.log, stderr=self.log)
        deadline = time.monotonic() + 40
        try:
            while True:
                assert self.process.poll() is None, 'Java startup failed; raw configuration/log suppressed'
                try:
                    if self.request('GET', '/api/internal/live', headers={'Origin': None})[0] == 200: return self
                except OSError: pass
                if time.monotonic() > deadline: raise AssertionError('Java startup deadline exceeded')
                time.sleep(.2)
        except Exception:
            self.__exit__(None, None, None); raise

    def __exit__(self, *args):
        self.process.terminate()
        try: self.process.wait(timeout=10)
        except subprocess.TimeoutExpired: self.process.kill(); self.process.wait(timeout=5)
        self.log.close()

    def request(self, method, path, body=None, cookie=None, headers=None):
        h = {'Host': '127.0.0.1:8791', 'Origin': ORIGIN, **(headers or {})}
        h = {key: value for key, value in h.items() if value is not None}
        if cookie is not None: h['Cookie'] = cookie
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        try:
            connection.request(method, path, body=body, headers=h)
            response = connection.getresponse()
            return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
        finally:
            connection.close()


def normal(value):
    if isinstance(value, dict):
        result = {key: normal(item) for key, item in value.items()}
        if 'requestId' in result: result['requestId'] = '<request-id>'
        if isinstance(result.get('user'), dict):
            assert re.fullmatch(r'[a-f0-9-]{36}', result['user']['id'])
            result['user']['id'] = '<user:' + result['user']['username'] + '>'
        return result
    if isinstance(value, list): return [normal(item) for item in value]
    if isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', value): return '<utc-ms>'
    return value


def main():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    tables, ids, tokens = fixtures()
    encoded = password_hash(PASSWORD, SALT)
    for row in tables['users']: row.update(salt=SALT, password_hash=encoded)
    created = False
    cases = 0
    try:
        java_fixture('setup', schema, {'tables': tables}); created = True
        with tempfile.TemporaryDirectory(prefix='yingxiang-m11-contract-') as temporary, ExitStack() as stack:
            settings = Settings(data_dir=Path(temporary), public_origin=ORIGIN, allowed_origins=(ORIGIN,), maintenance=False)
            initialize(settings)
            db = Database(settings.database); stack.callback(db.close)
            with db.transaction(True) as session:
                for name, rows in tables.items(): session.execute(insert(metadata.tables[name]), rows)
            app = create_app(settings); stack.callback(app.state.db.close)
            old = TestClient(app, base_url=ORIGIN); stack.callback(old.close)
            server = stack.enter_context(LiveJava(schema))

            def compare(label, path, payload=None, *, method='POST', raw=None, headers=None, cookies=None, old_client=None, java=None):
                nonlocal cases
                client, live = old_client or old, java or server
                body = raw if raw is not None else json.dumps(payload).encode() if payload is not None else None
                h = {'Host': '127.0.0.1:8791', 'Origin': ORIGIN, 'Content-Type': 'application/json', **(headers or {})}
                h = {key: value for key, value in h.items() if value is not None}
                client.cookies.clear()
                if cookies and cookies[0] is not None: h['Cookie'] = cookies[0]
                expected = client.request(method, path, content=body, headers=h)
                status, actual_headers, data = live.request(method, path, body, cookies[1] if cookies else None,
                                                           {**(headers or {}), 'Content-Type': h.get('Content-Type')})
                assert status == expected.status_code, label + ': status mismatch'
                actual = json.loads(data)
                assert normal(actual) == normal(expected.json()), label + ': JSON mismatch; private payload suppressed'
                for key in ('content-type', 'cache-control', 'x-content-type-options'):
                    assert actual_headers.get(key) == expected.headers.get(key), label + ': response header mismatch'
                old_set, new_set = expected.headers.get('set-cookie'), actual_headers.get('set-cookie')
                assert bool(old_set) == bool(new_set), label + ': cookie presence mismatch'
                pair = (None, None)
                if new_set:
                    assert [part.strip() for part in new_set.split(';')[1:]] == [part.strip() for part in old_set.split(';')[1:]], label + ': cookie flags mismatch'
                    token = new_set.split(';')[0].split('=', 1)[1]
                    assert token == '' or re.fullmatch(r'[a-f0-9]{64}', token), label + ': token format'
                    pair = (old_set.split(';')[0], new_set.split(';')[0])
                assert 'www-authenticate' not in actual_headers and 'location' not in actual_headers
                cases += 1
                return actual, pair

            invalid = [({}, 400), ({'username': 'ab', 'password': 'valid-password'}, 400),
                       ({'username': 'valid_name', 'password': 'x'*7}, 400),
                       ({'username': 'valid_name', 'password': '😀'*65}, 400),
                       ({'username': 1234, 'password': 'valid-password'}, 400),
                       ({'username': 'valid_name', 'password': 'valid-password', 'extra': True}, 400)]
            for i, (body, _) in enumerate(invalid): compare('invalid-' + str(i), '/api/account/register', body)
            for i, raw in enumerate([b'[]', b'{broken', b'{} {}', b'{"x":"' + b'x'*4100 + b'"}',
                                     b'\xff', b'\xef\xbb\xbf{}', '{}'.encode('utf-16')]):
                compare('invalid-json-' + str(i), '/api/account/login', raw=raw)
            compare('wrong-type', '/api/account/login', {}, headers={'Content-Type': 'text/plain'})
            compare('missing-type', '/api/account/login', {}, headers={'Content-Type': None})
            compare('wrong-origin', '/api/account/login', {}, headers={'Origin': 'https://wrong.invalid'})
            compare('missing-origin', '/api/account/login', {}, headers={'Origin': None})
            compare('cross-site', '/api/account/login', {}, headers={'Sec-Fetch-Site': 'cross-site'})
            legacy, legacy_cookie = compare('legacy-scrypt-login', '/api/account/login', {'username': 'M10B_SYNTHETIC_0', 'password': PASSWORD})
            compare('wrong-password', '/api/account/login', {'username': 'm10b_synthetic_0', 'password': 'wrong-password'})
            compare('unknown-user', '/api/account/login', {'username': 'not_existing_user', 'password': PASSWORD})
            compare('disabled-user', '/api/account/login', {'username': 'm10b_synthetic_3', 'password': PASSWORD})
            compare('existing-register', '/api/account/register', {'username': 'm10b_synthetic_0', 'password': PASSWORD})
            _, cookie = compare('register-once', '/api/account/register', {'username': 'Case_New', 'password': PASSWORD})
            compare('registered-me', '/api/account/me', method='GET', cookies=cookie)
            compare('duplicate-case-register', '/api/account/register', {'username': 'CASE_NEW', 'password': PASSWORD})
            _, second_cookie = compare('login-does-not-grant', '/api/account/login', {'username': 'case_new', 'password': PASSWORD})
            stats = java_fixture('stats', schema, {'username': 'case_new'})
            assert (stats['users'], stats['freeGrants'], stats['entries'], stats['sessions']) == (1, 1, 1, 2)
            compare('logout', '/api/account/logout', cookies=cookie)
            compare('logged-out-cookie-invalid', '/api/account/me', method='GET', cookies=cookie)
            compare('other-session-survives', '/api/account/me', method='GET', cookies=second_cookie)
            compare('anonymous-logout', '/api/account/logout')
            compare('surrogate-register', '/api/account/register', {'username': 'surrogate_user', 'password': 'abcd\ud8001234'})
            compare('surrogate-login', '/api/account/login', {'username': 'surrogate_user', 'password': 'abcd\ud8001234'})
            for i in range(11): compare('rate-' + str(i), '/api/account/login', {'username': 'limited_user', 'password': 'wrong-password'})
            stats = java_fixture('stats', schema, {'username': 'limited_user'})
            assert stats['userCount'] == 11, 'Failed auth counter was rolled back'
            java_fixture('expire-limit', schema, {'username': 'limited_user'})
            with db.transaction(True) as session: session.execute(update(limits).where(limits.c.key == 'auth:limited_user').values(until=0))
            compare('expired-window-resets', '/api/account/login', {'username': 'limited_user', 'password': 'wrong-password'})
            assert java_fixture('stats', schema, {'username': 'limited_user'})['userCount'] == 1

            def race(_):
                return server.request('POST', '/api/account/register', json.dumps({'username': 'race_user', 'password': PASSWORD}).encode(), headers={'Content-Type': 'application/json'})[0]
            with ThreadPoolExecutor(max_workers=2) as executor: statuses = sorted(executor.map(race, range(2)))
            assert statuses == [200, 409], 'Concurrent registration did not have exactly one winner'
            stats = java_fixture('stats', schema, {'username': 'race_user'})
            assert (stats['users'], stats['freeGrants'], stats['entries'], stats['sessions']) == (1, 1, 1, 1)
            cases += 2

            before = java_fixture('stats', schema, {'username': 'atomic_failure'})
            java_fixture('fail-free-grant', schema)
            status, headers, data = server.request('POST', '/api/account/register', json.dumps({'username': 'atomic_failure', 'password': PASSWORD}).encode(), headers={'Content-Type': 'application/json'})
            assert status == 503 and 'set-cookie' not in headers
            after = java_fixture('stats', schema, {'username': 'atomic_failure'})
            assert (after['users'], after['freeGrants'], after['entries'], after['sessions']) == (0, 0, 0, 0)
            assert after['globalCount'] == before['globalCount'] + 1
            java_fixture('restore-free-grant', schema); cases += 1

            with LiveJava(schema, {'spring.data.redis.host': '127.0.0.1', 'spring.data.redis.port': 1,
                                  'spring.data.redis.timeout': '500ms', 'spring.data.redis.connect-timeout': '500ms'}) as outage:
                before = java_fixture('stats', schema, {'username': 'redis_outage'})
                status, headers, body = outage.request('POST', '/api/account/login', json.dumps({'username': 'redis_outage', 'password': PASSWORD}).encode(), headers={'Content-Type': 'application/json'})
                assert status == 503 and json.loads(body)['error']['code'] == 'SERVICE_UNAVAILABLE' and 'set-cookie' not in headers
                assert outage.request('GET', '/api/account/me', cookie=legacy_cookie[1])[0] == 200
                assert java_fixture('stats', schema, {'username': 'redis_outage'})['globalCount'] == before['globalCount']
                cases += 2
            maintenance_settings = replace(settings, maintenance=True)
            maintenance_app = create_app(maintenance_settings); stack.callback(maintenance_app.state.db.close)
            maintenance_old = TestClient(maintenance_app, base_url=ORIGIN); stack.callback(maintenance_old.close)
            with LiveJava(schema, {'migration.maintenance': 'true', 'spring.datasource.hikari.read-only': 'true'}) as maintenance:
                compare('maintenance-write', '/api/account/register', {}, old_client=maintenance_old, java=maintenance)
            secure_origin = ORIGIN.replace('http:', 'https:')
            secure_settings = replace(settings, public_origin=secure_origin, allowed_origins=(secure_origin,))
            secure_app = create_app(secure_settings); stack.callback(secure_app.state.db.close)
            secure_old = TestClient(secure_app, base_url=secure_origin); stack.callback(secure_old.close)
            with LiveJava(schema, {'migration.public-origin': secure_origin}) as secure:
                compare('secure-cookie-flag', '/api/account/login', {'username': 'm10b_synthetic_0', 'password': PASSWORD},
                        headers={'Origin': secure_origin}, old_client=secure_old, java=secure)
            assert server.request('POST', '/api/payments/checkout', b'{}', headers={'Content-Type': 'application/json'})[0] == 503
            cases += 1
    finally:
        if created: java_fixture('cleanup', schema)
    print(json.dumps({'status': 'PASSED', 'httpCases': cases, 'legacyScryptCompatible': True,
                     'concurrentRegistrationWinners': 1, 'atomicRollbackVerified': True,
                     'failedCountersCommitted': True, 'redisFailureClosed': True,
                     'temporarySchemaRemoved': created, 'realAccountsImported': False, 'providerCalls': 0}))


if __name__ == '__main__':
    main()
