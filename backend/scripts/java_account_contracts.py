"""真实PG临时schema＋最终Java Jar，与合成SQLite/FastAPI本人读取对照。"""
from contextlib import ExitStack
import hashlib
import http.client
import json
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import insert, update, delete, text
from app.core import Settings
from app.db import Database
from app.main import create_app
from app.models import metadata, users, sessions
from scripts.ops import initialize


BACKEND = Path(__file__).resolve().parents[1]
ORIGIN = 'http://127.0.0.1:8791'


def fixtures():
    now = time.time_ns() // 1_000_000
    ids = [str(uuid4()) for _ in range(4)]
    tokens = [str(i) * 64 for i in range(1, 5)]  # 只对本轮合成schema有效，不写报告。
    tables = {'users': [], 'auth_sessions': [], 'entitlement_grants': [], 'usage_attempts': []}
    for i, ident in enumerate(ids):
        tables['users'].append({'id': ident, 'username': f'm10b_synthetic_{i}', 'salt': 'synthetic-only',
                                'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 100000,
                                'role': 'user', 'disabled': int(i == 3)})
        tables['auth_sessions'].append({'hash': hashlib.sha256(tokens[i].encode()).hexdigest(), 'user_id': ident,
                                        'expires_at': now - 1000 if i == 2 else now + 600000})
    def grant(owner, seconds, total, reserved=0, used=0, revoked=0, environment='real_usage'):
        tables['entitlement_grants'].append({'id': str(uuid4()), 'user_id': ids[owner], 'seconds': seconds,
            'environment': environment, 'source': 'synthetic', 'source_key': str(uuid4()), 'total': total,
            'reserved': reserved, 'used': used, 'revoked': revoked})
    grant(0, 15, 5, 1, 1, 1); grant(0, 15, 2, 1); grant(0, 30, 3, 1, 1)
    grant(0, 15, 90, environment='stripe_sandbox'); grant(1, 15, 1, 1)
    for owner in (0, 1):
        for i in range(24):
            tables['usage_attempts'].append({'id': str(uuid4()), 'user_id': ids[owner], 'scene': 'studio',
                'seconds': 15 if i == 0 else 30, 'state': 'unknown' if i == 0 else 'finished',
                'account_state': 'review' if i == 0 else 'used', 'created_at': now - 50000 + i // 2,
                'outcome': 'synthetic_outcome' if i % 2 else None})
    return tables, ids, tokens


def java_fixture(action, schema, payload=None):
    result = subprocess.run([
        'java', '-Duser.language=en', '-Duser.country=US', '-Dlogback.configurationFile=migration-probe-logback.xml',
        '-Dloader.main=cn.yingxiang.bootstrap.AccountIntegrationFixture', '-cp', str(BACKEND / 'target/yingxiang-backend-0.1.0.jar'),
        'org.springframework.boot.loader.launch.PropertiesLauncher', action, str(BACKEND / 'config/application-local.yml'), schema,
    ], cwd=BACKEND, input=json.dumps(payload or {}).encode(), capture_output=True, timeout=60)
    try:
        report = json.loads(result.stdout)
    except Exception:
        raise AssertionError('Fixture output suppressed; no raw driver output logged') from None
    if result.returncode != 0 or report.get('status') != 'OK':
        raise AssertionError('Fixture failed: ' + str(report.get('code', 'UNKNOWN')))
    return report


def main():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    created = False
    process = None
    count = 0
    tables, ids, tokens = fixtures()
    try:
        setup = java_fixture('setup', schema, {'tables': tables})
        created = True
        expected = {name: [column.name for column in table.columns] for name, table in metadata.tables.items()}
        assert setup['columns'] == expected, 'PG V1 columns differ from current SQLite0006 model'
        assert setup['migrationsExecuted'] == 3 and setup['repeatMigrationsExecuted'] == 0
        assert setup['constraintRejections'] == 3
        with tempfile.TemporaryDirectory(prefix='yingxiang-m10b-contract-') as temporary, ExitStack() as stack:
            settings = Settings(data_dir=Path(temporary), public_origin=ORIGIN, allowed_origins=(ORIGIN,), maintenance=True)
            initialize(settings)
            db = Database(settings.database)
            stack.callback(db.close)
            with db.transaction(True) as session:
                for name, rows in tables.items():
                    session.execute(insert(metadata.tables[name]), rows)
            # 本片只有账户读取，不进入generation lifespan，不启动后台Worker或供应商。
            app = create_app(settings)
            stack.callback(app.state.db.close)
            old = TestClient(app, base_url=ORIGIN)
            stack.callback(old.close)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            log = stack.enter_context(tempfile.TemporaryFile())
            process = subprocess.Popen(['java', '-jar', 'target/yingxiang-backend-0.1.0.jar', f'--server.port={port}',
                f'--migration.db-schema={schema}'], cwd=BACKEND, stdout=log, stderr=log)

            def request(method, path, cookie=None, headers=None):
                h = {'Host': '127.0.0.1:8791', **(headers or {})}
                if cookie is not None: h['Cookie'] = cookie
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=12)
                try:
                    connection.request(method, path, headers=h)
                    response = connection.getresponse()
                    return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
                finally:
                    connection.close()

            deadline = time.monotonic() + 40
            while True:
                assert process.poll() is None, 'Java process exited; raw log suppressed'
                try:
                    if request('GET', '/api/internal/live')[0] == 200: break
                except OSError: pass
                if time.monotonic() > deadline: raise AssertionError('Java startup deadline exceeded')
                time.sleep(.2)

            def compare(label, cookie=None, path='/api/account/me', method='GET', headers=None):
                nonlocal count
                h = {'Host': '127.0.0.1:8791', **(headers or {})}
                if cookie is not None: h['Cookie'] = cookie
                expected_response = old.request(method, path, headers=h)
                status, actual_headers, body = request(method, path, cookie, headers)
                assert status == expected_response.status_code, label + ': status mismatch'
                if method == 'HEAD': assert body == b'', label + ': HEAD body'
                else:
                    actual, expected_body = json.loads(body), expected_response.json()
                    if 'requestId' in actual: actual['requestId'] = '<request-id>'
                    if 'requestId' in expected_body: expected_body['requestId'] = '<request-id>'
                    assert actual == expected_body, label + ': JSON mismatch (private fixture body suppressed)'
                for key in ('content-type', 'cache-control', 'x-content-type-options'):
                    assert actual_headers.get(key) == expected_response.headers.get(key), label + ': header mismatch'
                assert not {'set-cookie', 'www-authenticate', 'location'} & actual_headers.keys(), label + ': unexpected login/session response'
                count += 1

            cookie = lambda index: 'yingxiang_session=' + tokens[index]
            compare('anonymous')
            for i in range(4): compare('session-' + str(i), cookie(i))
            compare('malformed', 'yingxiang_session=invalid')
            compare('percent-not-decoded', 'yingxiang_session=%31' + tokens[0][1:])
            compare('uppercase-invalid', 'yingxiang_session=' + 'A' * 64)
            compare('first-cookie-wins', cookie(0) + '; ' + cookie(1))
            compare('first-invalid-wins', 'yingxiang_session=invalid; ' + cookie(0))
            compare('foreign-id-ignored', cookie(0), path='/api/account/me?userId=' + ids[1])
            compare('head', cookie(0), method='HEAD')
            compare('wrong-origin', cookie(0), headers={'Origin': 'https://wrong.invalid'})
            compare('cross-site', cookie(0), headers={'Sec-Fetch-Site': 'cross-site'})
            for action, index, changes in [('promote', 1, {'role': 'admin'}), ('disable', 0, {'disabled': 1})]:
                java_fixture(action, schema, {'userId': ids[index]})
                with db.transaction(True) as session: session.execute(update(users).where(users.c.id == ids[index]).values(**changes))
                compare(action + '-immediate', cookie(index))
            java_fixture('revoke', schema, {'userId': ids[1]})
            with db.transaction(True) as session: session.execute(delete(sessions).where(sessions.c.user_id == ids[1]))
            compare('revocation-immediate', cookie(1))
            for method, path in [('POST', '/api/account/login'), ('POST', '/api/account/register'), ('POST', '/api/payments/checkout')]:
                assert request(method, path, headers={'Origin': ORIGIN})[0] == 503, 'Write endpoint unexpectedly enabled'
                count += 1
            java_fixture('drop-sessions-table', schema)
            with db.transaction(True) as session:
                session.execute(text('DROP TABLE auth_sessions'))
            compare('missing-table-authenticated', cookie(0))
            compare('missing-table-anonymous')
            compare('missing-table-head', cookie(0), method='HEAD')
    finally:
        if process is not None:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
        if created: java_fixture('cleanup', schema)
    print(json.dumps({'status': 'PASSED', 'httpCases': count, 'schemaTablesCompared': len(metadata.tables),
                      'constraintRejections': 3, 'temporarySchemaRemoved': created,
                      'realAccountsImported': False, 'providerCalls': 0}))


if __name__ == '__main__':
    main()
