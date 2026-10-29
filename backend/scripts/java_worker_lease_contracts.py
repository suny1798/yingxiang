"""M18：真实临时PG＋两个独立Worker进程的租约、旧代次、删除竞态与片段超时回归。"""
from __future__ import annotations

import hashlib
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

BACKEND = Path(__file__).resolve().parents[1]
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
ORIGIN = 'http://127.0.0.1:8791'
HOST = '127.0.0.1:8791'
KEY = 'synthetic-lease-key'
ALICE = 'yingxiang_session=' + '7' * 64
ALICE_ID = '22222222-2222-4222-8222-222222222222'
JOB_LEASE = '00000000-0000-4000-8000-000000000011'
JOB_DELETE = '00000000-0000-4000-8000-000000000012'
WORK_CAPTURE = '33333333-3333-4333-8333-333333333333'
RESULT = b'\x00\x00\x00\x18ftypisom' + b'synthetic-lease-result' * 200
CHUNK = b'\x00\x00\x00\x18ftypisom' + b'synthetic-partial-chunk' * 40
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


class ProviderStub:
    def __init__(self):
        self.jobs = {}
        self.delays = {}
        self.posts = 0
        self.content_gets = {}
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
                if self.headers.get('X-API-KEY') != KEY:
                    return self._json(401, {'error': 'unauthorized'})
                if self.path.endswith('/content'):
                    ident = self.path.split('/')[-2]
                    with stub.lock:
                        stub.content_gets[ident] = stub.content_gets.get(ident, 0) + 1
                        delays = stub.delays.get(ident, [])
                        delay = delays.pop(0) if delays else 0
                    if delay:
                        time.sleep(delay)
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
                with stub.lock:
                    stub.posts += 1
                return self._json(500, {'error': 'worker must never post'})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def status(self, ident, value):
        with self.lock:
            self.jobs[ident] = value

    def delay(self, ident, *values):
        with self.lock:
            self.delays[ident] = list(values)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


def random_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def start_worker(schema, storage, provider_port, worker_id):
    port = random_port()
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.role=worker', '--migration.worker-enabled=true', f'--migration.worker-id={worker_id}',
        f'--migration.storage-root={storage}', f'--migration.video-key={KEY}',
        f'--migration.video-provider-url=http://127.0.0.1:{provider_port}',
        '--migration.worker-lease-ms=500', '--migration.worker-retry-ms=100',
        '--migration.worker-poll-ms=50', '--migration.worker-batch=4',
        '--migration.worker-capture-timeout-ms=200', '--migration.worker-max-attempts=3',
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
              'budget_reservations': [], 'scene_access': [], 'auth_rate_limits': []}
    tables['users'].append({'id': ALICE_ID, 'username': 'm18_alice', 'salt': 'synthetic-only',
                            'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                            'role': 'user', 'disabled': 0})
    tables['auth_sessions'].append({'hash': hashlib.sha256(ALICE.split('=', 1)[1].encode()).hexdigest(),
                                    'user_id': ALICE_ID, 'expires_at': now + 900000})
    for ident, provider in ((JOB_LEASE, 'job_lease'),):
        tables['video_jobs'].append({'id': ident, 'user_id': ALICE_ID, 'state': 'completed', 'created_at': now - 5000,
                                     'expires_at': now + 3600000, 'seconds_milli': 9000, 'micro_usd': 360000,
                                     'provider_id': provider, 'checked_at': None})
        tables['budget_reservations'].append({'id': ident, 'scene': 'video', 'user_id': ALICE_ID,
                                              'micro_usd': 360000, 'lease_until': now + 3600000,
                                              'created_at': now - 5000})
    tables['works'].append({'id': WORK_CAPTURE, 'user_id': ALICE_ID, 'kind': 'realtime', 'source_id': None,
                            'title': '合成片段', 'state': 'capturing', 'mime': 'video/mp4', 'extension': 'mp4',
                            'bytes': len(CHUNK), 'chunks': 1, 'duration_ms': 15000,
                            'created_at': now - 5000, 'updated_at': now - 2000, 'error_code': None,
                            'retries': 0, 'favorite': 0})
    fixture('setup', schema, {'tables': tables})
    return schema


def works(schema):
    return {work['sourceId'] or work['id']: work
            for work in fixture('works-state', schema, {'username': 'm18_alice'})['works']}


def tasks(schema):
    return fixture('worker-state', schema)['tasks']


def wait_for(predicate, label, timeout=20, diagnostic=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    detail = '' if diagnostic is None else ' ' + json.dumps(diagnostic(), ensure_ascii=False)
    raise AssertionError(label + ' timed out' + detail)


def main():
    stub = ProviderStub()
    stub.status('job_lease', 'completed')
    stub.status('job_delete', 'completed')
    stub.delay('job_lease', 2.0, 0.2)
    stub.delay('job_delete', *([5.0] * 10))
    now = int(time.time() * 1000)
    schema = setup_schema(now)
    storage = Path(tempfile.mkdtemp(prefix='yingxiang-m18-storage-'))
    chunk_directory = storage / ALICE_ID / 'works' / WORK_CAPTURE
    chunk_directory.mkdir(parents=True)
    (chunk_directory / 'chunk-000000').write_bytes(CHUNK)
    workers = []
    try:
        # 双Worker：A下载慢，租约过期后B以新代次完成；A旧代次不能发布。
        workers.append(start_worker(schema, storage, stub.port, 'm18-worker-a'))
        workers.append(start_worker(schema, storage, stub.port, 'm18-worker-b'))
        wait_for(lambda: stub.content_gets.get('job_lease', 0) >= 1, 'first worker downloads lease job')
        lease_work = wait_for(lambda: works(schema).get(JOB_LEASE), 'lease work created')
        wait_for(lambda: works(schema).get(JOB_LEASE, {}).get('state') == 'ready',
                 'lease work ready after takeover', 25,
                 diagnostic=lambda: {'works': works(schema), 'tasks': tasks(schema)})
        ready = works(schema)[JOB_LEASE]
        check(ready['bytes'] == len(RESULT), 'takeover saved exact bytes')
        lease_task = [task for task in tasks(schema) if task['resourceId'] == lease_work['id']][0]
        check(lease_task['leaseGeneration'] >= 2 and lease_task['attempts'] >= 2, 'lease generation advanced')
        check(stub.content_gets.get('job_lease', 0) >= 2, 'two generations attempted download')
        check(stub.posts == 0, 'lease workers never post generation')
        content = (storage / ALICE_ID / 'works' / lease_work['id'] / 'result.mp4')
        check(content.is_file() and content.read_bytes() == RESULT, 'only final result published')
        check(not list((storage / ALICE_ID / 'works' / lease_work['id']).glob('.download-*')),
              'stale temporary download removed')
        for process in workers:
            stop(process)
        workers.clear()

        # 删除竞态：下载中直接落删除墓碑，Worker不能复活或留下结果。
        fixture('video-job', schema, {'id': JOB_DELETE, 'userId': ALICE_ID, 'state': 'completed',
                                      'providerId': 'job_delete'})
        workers.append(start_worker(schema, storage, stub.port, 'm18-worker-c'))
        workers.append(start_worker(schema, storage, stub.port, 'm18-worker-d'))
        wait_for(lambda: works(schema).get(JOB_DELETE, {}).get('state') in ('waiting', 'saving'),
                 'delete work claimed', 20,
                 diagnostic=lambda: {'works': works(schema), 'tasks': tasks(schema),
                                     'contentGets': dict(stub.content_gets)})
        delete_work = works(schema)[JOB_DELETE]
        wait_for(lambda: stub.content_gets.get('job_delete', 0) >= 1, 'delete work download started')
        fixture('works-delete', schema, {'workId': delete_work['id']})
        wait_for(lambda: works(schema).get(JOB_DELETE, {}).get('state') == 'deleted', 'delete tombstone stays')
        wait_for(lambda: any(task['state'] == 'cancelled' for task in tasks(schema)
                             if task['resourceId'] == delete_work['id']), 'delete race cancels save task', 15,
                 diagnostic=lambda: {'tasks': tasks(schema)})
        check(works(schema).get(JOB_DELETE, {}).get('state') == 'deleted', 'worker does not resurrect deleted work')
        directory = storage / ALICE_ID / 'works' / delete_work['id']
        check(not (directory / 'result.mp4').exists(), 'deleted race leaves no result')
        check(not directory.exists() or not any(directory.iterdir()), 'cleanup task removes raced files')
        delete_tasks = [task for task in tasks(schema) if task['resourceId'] == delete_work['id']]
        check(any(task['type'] == 'cleanup' and task['state'] == 'succeeded' for task in delete_tasks),
              'cleanup task settled')
        for process in workers:
            stop(process)
        workers.clear()

        # 片段超时：超过阈值无新片段的capturing作品部分保存为ready并保留提示。
        workers.append(start_worker(schema, storage, stub.port, 'm18-worker-e'))
        wait_for(lambda: works(schema).get(WORK_CAPTURE, {}).get('state') == 'ready',
                 'capture timeout partial save', 20,
                 diagnostic=lambda: {'works': works(schema), 'tasks': tasks(schema)})
        capture = works(schema)[WORK_CAPTURE]
        check(capture['errorCode'] == 'PARTIAL_CAPTURE', 'partial capture message')
        check(capture['bytes'] == len(CHUNK), 'partial capture bytes')
        capture_content = storage / ALICE_ID / 'works' / WORK_CAPTURE / 'result.mp4'
        check(capture_content.is_file() and capture_content.read_bytes() == CHUNK, 'partial content assembled')
        capture_tasks = [task for task in tasks(schema) if task['resourceId'] == WORK_CAPTURE]
        check(len(capture_tasks) == 1 and capture_tasks[0]['type'] == 'capture-finish'
              and capture_tasks[0]['state'] == 'succeeded', 'single capture finish task')
        check(stub.posts == 0, 'no generation POST across all races')
    finally:
        for process in workers:
            stop(process)
        fixture('cleanup', schema)
        import shutil
        shutil.rmtree(storage, ignore_errors=True)
        stub.stop()
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'realPostgres': True, 'twoWorkerProcesses': True,
                      'syntheticProvider': True, 'providerPosts': stub.posts, 'realProviderCalls': 0,
                      'temporarySchemaRemoved': True, 'temporaryStorageRemoved': True}))


if __name__ == '__main__':
    main()
