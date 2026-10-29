"""M17：真实临时PG＋独立Worker进程＋合成视频供应商的收取已有视频合同回归。"""
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
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
ORIGIN = 'http://127.0.0.1:8791'
HOST = '127.0.0.1:8791'
KEY = 'synthetic-worker-key'
ALICE = 'yingxiang_session=' + '6' * 64
ALICE_ID = '11111111-1111-4111-8111-111111111111'
JOB_DONE = '00000000-0000-4000-8000-000000000001'
JOB_PENDING = '00000000-0000-4000-8000-000000000002'
JOB_FAIL = '00000000-0000-4000-8000-000000000003'
JOB_EXTRA = '00000000-0000-4000-8000-000000000004'
COUNT = 0
RESULT = b'\x00\x00\x00\x18ftypisom' + b'synthetic-worker-result' * 200


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
        self.jobs = {}
        self.posts = 0
        self.content_gets = 0
        self.fail_content = set()
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
                        stub.content_gets += 1
                        fail = ident in stub.fail_content
                        status = stub.jobs.get(ident)
                    if fail:
                        return self._json(500, {'error': 'synthetic'})
                    if status != 'completed':
                        return self._json(404, {'error': 'missing'})
                    self.send_response(200)
                    self.send_header('Content-Type', 'video/mp4')
                    self.send_header('Content-Length', str(len(RESULT)))
                    self.end_headers()
                    self.wfile.write(RESULT)
                    return
                ident = self.path.rsplit('/', 1)[-1]
                with stub.lock:
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

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


def random_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def start_api(schema, storage, provider_port):
    port = random_port()
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.video-enabled=true', '--migration.works-enabled=true', f'--migration.storage-root={storage}',
        f'--migration.video-key={KEY}', f'--migration.video-provider-url=http://127.0.0.1:{provider_port}',
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


def start_worker(schema, storage, provider_port, worker_id):
    port = random_port()
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.role=worker', '--migration.worker-enabled=true', f'--migration.worker-id={worker_id}',
        f'--migration.storage-root={storage}', f'--migration.video-key={KEY}',
        f'--migration.video-provider-url=http://127.0.0.1:{provider_port}',
        '--migration.worker-lease-ms=5000', '--migration.worker-retry-ms=300',
        '--migration.worker-poll-ms=100', '--migration.worker-batch=4',
        f'--migration.public-origin={ORIGIN}', '--spring.datasource.hikari.read-only=false',
    ], cwd=BACKEND, stdout=log, stderr=log)
    # 启动不再暴露HTTP；后续持久任务断言验证实际就绪和收取。
    deadline=time.monotonic()+60
    while True:
        if process.poll() is not None:
            import re
            log.seek(0)
            safe=log.read().decode('utf-8',errors='replace')
            beans=re.findall("Error creating bean with name '([A-Za-z0-9]+)'",safe)
            causes=re.findall(r'Caused by: ([A-Za-z0-9.$]+)',safe)
            raise AssertionError('worker startup failed: beans='+str(beans)+' causes='+str(causes)+' exit='+str(process.returncode)+' summary='+str([line for line in safe.splitlines() if any(word in line for word in ['WebApplicationType','required a bean','Consider defining','non-web','APPLICATION FAILED','Web server failed','Worker service missing'])]))
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
    tables['users'].append({'id': ALICE_ID, 'username': 'm17_alice', 'salt': 'synthetic-only',
                            'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                            'role': 'user', 'disabled': 0})
    tables['auth_sessions'].append({'hash': hashlib.sha256(ALICE.split('=', 1)[1].encode()).hexdigest(),
                                    'user_id': ALICE_ID, 'expires_at': now + 900000})
    for index, (state, provider) in enumerate((('completed', 'job_done'), ('pending', 'job_pending'),
                                               ('completed', 'job_fail'))):
        ident = f'00000000-0000-4000-8000-00000000000{index + 1}'
        tables['video_jobs'].append({'id': ident, 'user_id': ALICE_ID, 'state': state, 'created_at': now - 5000 + index,
                                     'expires_at': now + 3600000, 'seconds_milli': 9000, 'micro_usd': 360000,
                                     'provider_id': provider, 'checked_at': None})
        tables['budget_reservations'].append({'id': ident, 'scene': 'video', 'user_id': ALICE_ID,
                                              'micro_usd': 360000, 'lease_until': now + 3600000,
                                              'created_at': now - 5000 + index})
    fixture('setup', schema, {'tables': tables})
    return schema


def work_map(schema):
    return {work['sourceId']: work for work in fixture('works-state', schema, {'username': 'm17_alice'})['works']}


def wait_for(predicate, label, timeout=25, diagnostic=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.2)
    detail = '' if diagnostic is None else ' ' + json.dumps(diagnostic(), ensure_ascii=False)
    raise AssertionError(label + ' timed out' + detail)


def main():
    stub = ProviderStub()
    stub.status('job_done', 'completed')
    stub.status('job_pending', 'pending')
    stub.status('job_fail', 'completed')
    stub.fail_content.add('job_fail')
    now = int(time.time() * 1000)
    schema = setup_schema(now)
    storage = Path(tempfile.mkdtemp(prefix='yingxiang-m17-storage-'))
    api = worker = None
    try:
        api, request = start_api(schema, storage, stub.port)
        check(request('GET', '/api/works?kind=video', cookie=ALICE)[0] == 200, 'works before worker')
        check(json.loads(request('GET', '/api/works?kind=video', cookie=ALICE)[2])['total'] == 0,
              'no works before worker claims')

        worker = start_worker(schema, storage, stub.port, 'm17-worker-a')
        pending_work = wait_for(lambda: work_map(schema).get(JOB_PENDING), 'worker creates pending work', 15,
                                diagnostic=lambda: {'works': work_map(schema),
                                                    'tasks': fixture('worker-state', schema)['tasks']})
        time.sleep(1.5)
        pending_work = work_map(schema).get(JOB_PENDING)
        check(pending_work is not None and pending_work['state'] in ('waiting', 'saving'), 'pending job waits for poll')
        stub.status('job_pending', 'completed')
        works = wait_for(lambda: (lambda value: value if value.get(JOB_DONE, {}).get('state') == 'ready'
                                  and value.get(JOB_PENDING, {}).get('state') == 'ready'
                                  and value.get(JOB_FAIL, {}).get('state') == 'failed' else None)(work_map(schema)),
                         'worker saves completed and retries failed',
                         diagnostic=lambda: {'works': work_map(schema), 'tasks': fixture('worker-state', schema)['tasks']})
        check(works[JOB_DONE]['bytes'] == len(RESULT) and works[JOB_DONE]['errorCode'] is None, 'download saved')
        check(works[JOB_PENDING]['state'] == 'ready', 'pending polled then saved')
        check(works[JOB_FAIL]['state'] == 'failed' and works[JOB_FAIL]['errorCode'] == 'SAVE_FAILED',
              'bounded retry failed')
        check(works[JOB_FAIL]['chunks'] == 0, 'failed work has no partial result')
        check(stub.posts == 0, 'worker never posts generation')

        content = request('GET', f"/api/works/{works[JOB_DONE]['id']}/content", cookie=ALICE)
        check(content[0] == 200 and content[2] == RESULT, 'saved content is exact provider bytes')
        check(hashlib.sha256(content[2]).hexdigest() == hashlib.sha256(RESULT).hexdigest(), 'saved hash')
        check(request('GET', f"/api/works/{works[JOB_FAIL]['id']}/content", cookie=ALICE)[0] == 409,
              'failed work not readable')

        tasks = fixture('worker-state', schema)['tasks']
        video_tasks = [task for task in tasks if task['type'] == 'video-save']
        check(len(video_tasks) == 3, 'one task per video work')
        check(all(task['state'] in ('succeeded', 'failed') for task in video_tasks), 'tasks settled')
        check(stub.content_gets >= 3, 'content requested for each work')
        check(stub.posts == 0, 'still no provider POST')

        # 页面/API离开后Worker仍可收取：停API，再补一条已完成任务，由独立Worker保存。
        stop(api); api = None
        stop(worker); worker = None
        extra = JOB_EXTRA
        fixture('video-job', schema, {'id': extra, 'userId': ALICE_ID, 'state': 'completed',
                                      'createdAt': now + 10, 'expiresAt': now + 3600000,
                                      'providerId': 'job_extra'})
        stub.status('job_extra', 'completed')
        worker = start_worker(schema, storage, stub.port, 'm17-worker-b')
        wait_for(lambda: work_map(schema).get(JOB_EXTRA, {}).get('state') == 'ready', 'worker saves without API')
        check(stub.posts == 0, 'no generation POST without API')

        # 重启恢复：保留作品与任务，不重复下载成不同文件。
        before = work_map(schema)[JOB_EXTRA]
        stop(worker); worker = None
        worker = start_worker(schema, storage, stub.port, 'm17-worker-c')
        time.sleep(2)
        after = work_map(schema)[JOB_EXTRA]
        check(after['state'] == 'ready' and after['bytes'] == before['bytes'], 'restart keeps ready work')
        check(stub.posts == 0, 'restart never reposts generation')
        tasks_after = [task for task in fixture('worker-state', schema)['tasks'] if task['type'] == 'video-save']
        check(len(tasks_after) == 4, 'restart does not duplicate tasks')

        api, request = start_api(schema, storage, stub.port)
        detail = request('GET', f"/api/works/{after['id']}", cookie=ALICE)
        check(detail[0] == 200 and parse(detail[2])['state'] == 'ready', 'API sees worker result after restart')
    finally:
        if worker is not None:
            stop(worker)
        if api is not None:
            stop(api)
        fixture('cleanup', schema)
        import shutil
        shutil.rmtree(storage, ignore_errors=True)
        stub.stop()
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'realPostgres': True, 'realWorkerProcess': True,
                      'syntheticProvider': True, 'providerPosts': stub.posts, 'realProviderCalls': 0,
                      'temporarySchemaRemoved': True, 'temporaryStorageRemoved': True}))


if __name__ == '__main__':
    main()
