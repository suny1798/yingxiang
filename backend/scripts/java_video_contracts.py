"""M14：真实临时PG＋两进程＋本机合成视频供应商的内存校验／预算／unknown合同回归。"""
from __future__ import annotations

import hashlib
import http.client
import json
import math
import secrets
import socket
import struct
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
ASSET = BACKEND.parent / 'frontend/public/assets/try-on-demo.mp4'
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
ORIGIN = 'http://127.0.0.1:8791'
HOST = '127.0.0.1:8791'
KEY = 'synthetic-video-key'
CONSENT = '2026-10-26-video-save-v1'
MARKER = b'AUDIO_PRIVATE_BYTES_MUST_NEVER_REACH_MODEL' * 20
ALICE = 'yingxiang_session=' + '1' * 64
BOB = 'yingxiang_session=' + '2' * 64
ADMIN = 'yingxiang_session=' + '3' * 64
ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
BOB_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
COUNT = 0


def check(condition, label):
    global COUNT
    assert condition, label + ' failed'
    COUNT += 1


def parse(value):
    body = value[2] if isinstance(value, tuple) else value
    if not body:
        return None
    payload = json.loads(body)
    if isinstance(payload, dict) and payload.get('code') == 0:
        return payload.get('data')
    return payload


def atom(kind, value):
    return struct.pack('>I4s', len(value) + 8, kind) + value


def boxes(data):
    pos = 0
    while pos < len(data):
        size, kind = struct.unpack('>I4s', data[pos:pos + 8])
        yield kind, pos, data[pos + 8:pos + size]
        pos += size


def with_audio(data):
    top = list(boxes(data))
    old_movie = next((pos, payload) for kind, pos, payload in top if kind == b'moov')
    first_mdat = next((pos, payload) for kind, pos, payload in top if kind == b'mdat')
    audio = atom(b'trak', atom(b'mdia', atom(b'hdlr', b'\0' * 8 + b'soun' + b'\0' * 12)))
    movie_end = old_movie[0] + len(old_movie[1]) + 8
    mdat_end = first_mdat[0] + len(first_mdat[1]) + 8

    def adjust(value):
        return value + (len(audio) if value >= movie_end else 0) + (len(MARKER) if value >= mdat_end else 0)

    def patch(payload):
        result = []
        for kind, _, value in boxes(payload):
            if kind in (b'trak', b'mdia', b'minf', b'stbl'):
                value = patch(value)
            elif kind in (b'stco', b'co64'):
                width, fmt = (8, '>Q') if kind == b'co64' else (4, '>I')
                count = struct.unpack('>I', value[4:8])[0]
                value = value[:8] + b''.join(struct.pack(fmt, adjust(int.from_bytes(value[8 + i * width:8 + (i + 1) * width], 'big'))) for i in range(count))
            result.append(atom(kind, value))
        return b''.join(result)
    return b''.join(atom(kind, patch(payload) + audio if kind == b'moov' else payload + MARKER if kind == b'mdat' and pos == first_mdat[0] else payload) for kind, pos, payload in top)


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
        self.gets = 0
        self.requests = []
        self.fail_next = False
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
                with stub.lock:
                    stub.gets += 1
                if self.path.endswith('/content'):
                    ident = self.path.split('/')[-2]
                    with stub.lock:
                        value = stub.jobs.get(ident)
                    if not value or value['status'] != 'completed':
                        return self._json(404, {'error': 'missing'})
                    data = b'\x00\x00\x00\x18ftypisom' + b'synthetic-result' * 10
                    self.send_response(200)
                    self.send_header('Content-Type', 'video/mp4')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                ident = self.path.rsplit('/', 1)[-1]
                with stub.lock:
                    value = stub.jobs.get(ident)
                return self._json(200, {'job_id': ident, 'status': value['status']}) if value else self._json(404, {'error': 'missing'})

            def do_POST(self):
                if self.headers.get('X-API-KEY') != KEY:
                    return self._json(401, {'error': 'unauthorized'})
                length = int(self.headers.get('Content-Length', '0'))
                body = self.rfile.read(length)
                with stub.lock:
                    stub.posts += 1
                    stub.requests.append({'path': self.path, 'body': body,
                                          'contentType': self.headers.get('Content-Type', '')})
                    if stub.fail_next:
                        return self._json(500, {'error': 'synthetic'})
                    ident = 'job_' + secrets.token_hex(8)
                    stub.jobs[ident] = {'status': 'pending'}
                return self._json(200, {'job_id': ident, 'status': 'pending'})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def status(self, ident, value):
        with self.lock:
            self.jobs[ident]['status'] = value

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


def start_java(schema, provider_port, budget, maximum, port=None):
    if port is None:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.admin-enabled=true', '--migration.video-enabled=true', f'--migration.video-budget-usd={budget}',
        f'--migration.video-max-jobs={maximum}', f'--migration.video-key={KEY}',
        f'--migration.video-provider-url=http://127.0.0.1:{provider_port}',
        f'--migration.public-origin={ORIGIN}', '--spring.datasource.hikari.read-only=false',
    ], cwd=BACKEND, stdout=log, stderr=log)

    def request(method, path, cookie=None, headers=None, body=None):
        h = {'Host': HOST, 'Origin': ORIGIN, **(headers or {})}
        if cookie is not None:
            h['Cookie'] = cookie
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=90)
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


def multipart(video, image, consent=CONSENT):
    boundary = 'synthetic' + secrets.token_hex(8)

    def part(name, filename, content_type, value):
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
        if filename:
            head += f'; filename="{filename}"'
        head += '\r\n'
        if content_type:
            head += f'Content-Type: {content_type}\r\n'
        return head.encode() + b'\r\n' + value + b'\r\n'
    return b''.join([
        part('data', 'person.mp4', 'video/mp4', video),
        part('reference_image', 'garment.png', 'image/png', image),
        part('consentVersion', None, None, consent.encode()),
        f'--{boundary}--\r\n'.encode(),
    ]), f'multipart/form-data; boundary={boundary}'


def png_bytes():
    return (b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR'
            + struct.pack('>II', 640, 480) + b'\x08\x06\x00\x00\x00' + struct.pack('>I', 0))


def setup_schema():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    now = int(time.time() * 1000)
    tables = {'users': [], 'auth_sessions': [], 'entitlement_grants': [], 'usage_attempts': [],
              'orders': [], 'payment_events': [], 'sandbox_credit_packs': [], 'admin_audit': [],
              'admin_settings': [], 'works': [], 'work_references': [], 'video_jobs': [], 'video_history': [],
              'budget_campaigns': [], 'budget_reservations': [], 'scene_access': [], 'auth_rate_limits': []}
    for ident, name, cookie, role in [(ALICE_ID, 'm14_alice', ALICE, 'user'), (BOB_ID, 'm14_bob', BOB, 'user'),
                                      (ADMIN_ID, 'm14_admin', ADMIN, 'admin')]:
        tables['users'].append({'id': ident, 'username': name, 'salt': 'synthetic-only',
                                'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                                'role': role, 'disabled': 0})
        tables['auth_sessions'].append({'hash': hashlib.sha256(cookie.split('=', 1)[1].encode()).hexdigest(),
                                        'user_id': ident, 'expires_at': now + 900000})
    fixture('setup', schema, {'tables': tables})
    return schema


def phase_media(request):
    original = ASSET.read_bytes()
    with_audio_bytes = with_audio(original)
    image = png_bytes()
    status = request('GET', '/api/video/jobs')
    check(status[0] == 200 and parse(status[2])['jobs'] == [] and parse(status[2])['available'] is True,
          'anonymous video status')
    prepared = request('POST', '/api/video/prepare', headers={'Content-Type': 'video/mp4'}, body=with_audio_bytes)
    check(prepared[0] == 200 and prepared[1]['x-video-audio-removed'] == '1', 'prepare removes audio')
    check(MARKER not in prepared[2] and b'soun' not in prepared[2] and prepared[2][4:8] == b'ftyp', 'audio bytes absent')
    again = request('POST', '/api/video/prepare', headers={'Content-Type': 'video/mp4'}, body=prepared[2])
    check(again[0] == 200 and again[1]['x-video-audio-removed'] == '0' and again[2] == prepared[2], 'prepared passthrough')
    check(request('POST', '/api/video/prepare', headers={'Content-Type': 'video/mp4'}, body=b'not-a-video')[0] == 400,
          'invalid media')
    check(request('POST', '/api/video/prepare', headers={'Content-Type': 'application/octet-stream'}, body=original)[0] == 415,
          'prepare content type')
    body, content_type = multipart(prepared[2], image)
    check(request('POST', '/api/video/jobs', headers={'Content-Type': content_type}, body=body)[0] == 401, 'submit login')
    check(request('POST', '/api/video/jobs', cookie=ALICE, headers={'Content-Type': content_type}, body=body)[0] == 400,
          'submit attempt required')
    return body, content_type


def main():
    stub = ProviderStub()
    schemas = []
    processes = []
    try:
        # 阶段A：预算上限
        schema_a = setup_schema()
        schemas.append(schema_a)
        process, request = start_java(schema_a, stub.port, 2.0, 6)
        processes.append(process)
        body, content_type = phase_media(request)

        def job_state(schema, ident):
            return [job for job in fixture('video-state', schema, {'username': 'm14_alice'})['jobs'] if job['id'] == ident][0]

        attempts = []
        for index in range(5):
            attempt = str(uuid4())
            response = request('POST', '/api/video/jobs', cookie=ALICE,
                               headers={'Content-Type': content_type, 'X-Video-Attempt': attempt}, body=body)
            check(response[0] == 200 and parse(response[2])['state'] == 'pending', 'submit job ' + str(index))
            job = parse(response[2])
            check(abs(job['estimateUsd'] - 0.04 * math.ceil(job['seconds'])) < 1e-9, 'estimate uses ceil seconds')
            if index == 0:
                check(stub.posts == 1 and stub.requests[0]['path'] == '/v1/jobs/lucy-vton-3.6', 'provider submit once')
                check(b'name="data"' in stub.requests[0]['body'] and b'filename="person.mp4"' in stub.requests[0]['body']
                      and b'name="reference_image"' in stub.requests[0]['body'] and b'resolution' in stub.requests[0]['body'],
                      'provider multipart fields')
                repeat = request('POST', '/api/video/jobs', cookie=ALICE,
                                 headers={'Content-Type': content_type, 'X-Video-Attempt': attempt}, body=body)
                check(repeat[0] == 200 and parse(repeat[2])['id'] == job['id'] and stub.posts == 1,
                      'repeat attempt no repost')
            fixture('video-reset-check', schema_a, {'jobId': attempt})
            stub.status(job_state(schema_a, attempt)['providerId'], 'completed')
            polled = request('GET', '/api/video/jobs/' + attempt, cookie=ALICE)
            check(polled[0] == 200 and parse(polled[2])['state'] == 'completed', 'poll completed ' + str(index))
            attempts.append(attempt)
        check(request('GET', '/api/video/jobs/' + attempts[0], cookie=BOB)[0] == 404, 'foreign job hidden')
        content = request('GET', '/api/video/jobs/' + attempts[0] + '/content', cookie=ALICE)
        check(content[0] == 200 and content[1]['content-type'] == 'video/mp4' and b'ftyp' in content[2], 'content download')
        check(request('GET', '/api/video/jobs/' + attempts[0] + '/content?download=1', cookie=ALICE)[1]['content-disposition']
              .startswith('attachment'), 'download disposition')
        limited = request('POST', '/api/video/jobs', cookie=ALICE,
                          headers={'Content-Type': content_type, 'X-Video-Attempt': str(uuid4())}, body=body)
        check(limited[0] == 409 and parse(limited[2])['reason'] == 'VIDEO_BUDGET_LIMIT', 'budget limit')
        overview = request('GET', '/api/admin/overview', cookie=ADMIN)
        video = [service for service in parse(overview[2])['services'] if service['scene'] == 'video'][0]
        check(overview[0] == 200 and video['configured'] is True and video['budgetUsd'] == 2.0
              and video['maxRequests'] == 6 and video['requests'] == 5 and video['reservedUsd'] > 1.7,
              'admin video status')
        listing = request('GET', '/api/video/jobs', cookie=ALICE)
        check(listing[0] == 200 and len(parse(listing[2])['jobs']) == 5, 'own jobs list')
        other = request('GET', '/api/video/jobs', cookie=BOB)
        check(other[0] == 200 and parse(other[2])['jobs'] == [], 'other user sees no jobs')
        stop_java(process)
        processes.remove(process)
        fixture('cleanup', schema_a)
        schemas.remove(schema_a)

        # 阶段B：上游失败保留unknown、不重POST、重启恢复
        schema_b = setup_schema()
        schemas.append(schema_b)
        process, request = start_java(schema_b, stub.port, 5, 3)
        processes.append(process)
        body, content_type = phase_media(request)
        stub.fail_next = True
        posts_before = stub.posts
        unknown_attempt = str(uuid4())
        unknown = request('POST', '/api/video/jobs', cookie=ALICE,
                          headers={'Content-Type': content_type, 'X-Video-Attempt': unknown_attempt}, body=body)
        check(unknown[0] == 200 and parse(unknown[2])['state'] == 'unknown', 'provider failure keeps unknown')
        check(stub.posts == posts_before + 1, 'failed provider post attempted once')
        retry = request('POST', '/api/video/jobs', cookie=ALICE,
                        headers={'Content-Type': content_type, 'X-Video-Attempt': unknown_attempt}, body=body)
        check(retry[0] == 200 and parse(retry[2])['state'] == 'unknown' and stub.posts == posts_before + 1,
              'unknown not reposted')
        stub.fail_next = False
        blocked = request('POST', '/api/video/jobs', cookie=ALICE,
                          headers={'Content-Type': content_type, 'X-Video-Attempt': str(uuid4())}, body=body)
        check(blocked[0] == 409 and parse(blocked[2])['reason'] == 'VIDEO_IN_PROGRESS', 'unknown blocks new job')
        posts_before_restart = stub.posts
        stop_java(process)
        processes.remove(process)
        process, request = start_java(schema_b, stub.port, 5, 3)
        processes.append(process)
        after = request('GET', '/api/video/jobs', cookie=ALICE)
        check(after[0] == 200 and parse(after[2])['available'] is False, 'unknown survives restart')
        check(parse(request('GET', '/api/video/jobs/' + unknown_attempt, cookie=ALICE))['state'] == 'unknown',
              'unknown state persisted')
        check(stub.posts == posts_before_restart, 'no repost after restart')
    finally:
        for process in processes:
            stop_java(process)
        for schema in schemas:
            fixture('cleanup', schema)
        try:
            stub.stop()
        except Exception:
            pass
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'realPostgres': True, 'syntheticProvider': True,
                      'providerCalls': stub.posts, 'realProviderCalls': 0, 'temporarySchemasRemoved': True}))


if __name__ == '__main__':
    main()
