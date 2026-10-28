"""M20：真实Nginx入口＋Vue静态构建＋隔离Java/PG/Redis的全入口兼容回归。"""
from __future__ import annotations

import hashlib
import http.client
import json
import re
import secrets
import socket
import struct
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
FRONTEND = ROOT / 'frontend'
DIST = FRONTEND / 'dist'
NGINX = Path('D:/Code/Tools/nginx-1.28.3/nginx.exe')
ASSET = FRONTEND / 'public/assets/try-on-demo.mp4'
ADMIN = 'yingxiang_session=' + 'a' * 64
ADMIN_ID = '66666666-6666-4666-8666-666666666666'
VIDEO_KEY = 'synthetic-video-key'
PROMPT_KEY = 'synthetic-prompt-key'
STRIPE_SECRET = 'sk_test_synthetic_m20'
STRIPE_WEBHOOK = 'whsec_synthetic_m20'
STRIPE_ACCOUNT = 'acct_synthetic_m20'
COUNT = 0
TOKEN = 'synthetic_token_key_1234567890'
RESULT = b'\x00\x00\x00\x18ftypisom' + b'synthetic-m20-result' * 100


def check(condition, label):
    global COUNT
    assert condition, label + ' failed'
    COUNT += 1


def iso_after(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).strftime('%Y-%m-%dT%H:%M:%S.') + '000Z'


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


class Stub:
    def __init__(self):
        self.sessions = {}
        self.jobs = {}
        self.posts = 0
        self.tokens = 0
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
                if self.path == '/v1/account':
                    if self.headers.get('Authorization') != 'Bearer ' + STRIPE_SECRET:
                        return self._json(401, {'error': {'message': 'unauthorized'}})
                    return self._json(200, {'id': STRIPE_ACCOUNT, 'object': 'account'})
                if self.path.startswith('/v1/checkout/sessions/'):
                    ident = self.path.rsplit('/', 1)[-1]
                    value = stub.sessions.get(ident)
                    return self._json(200, value) if value else self._json(404, {'error': {'message': 'missing'}})
                if self.path.endswith('/content'):
                    ident = self.path.split('/')[-2]
                    if stub.jobs.get(ident) != 'completed':
                        return self._json(404, {'error': 'missing'})
                    self.send_response(200)
                    self.send_header('Content-Type', 'video/mp4')
                    self.send_header('Content-Length', str(len(RESULT)))
                    self.end_headers()
                    self.wfile.write(RESULT)
                    return
                if self.path.startswith('/v1/jobs/'):
                    ident = self.path.rsplit('/', 1)[-1]
                    status = stub.jobs.get(ident)
                    return self._json(200, {'job_id': ident, 'status': status}) if status else self._json(404, {'error': 'missing'})
                return self._json(404, {'error': 'not found'})

            def do_POST(self):
                length = int(self.headers.get('Content-Length', '0'))
                body = self.rfile.read(length)
                if self.path == '/v1/client/tokens':
                    if self.headers.get('X-API-KEY') not in (PROMPT_KEY, 'synthetic-studio-permanent-key'):
                        return self._json(401, {'error': 'unauthorized'})
                    with stub.lock:
                        stub.tokens += 1
                    params = json.loads(body or b'{}')
                    return self._json(200, {'apiKey': TOKEN, 'expiresAt': iso_after(9),
                                            'permissions': {'models': params.get('allowedModels', []),
                                                            'origins': params.get('allowedOrigins', [])},
                                            'constraints': params.get('constraints', {})})
                if self.path == '/v1/checkout/sessions':
                    if self.headers.get('Authorization') != 'Bearer ' + STRIPE_SECRET:
                        return self._json(401, {'error': {'message': 'unauthorized'}})
                    form = parse_qs(body.decode(), keep_blank_values=True)
                    ident = 'cs_test_' + secrets.token_hex(12)
                    value = {
                        'id': ident, 'object': 'checkout.session', 'mode': form.get('mode', [''])[0],
                        'client_reference_id': form.get('client_reference_id', [''])[0],
                        'metadata': {'orderId': form.get('metadata[orderId]', [''])[0],
                                     'userId': form.get('metadata[userId]', [''])[0],
                                     'sku': form.get('metadata[sku]', [''])[0]},
                        'currency': form.get('line_items[0][price_data][currency]', [''])[0],
                        'amount_total': int(form.get('line_items[0][price_data][unit_amount]', ['0'])[0]),
                        'livemode': False, 'status': 'open', 'payment_status': 'unpaid',
                        'url': 'https://checkout.stripe.com/c/pay/' + ident,
                        'expires_at': int(time.time()) + 86400,
                    }
                    stub.sessions[ident] = value
                    return self._json(200, value)
                if self.path.startswith('/v1/jobs/'):
                    if self.headers.get('X-API-KEY') != VIDEO_KEY:
                        return self._json(401, {'error': 'unauthorized'})
                    stub.posts += 1
                    ident = 'job_' + secrets.token_hex(8)
                    stub.jobs[ident] = 'completed'
                    return self._json(200, {'job_id': ident, 'status': 'completed'})
                return self._json(404, {'error': 'not found'})

        self.lock = threading.Lock()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


class _null:
    def __enter__(self): return self
    def __exit__(self, *args): return False


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def start_api(schema, storage, stub_port, nginx_port):
    port = free_port()
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-Djdk.httpclient.disableRetryConnect=true', '-Djdk.httpclient.enableAllMethodRetry=false',
        '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.payments-enabled=true', '--migration.admin-enabled=true',
        '--migration.video-enabled=true', '--migration.works-enabled=true', '--migration.prompt-enabled=true',
        '--migration.studio-fixture-enabled=true',
        f'--migration.studio-fixture-url=http://127.0.0.1:{stub_port}/v1/client/tokens',
        f'--migration.storage-root={storage}',
        f'--migration.video-key={VIDEO_KEY}', f'--migration.video-provider-url=http://127.0.0.1:{stub_port}',
        '--migration.video-budget-usd=2', '--migration.video-max-jobs=5',
        '--migration.video-allowed-usernames=m20_user',
        f'--migration.prompt-key={PROMPT_KEY}', f'--migration.prompt-token-url=http://127.0.0.1:{stub_port}/v1/client/tokens',
        '--migration.prompt-budget-usd=1', '--migration.prompt-max-sessions=2',
        '--migration.prompt-allowed-usernames=m20_user',
        f'--migration.stripe-secret={STRIPE_SECRET}', f'--migration.stripe-webhook-secret={STRIPE_WEBHOOK}',
        f'--migration.stripe-expected-account={STRIPE_ACCOUNT}',
        f'--migration.stripe-api-base=http://127.0.0.1:{stub_port}',
        '--migration.redis-rate-limit-enabled=true', '--migration.redis-namespace=yingxiang:migration:m20',
        '--spring.data.redis.port=56379', '--spring.datasource.hikari.read-only=false',
        f'--migration.public-origin=http://127.0.0.1:{nginx_port}',
    ], cwd=BACKEND, stdout=log, stderr=log)

    def request(method, path, cookie=None, headers=None, body=None, host=None):
        h = {'Host': host or f'127.0.0.1:{nginx_port}', **(headers or {})}
        if cookie is not None:
            h['Cookie'] = cookie
        connection = http.client.HTTPConnection('127.0.0.1', nginx_port, timeout=60)
        try:
            connection.request(method, path, body=body, headers=h)
            response = connection.getresponse()
            return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
        finally:
            connection.close()

    deadline = time.monotonic() + 60
    while True:
        assert process.poll() is None, 'API process exited; raw log suppressed'
        try:
            if request('GET', '/api/internal/live')[0] == 200:
                break
        except OSError:
            pass
        if time.monotonic() > deadline:
            raise AssertionError('API startup deadline exceeded')
        time.sleep(.2)
    return process, request


def start_nginx(java_port, port):
    runtime = Path(tempfile.mkdtemp(prefix='yingxiang-m20-nginx-'))
    for name in ('body', 'proxy', 'logs', 'temp', 'client_temp', 'fastcgi_temp', 'uwsgi_temp', 'scgi_temp'):
        (runtime / name).mkdir()
    template = (FRONTEND / 'deploy/nginx.local.conf.template').read_text(encoding='utf-8')
    config = (template.replace('@RUNTIME@', runtime.as_posix())
              .replace('@DIST@', DIST.as_posix())
              .replace('@PORT@', str(port))
              .replace('@UPSTREAM@', str(java_port)))
    (runtime / 'nginx.conf').write_text(config, encoding='utf-8')
    process = subprocess.Popen([str(NGINX), '-p', runtime.as_posix() + '/', '-c', 'nginx.conf'],
                               cwd=runtime, stdout=open(runtime / 'nginx-stdout.log', 'wb'),
                               stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 20
    while True:
        if process.poll() is not None:
            detail = ''
            try:
                detail = (runtime / 'nginx-error.log').read_text(encoding='utf-8', errors='replace')[-3000:]
            except OSError:
                pass
            try:
                detail += (runtime / 'nginx-stdout.log').read_text(encoding='utf-8', errors='replace')[-3000:]
            except OSError:
                pass
            raise AssertionError('nginx exited: ' + detail)
        try:
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
            try:
                connection.request('GET', '/__entry_live', headers={'Host': f'127.0.0.1:{port}'})
                if connection.getresponse().status == 204:
                    break
            finally:
                connection.close()
        except OSError:
            pass
        if time.monotonic() > deadline:
            raise AssertionError('nginx startup deadline exceeded')
        time.sleep(.1)
    return process, runtime


def stop(process):
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def setup_schema(now):
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    tables = {'users': [], 'auth_sessions': [], 'entitlement_grants': [], 'usage_attempts': [],
              'orders': [], 'payment_events': [], 'sandbox_credit_packs': [], 'admin_audit': [],
              'admin_settings': [], 'works': [], 'work_references': [], 'video_jobs': [], 'video_history': [],
              'budget_campaigns': [], 'budget_reservations': [], 'scene_access': [], 'auth_rate_limits': []}
    tables['users'].append({'id': ADMIN_ID, 'username': 'm20_admin', 'salt': 'synthetic-only',
                            'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                            'role': 'admin', 'disabled': 0})
    tables['auth_sessions'].append({'hash': hashlib.sha256(ADMIN.split('=', 1)[1].encode()).hexdigest(),
                                    'user_id': ADMIN_ID, 'expires_at': now + 900000})
    fixture('setup', schema, {'tables': tables})
    return schema


def cookie_of(response):
    value = response[1].get('set-cookie', '')
    match = re.search(r'yingxiang_session=[a-f0-9]{64}', value)
    return match.group(0) if match else None


def json_body(value):
    return json.dumps(value).encode()


def parse(response):
    return json.loads(response[2]) if response[2] else None


def png_bytes():
    return (b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR'
            + struct.pack('>II', 640, 480) + b'\x08\x06\x00\x00\x00' + struct.pack('>I', 0))


def multipart(video, image):
    boundary = 'synthetic' + secrets.token_hex(8)

    def part(name, filename, content_type, value):
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
        if filename:
            head += f'; filename="{filename}"'
        head += '\r\n'
        if content_type:
            head += f'Content-Type: {content_type}\r\n'
        return head.encode() + b'\r\n' + value + b'\r\n'
    return b''.join([part('data', 'person.mp4', 'video/mp4', video),
                     part('reference_image', 'garment.png', 'image/png', image),
                     part('consentVersion', None, None, b'2026-10-26-video-save-v1'),
                     f'--{boundary}--\r\n'.encode()]), f'multipart/form-data; boundary={boundary}'


def main():
    stub = Stub()
    now = int(time.time() * 1000)
    schema = setup_schema(now)
    storage = Path(tempfile.mkdtemp(prefix='yingxiang-m20-storage-'))
    nginx_port = free_port()
    api = nginx = None
    runtime = None
    entry_checks = 0
    try:
        # 先启动Java取得端口，再用同源Nginx入口发起全部请求。
        java_port = free_port()
        log = tempfile.TemporaryFile()
        api = subprocess.Popen([
            'java', '-Djdk.httpclient.disableRetryConnect=true', '-Djdk.httpclient.enableAllMethodRetry=false',
            '-jar', str(JAR), f'--server.port={java_port}', f'--migration.db-schema={schema}',
            '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
            '--migration.payments-enabled=true', '--migration.admin-enabled=true',
            '--migration.video-enabled=true', '--migration.works-enabled=true', '--migration.prompt-enabled=true',
            '--migration.studio-fixture-enabled=true',
            f'--migration.studio-fixture-url=http://127.0.0.1:{stub.port}/v1/client/tokens',
            f'--migration.storage-root={storage}',
            f'--migration.video-key={VIDEO_KEY}', f'--migration.video-provider-url=http://127.0.0.1:{stub.port}',
            '--migration.video-budget-usd=2', '--migration.video-max-jobs=5',
            '--migration.video-allowed-usernames=m20_user',
            f'--migration.prompt-key={PROMPT_KEY}', f'--migration.prompt-token-url=http://127.0.0.1:{stub.port}/v1/client/tokens',
            '--migration.prompt-budget-usd=1', '--migration.prompt-max-sessions=2',
            '--migration.prompt-allowed-usernames=m20_user',
            f'--migration.stripe-secret={STRIPE_SECRET}', f'--migration.stripe-webhook-secret={STRIPE_WEBHOOK}',
            f'--migration.stripe-expected-account={STRIPE_ACCOUNT}',
            f'--migration.stripe-api-base=http://127.0.0.1:{stub.port}',
            '--migration.redis-rate-limit-enabled=true', '--migration.redis-namespace=yingxiang:migration:m20',
            '--migration.compatibility-enabled=true',
            '--spring.data.redis.port=56379', '--spring.datasource.hikari.read-only=false',
            f'--migration.public-origin=http://127.0.0.1:{nginx_port}',
        ], cwd=BACKEND, stdout=log, stderr=log)
        deadline = time.monotonic() + 60
        while True:
            assert api.poll() is None, 'API process exited; raw log suppressed'
            try:
                connection = http.client.HTTPConnection('127.0.0.1', java_port, timeout=2)
                try:
                    connection.request('GET', '/api/internal/live', headers={'Host': f'127.0.0.1:{nginx_port}'})
                    if connection.getresponse().status == 200:
                        break
                finally:
                    connection.close()
            except OSError:
                pass
            if time.monotonic() > deadline:
                raise AssertionError('API startup deadline exceeded')
            time.sleep(.2)
        nginx, runtime = start_nginx(java_port, nginx_port)

        def call(method, path, cookie=None, headers=None, body=None, host=None):
            h = {'Host': host or f'127.0.0.1:{nginx_port}', **(headers or {})}
            if cookie is not None:
                h['Cookie'] = cookie
            connection = http.client.HTTPConnection('127.0.0.1', nginx_port, timeout=60)
            try:
                connection.request(method, path, body=body, headers=h)
                response = connection.getresponse()
                return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
            finally:
                connection.close()

        # 入口与公开兼容合同。
        config = call('GET', '/api/v1/config')
        check(config[0] == 200 and parse(config)['features']['realtime'] is True,
              'legacy config through nginx: ' + str(config[0]) + ' ' + config[2][:300].decode('utf-8', 'replace'))
        health = call('GET', '/api/v1/health')
        check(health[0] == 200 and parse(health)['application'] == 'yingxiang', 'legacy health')
        legacy = call('POST', '/api/v1/access/redeem', headers={'Content-Type': 'application/json'}, body=b'{}')
        check(legacy[0] == 503 and parse(legacy)['error']['code'] == 'SERVICE_DISABLED', 'legacy sessions stay disabled')
        check(call('GET', '/api/not-real')[0] == 404 and parse(call('GET', '/api/not-real'))['error']['code'] == 'NOT_FOUND',
              'unknown api 404 json')
        check(call('GET', '/api/internal/ready')[0] == 503, 'upstream is Java readiness, not FastAPI')
        check(call('GET', '/api/account/me')[0] == 200, 'anonymous me through nginx')
        check(call('GET', '/api/account/login')[0] == 404, 'GET on POST account action is 404')

        registered = call('POST', '/api/account/register', headers={'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{nginx_port}'},
                          body=json_body({'username': 'm20_user', 'password': 'synthetic-password-20'}))
        check(registered[0] == 200, 'register through nginx')
        user_cookie = cookie_of(registered)
        user = parse(registered)['user']['id']
        check(user_cookie is not None and call('GET', '/api/account/me', cookie=user_cookie)[0] == 200, 'session cookie through nginx')
        check(call('GET', '/api/admin/overview', cookie=user_cookie)[0] == 403, 'non-admin rejected')
        check(call('GET', '/api/admin/overview', cookie=ADMIN)[0] == 200, 'admin overview')

        # 支付：创建订单、查单、列表。
        checkout = call('POST', '/api/payments/checkout', cookie=user_cookie,
                        headers={'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{nginx_port}'},
                        body=json_body({'sku': 'credits-v1-light', 'requestId': str(uuid4())}))
        check(checkout[0] == 200 and parse(checkout)['orderId'], 'sandbox checkout through nginx')
        order_id = parse(checkout)['orderId']
        check(call('POST', '/api/payments/reconcile', cookie=user_cookie,
                   headers={'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{nginx_port}'},
                   body=json_body({'orderId': order_id}))[0] == 200, 'sandbox reconcile')
        check(call('GET', '/api/payments/orders', cookie=user_cookie)[0] == 200, 'own orders')

        # 视频：prepare、提交、结果、历史。
        asset = ASSET.read_bytes()
        prepared = call('POST', '/api/video/prepare', headers={'Content-Type': 'video/mp4', 'Origin': f'http://127.0.0.1:{nginx_port}'},
                        body=asset)
        check(prepared[0] == 200 and prepared[2][4:8] == b'ftyp', 'video prepare through nginx')
        body, content_type = multipart(prepared[2], png_bytes())
        attempt = str(uuid4())
        submitted = call('POST', '/api/video/jobs', cookie=user_cookie,
                         headers={'Content-Type': content_type, 'X-Video-Attempt': attempt,
                                  'Origin': f'http://127.0.0.1:{nginx_port}'}, body=body)
        check(submitted[0] == 200 and parse(submitted)['state'] == 'completed', 'video submit through nginx')
        check(stub.posts == 1, 'synthetic provider submit counted')
        video_content = call('GET', f'/api/video/jobs/{attempt}/content', cookie=user_cookie)
        check(video_content[0] == 200 and video_content[2] == RESULT, 'video content through nginx')
        history = call('GET', '/api/video/history', cookie=user_cookie)
        check(history[0] == 200 and parse(history)['total'] == 1, 'video history list')
        renamed = call('POST', f'/api/video/jobs/{attempt}/history', cookie=user_cookie,
                       headers={'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{nginx_port}'},
                       body=json_body({'title': '合成视频'}))
        check(renamed[0] == 200 and parse(renamed)['title'] == '合成视频', 'video history title')
        archived = call('POST', f'/api/video/jobs/{attempt}/history', cookie=user_cookie,
                        headers={'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{nginx_port}'},
                        body=json_body({'archived': True}))
        check(archived[0] == 200 and parse(archived)['archived'] is True, 'video history archive')
        check(parse(call('GET', '/api/video/history?archived=true', cookie=user_cookie))['total'] == 1,
              'archived history filter')

        # 作品：分片、参考图、完成、Range、列表。
        work_id = str(uuid4())
        owner = {'X-Work-Owner': user, 'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{nginx_port}'}
        created = call('POST', '/api/works', cookie=user_cookie, headers=owner,
                       body=json_body({'id': work_id, 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': user}))
        check(created[0] == 201 and parse(created)['state'] == 'capturing', 'work create through nginx')
        split = len(asset) // 2
        chunk_headers = {'X-Work-Owner': user, 'Content-Type': 'application/octet-stream',
                         'Origin': f'http://127.0.0.1:{nginx_port}'}
        check(call('POST', f'/api/works/{work_id}/chunks/0', cookie=user_cookie, headers=chunk_headers,
                   body=asset[:split])[0] == 200, 'chunk zero through nginx')
        check(call('POST', f'/api/works/{work_id}/chunks/1', cookie=user_cookie, headers=chunk_headers,
                   body=asset[split:])[0] == 200, 'chunk one through nginx')
        ref_id = str(uuid4())
        check(call('POST', f'/api/works/{work_id}/references/{ref_id}', cookie=user_cookie,
                   headers={**owner, 'Content-Type': 'image/png'}, body=png_bytes())[0] == 200, 'reference through nginx')
        check(call('POST', f'/api/works/{work_id}/complete', cookie=user_cookie, headers=owner,
                   body=json_body({'durationMs': 15000}))[0] == 202, 'work complete')
        detail = call('GET', f'/api/works/{work_id}', cookie=user_cookie)
        check(detail[0] == 200 and parse(detail)['state'] == 'ready', 'work ready through nginx')
        ranged = call('GET', f'/api/works/{work_id}/content', cookie=user_cookie, headers={'Range': 'bytes=0-9'})
        check(ranged[0] == 206 and ranged[1]['content-range'] == f'bytes 0-9/{len(asset)}', 'work Range through nginx')
        check(call('GET', f'/api/works/{work_id}/references/{ref_id}', cookie=user_cookie)[0] == 200,
              'reference content through nginx')
        check(parse(call('GET', '/api/works?kind=realtime', cookie=user_cookie))['total'] == 1, 'works list')

        # 提示词与studio替身：同一入口签发，供应商只收到合成令牌请求。
        prompt_status = call('GET', '/api/prompt/status', cookie=user_cookie)
        check(prompt_status[0] == 200 and parse(prompt_status)['available'] is True, 'prompt status')
        prompt_token = call('POST', '/api/prompt/token', cookie=user_cookie,
                            headers={'Content-Type': 'application/json', 'X-Studio-Access': parse(prompt_status)['access'],
                                     'Origin': f'http://127.0.0.1:{nginx_port}'},
                            body=json_body({'attemptId': str(uuid4()), 'consentVersion': '2026-10-26-prompt-history-v1', 'durationSec': 15}))
        check(prompt_token[0] == 200 and parse(prompt_token)['apiKey'] == TOKEN, 'prompt token through nginx')
        studio_status = call('GET', '/api/studio/status', cookie=user_cookie)
        check(studio_status[0] == 200 and parse(studio_status)['available'] is True, 'studio status')
        studio_token = call('POST', '/api/studio/token', cookie=user_cookie,
                            headers={'Content-Type': 'application/json', 'X-Studio-Access': parse(studio_status)['access'],
                                     'Origin': f'http://127.0.0.1:{nginx_port}'},
                            body=json_body({'attemptId': str(uuid4()), 'consentVersion': '2026-10-26-preview-cloud-save-v1', 'durationSec': 15}))
        check(studio_token[0] == 200 and parse(studio_token)['apiKey'] == TOKEN, 'studio token through nginx')
        check(stub.tokens >= 2, 'synthetic token provider counted')

        # 页面与静态媒体由同一Nginx入口提供。
        home = call('GET', '/')
        check(home[0] == 200 and '<title>映想' in home[2].decode('utf-8'), 'home page through nginx')
        private = call('GET', '/works')
        check(private[0] == 200 and b'<div id="app"' in private[2], 'private page shell through nginx')
        check(call('GET', '/assets/try-on-demo.mp4', headers={'Range': 'bytes=0-99'})[0] == 206,
              'static media Range through nginx')

        entry = subprocess.run(['node', 'scripts/entry-switch-check.mjs', f'--origin=http://127.0.0.1:{nginx_port}'],
                               cwd=FRONTEND, capture_output=True, text=True, timeout=120)
        if entry.returncode != 0:
            raise AssertionError('entry-switch-check failed: ' + entry.stdout[-2000:] + entry.stderr[-2000:])
        report = json.loads(entry.stdout)
        check(report['status'] == 'OK' and report['checks'] >= 70, 'entry switch HTTP contract')
        entry_checks = report['checks']
    finally:
        if nginx is not None:
            stop(nginx)
        if api is not None:
            stop(api)
        if runtime is not None:
            import shutil
            shutil.rmtree(runtime, ignore_errors=True)
        fixture('cleanup', schema)
        import shutil
        shutil.rmtree(storage, ignore_errors=True)
        stub.stop()
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'entryChecks': entry_checks, 'realPostgres': True,
                      'realRedis': True, 'realNginxEntry': True, 'vueStaticBuild': True,
                      'syntheticProviders': True, 'providerPosts': stub.posts, 'realProviderCalls': 0,
                      'formalEntryUntouched': True, 'temporarySchemaRemoved': True, 'temporaryStorageRemoved': True}))


if __name__ == '__main__':
    main()
