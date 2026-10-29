"""M19：真实临时PG＋Redis＋代理断连／重启／淘汰的限流与上传门禁合同回归。"""
from __future__ import annotations

import hashlib
import http.client
import json
import secrets
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
ORIGIN = 'http://127.0.0.1:8791'
HOST = '127.0.0.1:8791'
KEY = 'synthetic-m19-key'
ALICE = 'yingxiang_session=' + '8' * 64
SUNY = 'yingxiang_session=' + '9' * 64
ALICE_ID = '44444444-4444-4444-8444-444444444444'
SUNY_ID = '55555555-5555-4555-8555-555555555555'
JOB_READ = '00000000-0000-4000-8000-000000000021'
JOB_WORK = '00000000-0000-4000-8000-000000000022'
REDIS_HOST, REDIS_PORT = '127.0.0.1', 56379
REDIS_PASSWORD = 'synthetic_redis_password'
RESULT = b'\x00\x00\x00\x18ftypisom' + b'synthetic-m19-result' * 100
COUNT = 0


def check(condition, label):
    global COUNT
    assert condition, label + ' failed'
    COUNT += 1


def parse(response):
    body = response[2]
    if not body:
        return None
    value = json.loads(body)
    if isinstance(value, dict) and value.get('code') == 0:
        return value.get('data')
    return value


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


class ProviderStub:
    def __init__(self):
        self.jobs = {'job_read': 'completed', 'job_work': 'completed'}
        self.posts = 0
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
                if self.headers.get('X-API-KEY') != KEY:
                    return self._json(401, {'error': 'unauthorized'})
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
                ident = self.path.rsplit('/', 1)[-1]
                status = stub.jobs.get(ident)
                return self._json(200, {'job_id': ident, 'status': status}) if status else self._json(404, {'error': 'missing'})

            def do_POST(self):
                stub.posts += 1
                return self._json(500, {'error': 'must not post'})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


class RedisProxy:
    def __init__(self, listen_port):
        self.listen_port = listen_port
        self.server = None
        self.thread = None
        self.active = set()
        self.lock = threading.Lock()
        proxy = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                try:
                    upstream = socket.create_connection((REDIS_HOST, REDIS_PORT), timeout=5)
                    upstream.settimeout(None)
                except OSError:
                    return
                with proxy.lock:
                    proxy.active.update((self.request, upstream))
                try:
                    left = threading.Thread(target=self.relay, args=(self.request, upstream), daemon=True)
                    left.start()
                    self.relay(upstream, self.request)
                    left.join(1)
                finally:
                    for item in (self.request, upstream):
                        try: item.close()
                        except OSError: pass
                        with proxy.lock:
                            proxy.active.discard(item)

            @staticmethod
            def relay(source, target):
                try:
                    while True:
                        data = source.recv(65536)
                        if not data:
                            break
                        target.sendall(data)
                except OSError:
                    pass

        class Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True
        self.handler = Handler
        self.server_class = Server

    def start(self):
        self.server = self.server_class(('127.0.0.1', self.listen_port), self.handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        with self.lock:
            for item in list(self.active):
                try: item.shutdown(socket.SHUT_RDWR)
                except OSError: pass
                try: item.close()
                except OSError: pass
            self.active.clear()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def read_reply(sock):
    prefix = sock.recv(1)
    if not prefix:
        raise OSError('closed')
    line = b''
    while not line.endswith(b'\r\n'):
        line += sock.recv(1)
    body = line[:-2]
    if prefix == b'+': return body.decode()
    if prefix == b'-': raise RuntimeError(body.decode())
    if prefix == b':': return int(body)
    if prefix == b'$':
        length = int(body)
        if length < 0: return None
        data = b''
        while len(data) < length + 2:
            data += sock.recv(length + 2 - len(data))
        return data[:-2]
    if prefix == b'*':
        count = int(body)
        return [read_reply(sock) for _ in range(count)]
    raise RuntimeError('unknown reply')


def redis(*args):
    sock = socket.create_connection((REDIS_HOST, REDIS_PORT), timeout=5)
    try:
        def send(values):
            payload = f'*{len(values)}\r\n'.encode()
            for value in values:
                data = str(value).encode()
                payload += f'${len(data)}\r\n'.encode() + data + b'\r\n'
            sock.sendall(payload)
        send(('AUTH', REDIS_PASSWORD))
        read_reply(sock)
        send(args)
        return read_reply(sock)
    finally:
        sock.close()


def start_api(schema, storage, provider_port, redis_port):
    port = free_port()
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-Djdk.httpclient.disableRetryConnect=true', '-Djdk.httpclient.enableAllMethodRetry=false',
        '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.video-enabled=true', '--migration.works-enabled=true', '--migration.prompt-enabled=true',
        '--migration.payments-enabled=true', f'--migration.storage-root={storage}',
        f'--migration.video-key={KEY}', f'--migration.video-provider-url=http://127.0.0.1:{provider_port}',
        '--migration.prompt-key=synthetic-prompt-key', '--migration.prompt-budget-usd=0',
        '--migration.prompt-max-sessions=0', '--migration.prompt-allowed-usernames=suny',
        '--migration.prompt-unlimited-usernames=suny',
        '--migration.stripe-secret=sk_test_synthetic', '--migration.stripe-webhook-secret=whsec_synthetic',
        '--migration.stripe-expected-account=acct_synthetic', '--migration.stripe-api-base=http://127.0.0.1:1',
        '--migration.redis-rate-limit-enabled=true', '--migration.redis-import-windows=true',
        '--migration.redis-gate-seconds=2', '--migration.redis-namespace=yingxiang:migration:test',
        f'--spring.data.redis.port={redis_port}', '--spring.datasource.hikari.read-only=false',
        f'--migration.public-origin={ORIGIN}',
    ], cwd=BACKEND, stdout=log, stderr=log)

    def request(method, path, cookie=None, headers=None, body=None):
        h = {'Host': HOST, 'Origin': ORIGIN, **(headers or {})}
        if cookie is not None:
            h['Cookie'] = cookie
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=30)
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


def start_worker(schema, storage, provider_port):
    port = free_port()
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-Djdk.httpclient.disableRetryConnect=true', '-Djdk.httpclient.enableAllMethodRetry=false',
        '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.role=worker', '--migration.worker-enabled=true', f'--migration.worker-id=m19-worker',
        f'--migration.storage-root={storage}', f'--migration.video-key={KEY}',
        f'--migration.video-provider-url=http://127.0.0.1:{provider_port}',
        '--migration.worker-lease-ms=5000', '--migration.worker-retry-ms=300', '--migration.worker-poll-ms=100',
        f'--migration.public-origin={ORIGIN}', '--spring.datasource.hikari.read-only=false',
    ], cwd=BACKEND, stdout=log, stderr=log)
    deadline=time.monotonic()+60
    while True:
        if process.poll() is not None:
            import re
            log.seek(0)
            safe=log.read().decode('utf-8',errors='replace')
            beans=re.findall("Error creating bean with name '([A-Za-z0-9]+)'",safe)
            causes=re.findall(r'Caused by: ([A-Za-z0-9.$]+)',safe)
            raise AssertionError('worker startup failed: beans='+str(beans)+' causes='+str(causes)+' exit='+str(process.returncode)+' summary='+str([line for line in safe.splitlines() if any(word in line for word in ['WebApplicationType','required a bean','Consider defining','non-web','APPLICATION FAILED','Web server failed'])]))
        log.seek(0)
        ready=b'YINGXIANG_WORKER_READY' in log.read()
        log.seek(0,2)
        if ready: break
        assert time.monotonic()<deadline, 'worker startup timeout'
        time.sleep(.1)
    with socket.socket() as probe:
        probe.settimeout(1)
        check(probe.connect_ex(('127.0.0.1',port))!=0, 'worker has no HTTP listener')
    return process


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
              'budget_campaigns': [{'scene': 'video', 'created_at': now - 1000}],
              'budget_reservations': [], 'scene_access': [],
              'auth_rate_limits': [{'key': 'auth:m19_alice', 'count': 9, 'until': now + 900000}]}
    for ident, name, cookie in ((ALICE_ID, 'm19_alice', ALICE), (SUNY_ID, 'suny', SUNY)):
        tables['users'].append({'id': ident, 'username': name, 'salt': 'synthetic-only',
                                'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                                'role': 'user', 'disabled': 0})
        tables['auth_sessions'].append({'hash': hashlib.sha256(cookie.split('=', 1)[1].encode()).hexdigest(),
                                        'user_id': ident, 'expires_at': now + 900000})
    for ident, provider in ((JOB_READ, 'job_read'), (JOB_WORK, 'job_work')):
        tables['video_jobs'].append({'id': ident, 'user_id': ALICE_ID, 'state': 'completed', 'created_at': now - 5000,
                                     'expires_at': now + 3600000, 'seconds_milli': 9000, 'micro_usd': 360000,
                                     'provider_id': provider, 'checked_at': None})
        tables['budget_reservations'].append({'id': ident, 'scene': 'video', 'user_id': ALICE_ID,
                                              'micro_usd': 360000, 'lease_until': now + 3600000,
                                              'created_at': now - 5000})
    fixture('setup', schema, {'tables': tables})
    return schema


def works(schema):
    return {work['sourceId'] or work['id']: work
            for work in fixture('works-state', schema, {'username': 'm19_alice'})['works']}


def wait_for(predicate, label, timeout=20, diagnostic=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.1)
    detail = '' if diagnostic is None else ' ' + json.dumps(diagnostic(), ensure_ascii=False)
    raise AssertionError(label + ' timed out' + detail)


def prepare(request, cookie=None):
    return request('POST', '/api/video/prepare', cookie=cookie,
                   headers={'Content-Type': 'video/mp4'}, body=b'x')


def main():
    stub = ProviderStub()
    now = int(time.time() * 1000)
    schema = setup_schema(now)
    storage = Path(tempfile.mkdtemp(prefix='yingxiang-m19-storage-'))
    proxy_port = free_port()
    proxy = RedisProxy(proxy_port)
    proxy.start()
    for key in ('auth:global', 'auth:m19_alice', 'signup', 'video-prepare:global'):
        redis('DEL', 'yingxiang:migration:test:rate:' + key)
    # 目标已有更小计数和更短窗口，必须原子提升至旧库窗口。
    redis("SET", "yingxiang:migration:test:rate:auth:m19_alice", 1, "PX", 60000)
    api = worker = None
    try:
        api, request = start_api(schema, storage, stub.port, proxy_port)
        state = fixture('rate-limit-state', schema)
        imported = [item for item in state['shadows'] if item['key'] == 'auth:m19_alice']
        check(imported and imported[0]['count'] == 9, 'old PG window imported into shadow')
        check(int(redis('GET', 'yingxiang:migration:test:rate:auth:m19_alice')) == 9,
              'old window count imported without increase')

        wrong = {'Content-Type': 'application/json'}
        first = request('POST', '/api/account/login', headers=wrong,
                        body=json.dumps({'username': 'm19_alice', 'password': 'wrong-password'}).encode())
        second = request('POST', '/api/account/login', headers=wrong,
                         body=json.dumps({'username': 'm19_alice', 'password': 'wrong-password'}).encode())
        check(first[0] == 401, 'old window allows one more attempt')
        check(second[0] == 429 and parse(second[2])['reason'] == 'RATE_LIMITED',
              'old window limit enforced atomically')
        check(int(redis('GET', 'yingxiang:migration:test:rate:auth:m19_alice')) == 11,
              'redis count advanced from imported floor')

        check(redis('PTTL','yingxiang:migration:test:rate:auth:m19_alice') > 60000, 'import does not shorten old window')
        stop(api)
        api, request=start_api(schema,storage,stub.port,proxy_port)
        check(int(redis('GET','yingxiang:migration:test:rate:auth:m19_alice'))==11, 'repeat import neither adds nor reduces count')
        holder = fixture('upload-acquire' , schema, {'owner': 'fixture-holder', 'leaseMs': 30000})
        check(holder.get('acquired') is True, 'fixture holds global upload slot')
        busy = prepare(request)
        check(busy[0] == 503 and parse(busy[2])['reason'] == 'VIDEO_BUSY',
              'global upload slot blocks second process')
        fixture('upload-release', schema, {'owner': 'fixture-holder'})
        fixture('rate-limit-clear', schema, {'key': 'video-prepare:global'})
        redis('DEL', 'yingxiang:migration:test:rate:video-prepare:global')
        released = prepare(request)
        check(released[0] == 400, 'upload slot released: ' + str(released[0]) + ' ' + released[2][:200].decode('utf-8', 'replace'))

        fixture('rate-limit-clear', schema, {'key': 'video-prepare:global'})
        redis('DEL', 'yingxiang:migration:test:rate:video-prepare:global')
        results = [prepare(request)[0] for _ in range(31)]
        check(results.count(400) == 30 and results.count(429) == 1, 'atomic prepare limit 30')
        check(int(redis('GET', 'yingxiang:migration:test:rate:video-prepare:global')) == 31,
              'redis atomic counter matches requests')

        # 断连：新付费／生成／登录503；已登录读取与提示词状态继续?
        proxy.stop()
        time.sleep(.4)
        down_login = request('POST', '/api/account/login', headers=wrong,
                             body=json.dumps({'username': 'm19_alice', 'password': 'wrong-password'}).encode())
        down_checkout = request('POST', '/api/payments/checkout', cookie=ALICE,
                                headers={'Content-Type': 'application/json'},
                                body=json.dumps({'sku': 'credits-v1-light', 'requestId': '77777777-7777-4777-8777-777777777777'}).encode())
        check(down_login[0] == 503 and parse(down_login[2])['reason'] == 'RATE_LIMIT_UNAVAILABLE',
              'redis down closes login')
        check(down_checkout[0] == 503 and parse(down_checkout[2])['reason'] == 'RATE_LIMIT_UNAVAILABLE',
              'redis down closes new paid entry')
        check(prepare(request)[0] == 503, 'redis down closes new generation')
        check(request('GET', '/api/works', cookie=ALICE)[0] == 200, 'authenticated works read continues')
        check(request('GET', '/api/video/jobs/' + JOB_READ, cookie=ALICE)[0] == 200,
              'submitted video status continues')
        prompt = request('GET', '/api/prompt/status', cookie=SUNY)
        check(prompt[0] == 200 and parse(prompt[2])['available'] is True,
              'suny unlimited status not converted to rate limit')
        worker = start_worker(schema, storage, stub.port)
        wait_for(lambda: works(schema).get(JOB_WORK, {}).get('state') == 'ready',
                 'worker finishes submitted video while redis down', 25,
                 diagnostic=lambda: works(schema))
        check(stub.posts == 0, 'worker never posts generation during redis failure')
        stop(worker); worker = None

        # 恢复：Redis重连后仍按持久故障窗口保守关闭，显式核对并清窗后才恢复。
        proxy.start()
        time.sleep(.8)
        check(prepare(request)[0] == 503, 'gate stays closed after redis reconnect until window review')
        fixture('rate-limit-clear', schema, {'key': 'video-prepare:global'})
        redis('DEL', 'yingxiang:migration:test:rate:video-prepare:global')
        check(prepare(request)[0] == 400, 'explicit window review restores entry')
        subprocess.run(['docker', 'restart', 'yingxiang-m17-redis'], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        time.sleep(2)
        redis('DEL', 'yingxiang:migration:test:rate:video-prepare:global')
        lost = prepare(request)
        check(lost[0] == 503 and parse(lost[2])['reason'] == 'RATE_LIMIT_UNAVAILABLE',
              'redis restart with lost keys does not open entry')
        fixture('rate-limit-clear', schema, {'key': 'video-prepare:global'})
        check(prepare(request)[0] == 400, 'cleared shadow opens a new window explicitly')
        redis('DEL', 'yingxiang:migration:test:rate:video-prepare:global')
        evicted = prepare(request)
        check(evicted[0] == 503 and parse(evicted[2])['reason'] == 'RATE_LIMIT_UNAVAILABLE',
              'evicted key with active shadow stays closed')
        fixture('rate-limit-clear', schema, {'key': 'video-prepare:global'})
        check(prepare(request)[0] == 400, 'explicit shadow reset opens again')
    finally:
        if worker is not None:
            stop(worker)
        if api is not None:
            stop(api)
        proxy.stop()
        fixture('cleanup', schema)
        import shutil
        shutil.rmtree(storage, ignore_errors=True)
        stub.stop()
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'realPostgres': True, 'realRedis': True,
                      'redisProxyFaultInjection': True, 'providerPosts': stub.posts, 'realProviderCalls': 0,
                      'temporarySchemaRemoved': True, 'temporaryStorageRemoved': True}))


if __name__ == '__main__':
    main()
