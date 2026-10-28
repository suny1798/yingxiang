"""M13-a/b：真实临时PG＋两进程＋本机合成Stripe替身的订单/管理合同回归。

不调用真实Stripe、不读取长期密钥、不写正式schema；替身只在回环地址运行。
"""
from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import secrets
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
ORIGIN = 'http://127.0.0.1:8791'
HOST = '127.0.0.1:8791'
SECRET = 'sk_test_synthetic_m13'
WEBHOOK_SECRET = 'whsec_synthetic_m13'
ACCOUNT = 'acct_synthetic_m13'
ADMIN_COOKIE = 'yingxiang_session=' + 'a' * 64
ALICE_COOKIE = 'yingxiang_session=' + 'b' * 64
BOB_COOKIE = 'yingxiang_session=' + 'c' * 64
CAROL_COOKIE = 'yingxiang_session=' + 'd' * 64
DISABLED_COOKIE = 'yingxiang_session=' + 'e' * 64
COUNT = 0


def check(condition, label):
    global COUNT
    assert condition, label + ' failed'
    COUNT += 1


def fixture(action, schema, payload=None):
    result = subprocess.run([
        'java', '-Duser.language=en', '-Duser.country=US', '-Dlogback.configurationFile=migration-probe-logback.xml',
        '-Dloader.main=cn.yingxiang.bootstrap.AccountIntegrationFixture', '-cp', str(JAR),
        'org.springframework.boot.loader.launch.PropertiesLauncher', action, str(CONFIG), schema,
    ], cwd=BACKEND, input=json.dumps(payload or {}).encode(), capture_output=True, timeout=60)
    try:
        report = json.loads(result.stdout)
    except Exception:
        raise AssertionError('fixture output suppressed; raw driver output not logged') from None
    if result.returncode != 0 or report.get('status') != 'OK':
        raise AssertionError('fixture failed: ' + str(report.get('code', 'UNKNOWN')))
    return report


class StripeStub:
    """只实现本片用到的Stripe子集；不接受外部连接。"""

    def __init__(self):
        self.sessions = {}
        self.creates = 0
        self.idempotency = {}
        self.account = ACCOUNT
        self.lock = threading.Lock()
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _json(self, status, body):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.headers.get('Authorization') != 'Bearer ' + SECRET:
                    return self._json(401, {'error': {'message': 'unauthorized'}})
                if self.path == '/v1/account':
                    return self._json(200, {'id': stub.account, 'object': 'account'})
                if self.path.startswith('/v1/checkout/sessions/'):
                    ident = self.path.rsplit('/', 1)[-1]
                    with stub.lock:
                        value = stub.sessions.get(ident)
                    return self._json(200, value) if value else self._json(404, {'error': {'message': 'missing'}})
                return self._json(404, {'error': {'message': 'not found'}})

            def do_POST(self):
                if self.headers.get('Authorization') != 'Bearer ' + SECRET:
                    return self._json(401, {'error': {'message': 'unauthorized'}})
                length = int(self.headers.get('Content-Length', '0'))
                form = parse_qs(self.rfile.read(length).decode(), keep_blank_values=True)
                key = self.headers.get('Idempotency-Key')
                with stub.lock:
                    if key and key in stub.idempotency:
                        return self._json(200, stub.sessions[stub.idempotency[key]])
                    ident = 'cs_test_' + secrets.token_hex(12)
                    stub.creates += 1
                    value = {
                        'id': ident, 'object': 'checkout.session', 'mode': form.get('mode', [''])[0],
                        'client_reference_id': form.get('client_reference_id', [''])[0],
                        'metadata': {
                            'orderId': form.get('metadata[orderId]', [''])[0],
                            'userId': form.get('metadata[userId]', [''])[0],
                            'sku': form.get('metadata[sku]', [''])[0],
                        },
                        'currency': form.get('line_items[0][price_data][currency]', [''])[0],
                        'amount_total': int(form.get('line_items[0][price_data][unit_amount]', ['0'])[0]),
                        'livemode': False, 'status': 'open', 'payment_status': 'unpaid',
                        'url': 'https://checkout.stripe.com/c/pay/' + ident,
                        'expires_at': int(time.time()) + 86400,
                    }
                    stub.sessions[ident] = value
                    if key:
                        stub.idempotency[key] = ident
                return self._json(200, value)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def complete(self, ident, amount=None):
        with self.lock:
            value = self.sessions[ident]
            value['status'] = 'complete'
            value['payment_status'] = 'paid'
            if amount is not None:
                value['amount_total'] = amount
            return dict(value)

    def expire(self, ident):
        with self.lock:
            self.sessions[ident]['status'] = 'expired'
            return dict(self.sessions[ident])

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def restart(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', self.port), self.server.RequestHandlerClass)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()


def start_java(schema, stub_port, maintenance=False, port=None):
    if port is None:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', f'--migration.maintenance={str(maintenance).lower()}',
        '--migration.account-read-enabled=true', '--migration.payments-enabled=true',
        '--migration.admin-enabled=true', f'--migration.stripe-secret={SECRET}',
        f'--migration.stripe-webhook-secret={WEBHOOK_SECRET}', f'--migration.stripe-expected-account={ACCOUNT}',
        f'--migration.stripe-api-base=http://127.0.0.1:{stub_port}', f'--migration.public-origin={ORIGIN}',
        '--spring.datasource.hikari.read-only=false',
    ], cwd=BACKEND, stdout=log, stderr=log)

    def request(method, path, cookie=None, headers=None, body=None):
        h = {'Host': HOST, **(headers or {})}
        if cookie is not None:
            h['Cookie'] = cookie
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
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
    return process, request, port


def stop_java(process):
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def sign(payload: bytes, timestamp=None):
    timestamp = int(time.time()) if timestamp is None else timestamp
    digest = hmac.new(WEBHOOK_SECRET.encode(), f'{timestamp}.'.encode() + payload, hashlib.sha256).hexdigest()
    return f't={timestamp},v1={digest}'


def json_body(value):
    return json.dumps(value).encode()


def parse(response):
    body = response[2]
    return json.loads(body) if body else None


def main():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    now = int(time.time() * 1000)
    users = [
        ('11111111-1111-4111-8111-111111111111', 'm13_alice', 'user', 0, ALICE_COOKIE),
        ('22222222-2222-4222-8222-222222222222', 'm13_bob', 'user', 0, BOB_COOKIE),
        ('33333333-3333-4333-8333-333333333333', 'm13_carol', 'user', 0, CAROL_COOKIE),
        ('44444444-4444-4444-8444-444444444444', 'm13_admin', 'admin', 0, ADMIN_COOKIE),
        ('55555555-5555-4555-8555-555555555555', 'm13_disabled', 'user', 1, DISABLED_COOKIE),
    ]
    tables = {'users': [], 'auth_sessions': [], 'entitlement_grants': [], 'usage_attempts': [],
              'orders': [], 'payment_events': [], 'sandbox_credit_packs': [], 'admin_audit': [],
              'admin_settings': [], 'works': [], 'work_references': [], 'video_jobs': [], 'video_history': [],
              'budget_campaigns': [], 'budget_reservations': [], 'scene_access': [], 'auth_rate_limits': []}
    for ident, name, role, disabled, cookie in users:
        tables['users'].append({'id': ident, 'username': name, 'salt': 'synthetic-only',
                                'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                                'role': role, 'disabled': disabled})
        tables['auth_sessions'].append({'hash': hashlib.sha256(cookie.split('=', 1)[1].encode()).hexdigest(),
                                        'user_id': ident, 'expires_at': now + 900000})
    for owner, seconds, total, reserved, used, revoked in [
            (0, 15, 5, 1, 1, 1), (0, 30, 3, 0, 0, 0), (1, 15, 1, 0, 0, 0)]:
        tables['entitlement_grants'].append({'id': str(uuid4()), 'user_id': users[owner][0], 'seconds': seconds,
                                             'environment': 'real_usage', 'source': 'synthetic',
                                             'source_key': str(uuid4()), 'total': total, 'reserved': reserved,
                                             'used': used, 'revoked': revoked})

    created = False
    process = None
    maintenance_process = None
    stub = None
    try:
        fixture('setup', schema, {'tables': tables})
        created = True
        stub = StripeStub()
        process, request, port = start_java(schema, stub.port)

        def call(method, path, cookie=None, headers=None, body=None):
            h = {'Host': HOST, 'Origin': ORIGIN, **(headers or {})}
            if cookie is not None:
                h['Cookie'] = cookie
            return request(method, path, cookie, h, body)

        def state(name='m13_alice'):
            return fixture('payments-state', schema, {'username': name})

        # 门禁与来源
        status = call('GET', '/api/payments/status')
        check(status[0] == 200 and parse(status) == {'testEnabled': True, 'liveEnabled': False}, 'payments status')
        check(call('GET', '/api/payments/orders')[0] == 401, 'orders require login')
        check(call('GET', '/api/payments/orders', cookie=DISABLED_COOKIE)[0] == 401, 'disabled session rejected')
        check(call('GET', '/api/payments/orders', cookie=ALICE_COOKIE, headers={'Host': 'evil.invalid'})[0] == 403, 'orders host check')
        check(call('GET', '/api/payments/orders', cookie=ALICE_COOKIE, headers={'Origin': 'https://evil.invalid'})[0] == 403, 'orders origin check')
        no_origin = request('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                            headers={'Host': HOST, 'Content-Type': 'application/json'}, body=json_body({}))
        check(no_origin[0] == 403 and json.loads(no_origin[2])['error']['code'] == 'ORIGIN_REJECTED', 'checkout origin first')
        check(call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                   headers={'Content-Type': 'text/plain'}, body=b'{}')[0] == 415, 'checkout content type')
        invalid = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE, headers={'Content-Type': 'application/json'},
                       body=json_body({'requestId': str(uuid4()), 'sku': 'tryon-v1-99-1'}))
        check(invalid[0] == 400 and parse(invalid)['error']['code'] == 'INVALID_SKU', 'invalid sku')
        invalid = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE, headers={'Content-Type': 'application/json'},
                       body=json_body({'requestId': 'bad', 'sku': 'tryon-v1-15-1'}))
        check(invalid[0] == 400 and parse(invalid)['error']['code'] == 'INVALID_REQUEST', 'invalid request id')

        # 订单：创建、复用、完成、幂等、查单
        request_id = str(uuid4())
        created_order = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                             headers={'Content-Type': 'application/json'}, body=json_body({'requestId': request_id, 'sku': 'tryon-v1-15-5'}))
        check(created_order[0] == 200, 'checkout created')
        order = parse(created_order)
        check(set(order) == {'orderId', 'url'} and order['url'].startswith('https://checkout.stripe.com/'), 'checkout url shape')
        order_id = order['orderId']
        check(stub.creates == 1, 'single stripe session create')
        snapshot = state()
        check(len(snapshot['orders']) == 1 and snapshot['orders'][0]['state'] == 'pending', 'order pending after create')
        check(snapshot['orders'][0]['sessionId'] in stub.sessions, 'session stored')
        check(json.loads(snapshot['orders'][0]['requestSnapshot'])['client_reference_id'] == order_id, 'snapshot persisted')

        repeat = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                      headers={'Content-Type': 'application/json'}, body=json_body({'requestId': request_id, 'sku': 'tryon-v1-15-5'}))
        check(repeat[0] == 200 and parse(repeat)['orderId'] == order_id and stub.creates == 1, 'same request reuses order')
        conflict = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                        headers={'Content-Type': 'application/json'}, body=json_body({'requestId': request_id, 'sku': 'tryon-v1-30-1'}))
        check(conflict[0] == 409 and parse(conflict)['error']['code'] == 'PAYMENT_CONFLICT', 'same request different sku')

        listing = call('GET', '/api/payments/orders', cookie=ALICE_COOKIE)
        check(listing[0] == 200 and parse(listing)['orders'][0]['state'] == 'pending', 'orders list')
        check(parse(listing)['sandboxCredits'] == {} and parse(listing)['sandboxPointBalance'] == 0, 'sandbox empty before payment')

        session_id = snapshot['orders'][0]['sessionId']
        stub.complete(session_id)
        event = {'id': 'evt_' + secrets.token_hex(8), 'type': 'checkout.session.completed', 'livemode': False,
                 'data': {'object': {'id': session_id}}}
        payload = json_body(event)
        webhook = call('POST', '/api/payments/webhook', headers={'Stripe-Signature': sign(payload)}, body=payload)
        check(webhook[0] == 200 and parse(webhook) == {'received': True}, 'webhook accepted')
        snapshot = state()
        check(snapshot['orders'][0]['state'] == 'paid' and snapshot['orders'][0]['fulfilledAt'], 'order paid')
        grants = [g for g in snapshot['grants'] if g['environment'] == 'stripe_sandbox']
        check(len(grants) == 1 and grants[0]['total'] == 5 and grants[0]['seconds'] == 15, 'sandbox grant issued')
        check(any(e['operationKey'] == 'grant:order:' + order_id for e in snapshot['entries']), 'grant ledger entry')
        check(len(snapshot['events']) == 1 and snapshot['events'][0]['id'] == event['id'], 'payment event stored')
        check(parse(call('GET', '/api/payments/orders', cookie=ALICE_COOKIE))['sandboxCredits'] == {'15': 5}, 'sandbox credits listed')

        replay = call('POST', '/api/payments/webhook', headers={'Stripe-Signature': sign(payload)}, body=payload)
        check(replay[0] == 200 and len(state()['grants']) == len(snapshot['grants']), 'webhook replay idempotent')
        bad = call('POST', '/api/payments/webhook', headers={'Stripe-Signature': 't=1,v1=' + '0' * 64}, body=payload)
        check(bad[0] == 400 and parse(bad)['error']['code'] == 'INVALID_SIGNATURE', 'bad signature rejected')
        live = dict(event, livemode=True)
        live_payload = json_body(live)
        live_response = call('POST', '/api/payments/webhook', headers={'Stripe-Signature': sign(live_payload)}, body=live_payload)
        check(live_response[0] == 400 and parse(live_response)['error']['code'] == 'WRONG_ACCOUNT_MODE', 'live event rejected')

        paid_again = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                          headers={'Content-Type': 'application/json'}, body=json_body({'requestId': request_id, 'sku': 'tryon-v1-15-5'}))
        check(paid_again[0] == 200 and parse(paid_again) == {'orderId': order_id, 'paid': True}, 'paid order short circuit')

        # 积分包 + 查单恢复
        pack_request = str(uuid4())
        pack = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE, headers={'Content-Type': 'application/json'},
                    body=json_body({'requestId': pack_request, 'sku': 'credits-v1-light'}))
        check(pack[0] == 200, 'credit pack checkout')
        pack_order = parse(pack)['orderId']
        pack_session = [o for o in state()['orders'] if o['id'] == pack_order][0]['sessionId']
        stub.complete(pack_session)
        pack_event = {'id': 'evt_' + secrets.token_hex(8), 'type': 'checkout.session.completed', 'livemode': False,
                      'data': {'object': {'id': pack_session}}}
        pack_payload = json_body(pack_event)
        check(call('POST', '/api/payments/webhook', headers={'Stripe-Signature': sign(pack_payload)}, body=pack_payload)[0] == 200,
              'credit pack webhook')
        view = parse(call('GET', '/api/payments/orders', cookie=ALICE_COOKIE))
        check(view['sandboxPointBalance'] == 120 and view['sandboxCreditPacks'][0]['scenes'] == ['tryon', 'video'], 'credit pack issued')
        check(any(o['id'] == pack_order and o.get('planId') == 'light' and o.get('credits') == 120 for o in view['orders']), 'pack order view')

        reconcile = call('POST', '/api/payments/reconcile', cookie=ALICE_COOKIE,
                         headers={'Content-Type': 'application/json'}, body=json_body({'orderId': pack_order}))
        check(reconcile[0] == 200 and 'url' not in parse(reconcile) and parse(reconcile)['sandboxPointBalance'] == 120, 'reconcile paid pack')
        check(call('POST', '/api/payments/reconcile', cookie=ALICE_COOKIE,
                   headers={'Content-Type': 'application/json'}, body=json_body({'orderId': str(uuid4())}))[0] == 404,
              'reconcile foreign order')

        # 金额不符：拒绝且不发放，恢复后重试成功
        mismatch_request = str(uuid4())
        mismatch = parse(call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                              headers={'Content-Type': 'application/json'}, body=json_body({'requestId': mismatch_request, 'sku': 'tryon-v1-30-1'})))
        mismatch_session = [o for o in state()['orders'] if o['id'] == mismatch['orderId']][0]['sessionId']
        stub.complete(mismatch_session, amount=1)
        mismatch_event = {'id': 'evt_' + secrets.token_hex(8), 'type': 'checkout.session.completed', 'livemode': False,
                          'data': {'object': {'id': mismatch_session}}}
        mismatch_payload = json_body(mismatch_event)
        rejected = call('POST', '/api/payments/webhook', headers={'Stripe-Signature': sign(mismatch_payload)}, body=mismatch_payload)
        check(rejected[0] == 409 and parse(rejected)['error']['code'] == 'PAYMENT_MISMATCH', 'amount mismatch rejected')
        check([o for o in state()['orders'] if o['id'] == mismatch['orderId']][0]['state'] == 'pending', 'mismatch did not fulfil')
        stub.complete(mismatch_session, amount=1290)
        check(call('POST', '/api/payments/webhook', headers={'Stripe-Signature': sign(mismatch_payload)}, body=mismatch_payload)[0] == 200,
              'restored amount retried')

        # 替身不可用时保留creating，不重复建单
        stub.stop()
        unknown_request = str(uuid4())
        unavailable = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE, headers={'Content-Type': 'application/json'},
                           body=json_body({'requestId': unknown_request, 'sku': 'tryon-v1-15-1'}))
        check(unavailable[0] == 503, 'stripe outage returns 503')
        unknown = [o for o in state()['orders'] if o['state'] == 'creating']
        check(len(unknown) == 1 and unknown[0]['sessionId'] is None, 'creating order retained without session')
        stub.restart()
        recovered = call('POST', '/api/payments/checkout', cookie=ALICE_COOKIE, headers={'Content-Type': 'application/json'},
                         body=json_body({'requestId': unknown_request, 'sku': 'tryon-v1-15-1'}))
        check(recovered[0] == 200 and parse(recovered)['orderId'] == unknown[0]['id'], 'unknown order recovered without duplicate')
        check(len([o for o in state()['orders'] if o['state'] == 'creating']) == 0, 'no creating order left')

        # 限流窗口：同账号每小时最多10次预留
        for index in range(10):
            response = call('POST', '/api/payments/checkout', cookie=CAROL_COOKIE, headers={'Content-Type': 'application/json'},
                            body=json_body({'requestId': str(uuid4()), 'sku': 'tryon-v1-15-1'}))
            check(response[0] == 200, 'carol checkout ' + str(index))
        limited = call('POST', '/api/payments/checkout', cookie=CAROL_COOKIE, headers={'Content-Type': 'application/json'},
                       body=json_body({'requestId': str(uuid4()), 'sku': 'tryon-v1-15-1'}))
        check(limited[0] == 429 and parse(limited)['error']['code'] == 'RATE_LIMITED', 'checkout rate limit')
        check(len(state('m13_carol')['orders']) == 10, 'rate limited request left no order')

        # 管理：身份、概览、分页、角色、权益、设置、公告、审计
        check(call('GET', '/api/admin/overview')[0] == 401, 'admin anonymous 401')
        check(call('GET', '/api/admin/overview', cookie=ALICE_COOKIE)[0] == 403, 'admin requires role')
        overview = call('GET', '/api/admin/overview', cookie=ADMIN_COOKIE)
        check(overview[0] == 200, 'admin overview')
        overview_value = parse(overview)
        check(overview_value['users'] == 5 and overview_value['admins'] == 1 and overview_value['disabledUsers'] == 1, 'overview counts')
        check(overview_value['sandboxOrders'] == len(state()['orders']) + len(state('m13_carol')['orders']), 'overview orders')
        check([s['scene'] for s in overview_value['services']] == ['studio', 'video', 'prompt'], 'overview services')
        check(all(s['configured'] is False and s['budgetUsd'] is None for s in overview_value['services']), 'scenes disabled honestly')
        check(overview_value['sandboxEnabled'] is True and overview_value['livePaymentsEnabled'] is False, 'payment flags')

        page = call('GET', '/api/admin/users?q=m13_&page=1', cookie=ADMIN_COOKIE)
        check(page[0] == 200 and parse(page)['total'] == 5 and parse(page)['pages'] == 1, 'admin user page')
        check(parse(page)['items'][0]['durations'][0]['seconds'] == 15, 'admin user durations')
        check(call('GET', '/api/admin/users?page=0', cookie=ADMIN_COOKIE)[0] == 400, 'admin invalid page')

        promote_request = str(uuid4())
        promote_body = {'requestId': promote_request, 'reason': '合成角色验证', 'role': 'admin', 'disabled': False}
        promoted = call('POST', '/api/admin/users/22222222-2222-4222-8222-222222222222', cookie=ADMIN_COOKIE,
                        headers={'Content-Type': 'application/json'}, body=json_body(promote_body))
        check(promoted[0] == 200 and parse(promoted) == {'accepted': True}, 'promote bob')
        admin_state = fixture('admin-state', schema, {'username': 'm13_bob'})
        check([u for u in admin_state['users'] if u['username'] == 'm13_bob'][0]['role'] == 'admin', 'bob role persisted')
        check(call('GET', '/api/payments/orders', cookie=BOB_COOKIE)[0] == 401, 'role change revoked sessions')
        check(len(admin_state['audit']) == 1 and json.loads(admin_state['audit'][0]['changes'])['input'] == promote_body,
              'audit stores input')
        replay_promote = call('POST', '/api/admin/users/22222222-2222-4222-8222-222222222222', cookie=ADMIN_COOKIE,
                              headers={'Content-Type': 'application/json'}, body=json_body(promote_body))
        check(replay_promote[0] == 200 and len(fixture('admin-state', schema, {'username': 'm13_bob'})['audit']) == 1,
              'admin replay idempotent')
        conflict_body = dict(promote_body, role='user')
        conflict_admin = call('POST', '/api/admin/users/22222222-2222-4222-8222-222222222222', cookie=ADMIN_COOKIE,
                              headers={'Content-Type': 'application/json'}, body=json_body(conflict_body))
        check(conflict_admin[0] == 409 and parse(conflict_admin)['error']['code'] == 'REQUEST_CONFLICT', 'admin request conflict')
        self_lock = call('POST', '/api/admin/users/44444444-4444-4444-8444-444444444444', cookie=ADMIN_COOKIE,
                         headers={'Content-Type': 'application/json'},
                         body=json_body({'requestId': str(uuid4()), 'reason': '自我锁定', 'role': 'user', 'disabled': False}))
        check(self_lock[0] == 409 and parse(self_lock)['error']['code'] == 'ADMIN_SELF_LOCK', 'admin self lock')
        no_origin_admin = call('POST', '/api/admin/users/22222222-2222-4222-8222-222222222222', cookie=ADMIN_COOKIE,
                               headers={'Content-Type': 'application/json', 'Origin': 'https://evil.invalid'},
                               body=json_body(promote_body))
        check(no_origin_admin[0] == 403, 'admin origin check')

        quota_add = call('POST', '/api/admin/users/11111111-1111-4111-8111-111111111111/quota', cookie=ADMIN_COOKIE,
                         headers={'Content-Type': 'application/json'},
                         body=json_body({'requestId': str(uuid4()), 'reason': '补充权益', 'seconds': 30, 'delta': 2}))
        check(quota_add[0] == 200, 'quota add')
        alice = fixture('admin-state', schema, {'username': 'm13_alice'})
        check(sum(g['total'] - g['revoked'] for g in alice['grants'] if g['seconds'] == 30) == 5, 'quota added')
        check(any(e['operationKey'].startswith('grant:admin:') for e in alice['entries']), 'quota grant entry')
        quota_remove = call('POST', '/api/admin/users/11111111-1111-4111-8111-111111111111/quota', cookie=ADMIN_COOKIE,
                            headers={'Content-Type': 'application/json'},
                            body=json_body({'requestId': str(uuid4()), 'reason': '回收权益', 'seconds': 30, 'delta': -3}))
        check(quota_remove[0] == 200, 'quota remove')
        alice = fixture('admin-state', schema, {'username': 'm13_alice'})
        check(sum(g['total'] - g['reserved'] - g['used'] - g['revoked'] for g in alice['grants'] if g['seconds'] == 30) == 2,
              'quota removed')
        check(any(e['operationKey'].startswith('admin-revoke:') for e in alice['entries']), 'quota revoke entry')
        too_much = call('POST', '/api/admin/users/11111111-1111-4111-8111-111111111111/quota', cookie=ADMIN_COOKIE,
                        headers={'Content-Type': 'application/json'},
                        body=json_body({'requestId': str(uuid4()), 'reason': '过度回收', 'seconds': 30, 'delta': -100}))
        check(too_much[0] == 409 and parse(too_much)['error']['code'] == 'INSUFFICIENT_AVAILABLE', 'quota insufficient')
        zero = call('POST', '/api/admin/users/11111111-1111-4111-8111-111111111111/quota', cookie=ADMIN_COOKIE,
                    headers={'Content-Type': 'application/json'},
                    body=json_body({'requestId': str(uuid4()), 'reason': '零调整', 'seconds': 30, 'delta': 0}))
        check(zero[0] == 400, 'quota zero rejected')

        settings = call('GET', '/api/admin/settings', cookie=ADMIN_COOKIE)
        check(settings[0] == 200 and parse(settings)['services']['version'] == 0, 'settings initial')
        pause = {'requestId': str(uuid4()), 'reason': '暂停实时服务', 'version': 0,
                 'paused': {'studio': True, 'video': False, 'prompt': False}}
        paused = call('POST', '/api/admin/settings/services', cookie=ADMIN_COOKIE,
                      headers={'Content-Type': 'application/json'}, body=json_body(pause))
        check(paused[0] == 200, 'settings pause accepted')
        settings = parse(call('GET', '/api/admin/settings', cookie=ADMIN_COOKIE))
        check(settings['services']['version'] == 1 and settings['services']['studio'] is True, 'settings pause persisted')
        stale = call('POST', '/api/admin/settings/services', cookie=ADMIN_COOKIE,
                     headers={'Content-Type': 'application/json'},
                     body=json_body(dict(pause, requestId=str(uuid4()))))
        check(stale[0] == 409 and parse(stale)['error']['code'] == 'SETTINGS_CONFLICT', 'settings stale version')
        announcement = {'requestId': str(uuid4()), 'reason': '发布维护公告', 'version': 0,
                        'enabled': True, 'zh': '今晚维护', 'en': 'Maintenance tonight'}
        announced = call('POST', '/api/admin/settings/announcement', cookie=ADMIN_COOKIE,
                         headers={'Content-Type': 'application/json'}, body=json_body(announcement))
        check(announced[0] == 200, 'announcement accepted')
        public = call('GET', '/api/site/announcement')
        check(public[0] == 200 and parse(public) == {'version': 1, 'enabled': True, 'zh': '今晚维护', 'en': 'Maintenance tonight'},
              'announcement public')
        clear = {'requestId': str(uuid4()), 'reason': '结束维护公告', 'version': 1, 'enabled': False, 'zh': '', 'en': ''}
        check(call('POST', '/api/admin/settings/announcement', cookie=ADMIN_COOKIE,
                   headers={'Content-Type': 'application/json'}, body=json_body(clear))[0] == 200, 'announcement cleared')
        check(parse(call('GET', '/api/site/announcement')) == {'version': 2, 'enabled': False, 'zh': '', 'en': ''},
              'announcement hidden when disabled')

        audit_page = call('GET', '/api/admin/audit', cookie=ADMIN_COOKIE)
        check(audit_page[0] == 200 and parse(audit_page)['total'] >= 6, 'audit page')
        check(all({'actor', 'action', 'target', 'reason', 'changes', 'createdAt'} <= set(item) for item in parse(audit_page)['items']),
              'audit fields')
        records = call('GET', '/api/admin/records/orders?state=paid&page=1', cookie=ADMIN_COOKIE)
        check(records[0] == 200 and all(item['state'] == 'paid' for item in parse(records)['items']), 'order records filter')
        usage = call('GET', '/api/admin/records/usage', cookie=ADMIN_COOKIE)
        check(usage[0] == 200 and parse(usage)['total'] == 0, 'usage records empty')
        check(call('GET', '/api/admin/records/unknown', cookie=ADMIN_COOKIE)[0] == 400, 'unknown record kind')

        # 维护模式：GET仍可读，写入口503
        maintenance_process, maintenance_request, _ = start_java(schema, stub.port, maintenance=True)
        blocked = maintenance_request('POST', '/api/payments/checkout', cookie=ALICE_COOKIE,
                                      headers={'Host': HOST, 'Origin': ORIGIN, 'Content-Type': 'application/json'},
                                      body=json_body({'requestId': str(uuid4()), 'sku': 'tryon-v1-15-1'}))
        check(blocked[0] == 503 and json.loads(blocked[2])['error']['code'] == 'MAINTENANCE', 'maintenance blocks writes')
        readable = maintenance_request('GET', '/api/admin/overview', cookie=ADMIN_COOKIE, headers={'Host': HOST, 'Origin': ORIGIN})
        check(readable[0] == 200, 'maintenance keeps reads')
        stop_java(maintenance_process)
        maintenance_process = None

        # 进程重启后订单、审计与设置仍在
        creates_before_restart = stub.creates
        stop_java(process)
        process, request, port = start_java(schema, stub.port)

        def call2(method, path, cookie=None, headers=None, body=None):
            h = {'Host': HOST, 'Origin': ORIGIN, **(headers or {})}
            if cookie is not None:
                h['Cookie'] = cookie
            return request(method, path, cookie, h, body)

        after_restart = call2('GET', '/api/payments/orders', cookie=ALICE_COOKIE)
        check(after_restart[0] == 200 and len(parse(after_restart)['orders']) == len(state()['orders']), 'orders survive restart')
        check(parse(call2('GET', '/api/admin/settings', cookie=ADMIN_COOKIE))['services']['studio'] is True, 'settings survive restart')
        check(parse(call2('GET', '/api/admin/audit', cookie=ADMIN_COOKIE))['total'] >= 6, 'audit survives restart')
        check(stub.creates == creates_before_restart, 'no extra provider creates after restart')
    finally:
        if process is not None:
            stop_java(process)
        if maintenance_process is not None:
            stop_java(maintenance_process)
        if stub is not None:
            try:
                stub.stop()
            except Exception:
                pass
        if created:
            fixture('cleanup', schema)
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'realPostgres': True,
                      'syntheticStripe': True, 'providerCalls': 0, 'redisBusinessKeysTouched': False,
                      'temporarySchemaRemoved': created, 'twoJavaProcesses': True}))


if __name__ == '__main__':
    main()
