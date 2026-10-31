"""M16：真实临时PG＋两进程＋合成令牌服务的实时编辑门禁、预算与提示词历史合同回归。"""
from __future__ import annotations

import hashlib
import http.client
import json
import secrets
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
ORIGIN = 'http://127.0.0.1:8791'
HOST = '127.0.0.1:8791'
KEY = 'synthetic-prompt-key'
MODEL = 'lucy-2.6'
CONSENT = '2026-10-26-prompt-history-v1'
ALICE = 'yingxiang_session=' + '6' * 64
BOB = 'yingxiang_session=' + '7' * 64
SUNY = 'yingxiang_session=' + '8' * 64
ALICE_ID = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0'
BOB_ID = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'
SUNY_ID = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2'
COUNT = 0


def check(condition, label):
    global COUNT
    assert condition, label + ' failed'
    COUNT += 1


def fixture(action, schema, payload=None):
    result = subprocess.run([
        'java', '-Duser.language=en', '-Duser.country=US', '-Dlogback.configurationFile=migration-probe-logback.xml',
        '-Dloader.main=cn.yingxiang.fixture.AccountIntegrationFixture', '-cp', str(JAR),
        'org.springframework.boot.loader.launch.PropertiesLauncher', action, str(CONFIG), schema,
    ], cwd=BACKEND, input=json.dumps(payload or {}).encode(), capture_output=True, timeout=60)
    try:
        report = json.loads(result.stdout)
    except Exception:
        raise AssertionError('fixture output suppressed; raw driver output not logged') from None
    if result.returncode != 0 or report.get('status') != 'OK':
        raise AssertionError('fixture failed: ' + str(report.get('code', 'UNKNOWN')))
    return report


class TokenStub:
    def __init__(self):
        self.posts = 0
        self.fail_next = False
        self.lock = threading.Lock()
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                length = int(self.headers.get('Content-Length', '0'))
                body = json.loads(self.rfile.read(length) or b'{}')
                with stub.lock:
                    stub.posts += 1
                    failing = stub.fail_next
                if failing or self.headers.get('X-API-KEY') != KEY:
                    data = json.dumps({'error': 'synthetic'}).encode()
                    self.send_response(500)
                else:
                    expires = (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
                    token = {'apiKey': 'synthetic-client-token-' + secrets.token_hex(6), 'expiresAt': expires,
                             'permissions': {'models': body.get('allowedModels'), 'origins': body.get('allowedOrigins')},
                             'constraints': body.get('constraints')}
                    data = json.dumps(token).encode()
                    self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


def setup_schema():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    now = int(time.time() * 1000)
    tables = {'users': [], 'auth_sessions': [], 'entitlement_grants': [], 'usage_attempts': [],
              'orders': [], 'payment_events': [], 'sandbox_credit_packs': [], 'admin_audit': [],
              'admin_settings': [], 'works': [], 'work_references': [], 'video_jobs': [], 'video_history': [],
              'budget_campaigns': [], 'budget_reservations': [], 'scene_access': [], 'auth_rate_limits': []}
    for ident, name, cookie in [(ALICE_ID, 'm16_alice', ALICE), (BOB_ID, 'm16_bob', BOB), (SUNY_ID, 'm16_suny', SUNY)]:
        tables['users'].append({'id': ident, 'username': name, 'salt': 'synthetic-only',
                                'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                                'role': 'user', 'disabled': 0})
        tables['auth_sessions'].append({'hash': hashlib.sha256(cookie.split('=', 1)[1].encode()).hexdigest(),
                                        'user_id': ident, 'expires_at': now + 900000})
    fixture('setup', schema, {'tables': tables})
    return schema


def start_java(schema, token_port, storage, port=None):
    if port is None:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-Djdk.httpclient.disableRetryConnect=true', '-Djdk.httpclient.enableAllMethodRetry=false',
        '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.works-enabled=true', f'--migration.storage-root={storage}',
        '--migration.prompt-enabled=true', '--migration.prompt-budget-usd=0.6', '--migration.prompt-max-sessions=2',
        '--migration.prompt-allowed-usernames=m16_alice,m16_suny', '--migration.prompt-unlimited-usernames=m16_suny',
        f'--migration.prompt-key={KEY}', f'--migration.prompt-token-url=http://127.0.0.1:{token_port}/v1/client/tokens',
        f'--migration.public-origin={ORIGIN}', '--spring.datasource.hikari.read-only=false',
    ], cwd=BACKEND, stdout=log, stderr=log)

    def request(method, path, cookie=None, headers=None, body=None):
        h = {'Host': HOST, 'Origin': ORIGIN, **(headers or {})}
        if cookie is not None:
            h['Cookie'] = cookie
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=60)
        try:
            connection.request(method, path, body=body, headers=h)
            response = connection.getresponse()
            return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
        finally:
            connection.close()

    deadline = time.monotonic() + 60
    while True:
        assert process.poll() is None, 'Java process exited; raw log suppressed'
        try:
            if request('GET', '/api/internal/live')[0] == 200:
                break
        except OSError:
            pass
        if time.monotonic() > deadline:
            raise AssertionError('Java startup deadline exceeded')
        time.sleep(.2)
    return process, request


def stop_java(process):
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def body_json(value):
    return json.dumps(value).encode()


def parse(response):
    body = response[2]
    if not body:
        return None
    value = json.loads(body)
    if isinstance(value, dict) and value.get('code') == 0:
        return value.get('data')
    return value


def main():
    schema = setup_schema()
    storage = Path(tempfile.mkdtemp(prefix='yingxiang-m16-storage-'))
    stub = TokenStub()
    process = None
    try:
        process, request = start_java(schema, stub.port, storage)

        def call(method, path, cookie=None, headers=None, body=None):
            return request(method, path, cookie, headers, body)

        anonymous = call('GET', '/api/prompt/status')
        check(anonymous[0] == 200 and 'access' not in parse(anonymous), 'anonymous prompt status has no access')
        status = call('GET', '/api/prompt/status', cookie=ALICE)
        check(status[0] == 200 and parse(status)['available'] is True and len(parse(status)['access']) == 64,
              'alice prompt access')
        access = parse(status)['access']

        payload = {'attemptId': str(uuid4()), 'consentVersion': CONSENT, 'durationSec': 15}
        check(call('POST', '/api/prompt/token', headers={'Content-Type': 'application/json'}, body=body_json(payload))[0] == 401,
              'token login')
        check(call('POST', '/api/prompt/token', cookie=ALICE,
                   headers={'Content-Type': 'application/json', 'X-Studio-Access': '0' * 64}, body=body_json(payload))[0] == 401,
              'token access')
        check(call('POST', '/api/prompt/token', cookie=ALICE,
                   headers={'Content-Type': 'application/json', 'X-Studio-Access': access},
                   body=body_json({**payload, 'durationSec': 30}))[0] == 400, 'duration 15 only')
        check(call('POST', '/api/prompt/token', cookie=ALICE,
                   headers={'Content-Type': 'application/json', 'X-Studio-Access': access},
                   body=body_json({**payload, 'consentVersion': 'wrong'}))[0] == 400, 'consent required')

        issued = call('POST', '/api/prompt/token', cookie=ALICE,
                      headers={'Content-Type': 'application/json', 'X-Studio-Access': access}, body=body_json(payload))
        check(issued[0] == 200 and parse(issued)['durationSec'] == 15 and parse(issued)['apiKey'].startswith('synthetic-client-token-'),
              'token issued')
        state = fixture('prompt-state', schema, {'username': 'm16_alice'})
        check(state['attempts'][0]['state'] == 'issued' and state['reservations'][0]['microUsd'] == 300000, 'attempt issued and reserved')
        repeat = call('POST', '/api/prompt/token', cookie=ALICE,
                      headers={'Content-Type': 'application/json', 'X-Studio-Access': access}, body=body_json(payload))
        check(repeat[0] == 409 and parse(repeat)['reason'] == 'PROMPT_ATTEMPT_SPENT', 'attempt id spent')
        limited = call('POST', '/api/prompt/token', cookie=ALICE,
                       headers={'Content-Type': 'application/json', 'X-Studio-Access': access},
                       body=body_json({**payload, 'attemptId': str(uuid4())}))
        check(limited[0] == 409 and parse(limited)['reason'] == 'PROMPT_LIMIT', 'session limit')

        stub.fail_next = True
        posts_before = stub.posts
        fixture('prompt-clear-lease', schema, {'attemptId': payload['attemptId']})
        unknown_payload = {'attemptId': str(uuid4()), 'consentVersion': CONSENT, 'durationSec': 15}
        unknown = call('POST', '/api/prompt/token', cookie=ALICE,
                       headers={'Content-Type': 'application/json', 'X-Studio-Access': access}, body=body_json(unknown_payload))
        check(unknown[0] == 503 and parse(unknown)['reason'] == 'PROMPT_TOKEN_UNKNOWN', 'unknown token result')
        state = fixture('prompt-state', schema, {'username': 'm16_alice'})
        attempt = [item for item in state['attempts'] if item['id'] == unknown_payload['attemptId']][0]
        check(attempt['state'] == 'unknown' and json.loads(attempt['observation'])['tokenFailure'] == 'UPSTREAM_CONNECTION',
              'unknown diagnostic')
        check(stub.posts == posts_before + 1, 'single failed token request')
        retry = call('POST', '/api/prompt/token', cookie=ALICE,
                     headers={'Content-Type': 'application/json', 'X-Studio-Access': access}, body=body_json(unknown_payload))
        check(retry[0] == 409 and parse(retry)['reason'] == 'PROMPT_ATTEMPT_SPENT', 'unknown not retried')
        stub.fail_next = False
        waiting = call('GET', '/api/prompt/status', cookie=ALICE)
        check(parse(waiting)['available'] is False and '保留预算占用' in parse(waiting)['message'], 'unknown wait window')

        suny_status = call('GET', '/api/prompt/status', cookie=SUNY)
        check(suny_status[0] == 200 and parse(suny_status)['available'] is True, 'suny exception available')
        suny_access = parse(suny_status)['access']
        suny_issue = call('POST', '/api/prompt/token', cookie=SUNY,
                          headers={'Content-Type': 'application/json', 'X-Studio-Access': suny_access},
                          body=body_json({'attemptId': str(uuid4()), 'consentVersion': CONSENT, 'durationSec': 15}))
        check(suny_issue[0] == 200, 'suny exception can issue')

        # 提示词历史
        owner = {'X-Work-Owner': ALICE_ID, 'Content-Type': 'application/json'}
        edit_id = str(uuid4())
        created = call('POST', '/api/works', cookie=ALICE, headers=owner,
                       body=body_json({'id': edit_id, 'kind': 'edit', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        check(created[0] == 201, 'edit work created')
        empty = call('GET', f'/api/works/{edit_id}/prompts', cookie=ALICE)
        check(empty[0] == 200 and parse(empty) == {'states': []}, 'empty prompt history')
        first = {'atMs': 0, 'instructions': ['把外套换成米色']}
        second = {'atMs': 500, 'instructions': ['把外套换成米色', '再加一条围巾']}
        check(call('POST', f'/api/works/{edit_id}/prompts/0', cookie=ALICE, headers=owner, body=body_json(first))[0] == 200,
              'prompt state zero')
        check(call('POST', f'/api/works/{edit_id}/prompts/1', cookie=ALICE, headers=owner, body=body_json(second))[0] == 200,
              'prompt state one')
        history = call('GET', f'/api/works/{edit_id}/prompts', cookie=ALICE)
        check(history[0] == 200 and parse(history) == {'states': [first, second]}, 'prompt history')
        check(call('POST', f'/api/works/{edit_id}/prompts/1', cookie=ALICE, headers=owner, body=body_json(second))[0] == 200,
              'prompt idempotent')
        conflict = call('POST', f'/api/works/{edit_id}/prompts/1', cookie=ALICE, headers=owner,
                        body=body_json({'atMs': 500, 'instructions': ['不同']}))
        check(conflict[0] == 409 and parse(conflict)['reason'] == 'WORK_PROMPTS_CONFLICT', 'prompt conflict')
        order = call('POST', f'/api/works/{edit_id}/prompts/2', cookie=ALICE, headers=owner,
                     body=body_json({'atMs': 400, 'instructions': ['逆序']}))
        check(order[0] == 409 and parse(order)['reason'] == 'WORK_PROMPTS_ORDER', 'prompt order')
        check(call('POST', f'/api/works/{edit_id}/prompts/2', cookie=ALICE, headers=owner,
                   body=body_json({'atMs': 600, 'instructions': []}))[0] == 400, 'empty instructions')
        check(call('POST', f'/api/works/{edit_id}/prompts/2', cookie=ALICE,
                   headers={'X-Work-Owner': ALICE_ID, 'Content-Type': 'text/plain'}, body=b'{}')[0] == 415,
              'prompt content type')
        check(call('POST', f'/api/works/{edit_id}/prompts/2', cookie=ALICE, headers=owner,
                   body=body_json({'atMs': 600, 'instructions': ['长' * 501]}))[0] == 400, 'prompt length')
        realtime_id = str(uuid4())
        call('POST', '/api/works', cookie=ALICE, headers=owner,
             body=body_json({'id': realtime_id, 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        check(call('GET', f'/api/works/{realtime_id}/prompts', cookie=ALICE)[0] == 200
              and parse(call('GET', f'/api/works/{realtime_id}/prompts', cookie=ALICE)) == {'states': []},
              'non-edit history empty')

        # 重启后unknown与提示词仍在，且不自动重试
        posts_before_restart = stub.posts
        stop_java(process)
        process, request = start_java(schema, stub.port, storage)
        check(stub.posts == posts_before_restart, 'no automatic token retry after restart')
        check(call('GET', f'/api/works/{edit_id}/prompts', cookie=ALICE)[2] and
              parse(call('GET', f'/api/works/{edit_id}/prompts', cookie=ALICE)) == {'states': [first, second]},
              'prompt history survives restart')
        check(parse(call('GET', '/api/prompt/status', cookie=ALICE))['available'] is False, 'unknown survives restart')

        # 删除作品后提示词不可读
        chunk = b'\x00\x00\x00\x18ftypisom' + b'synthetic' * 4
        call('POST', f'/api/works/{edit_id}/chunks/0', cookie=ALICE,
             headers={'X-Work-Owner': ALICE_ID, 'Content-Type': 'application/octet-stream'}, body=chunk)
        call('POST', f'/api/works/{edit_id}/complete', cookie=ALICE,
             headers={'X-Work-Owner': ALICE_ID, 'Content-Type': 'application/json'}, body=b'{}')
        check(call('POST', f'/api/works/{edit_id}', cookie=ALICE, headers=owner, body=body_json({'action': 'delete'}))[0] == 200,
              'delete edit work')
        check(call('GET', f'/api/works/{edit_id}/prompts', cookie=ALICE)[0] == 404, 'prompts deleted with work')
    finally:
        if process is not None:
            stop_java(process)
        try:
            stub.stop()
        except Exception:
            pass
        fixture('cleanup', schema)
        shutil.rmtree(storage, ignore_errors=True)
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'realPostgres': True, 'syntheticTokenService': True,
                      'tokenPosts': stub.posts, 'realProviderCalls': 0, 'temporarySchemaRemoved': True}))


if __name__ == '__main__':
    main()
