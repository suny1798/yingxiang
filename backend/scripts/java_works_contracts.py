"""M15：真实临时PG＋两进程＋本机私有卷的实时作品保存与整理合同回归。"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
import secrets
import socket
import struct
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
ASSET = BACKEND.parent / 'frontend/public/assets/try-on-demo.mp4'
JAR = BACKEND / 'target/yingxiang-backend-0.1.0.jar'
CONFIG = BACKEND / 'config/application-local.yml'
ORIGIN = 'http://127.0.0.1:8791'
HOST = '127.0.0.1:8791'
ALICE = 'yingxiang_session=' + '4' * 64
BOB = 'yingxiang_session=' + '5' * 64
ALICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
BOB_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
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


def setup_schema():
    schema = 'yingxiang_migration_it_' + secrets.token_hex(6)
    now = int(time.time() * 1000)
    tables = {'users': [], 'auth_sessions': [], 'entitlement_grants': [], 'usage_attempts': [],
              'orders': [], 'payment_events': [], 'sandbox_credit_packs': [], 'admin_audit': [],
              'admin_settings': [], 'works': [], 'work_references': [], 'video_jobs': [], 'video_history': [],
              'budget_campaigns': [], 'budget_reservations': [], 'scene_access': [], 'auth_rate_limits': []}
    for ident, name, cookie in [(ALICE_ID, 'm15_alice', ALICE), (BOB_ID, 'm15_bob', BOB)]:
        tables['users'].append({'id': ident, 'username': name, 'salt': 'synthetic-only',
                                'password_hash': 'synthetic-unusable-password-hash', 'created_at': now - 90000,
                                'role': 'user', 'disabled': 0})
        tables['auth_sessions'].append({'hash': hashlib.sha256(cookie.split('=', 1)[1].encode()).hexdigest(),
                                        'user_id': ident, 'expires_at': now + 900000})
    fixture('setup', schema, {'tables': tables})
    return schema


def start_java(schema, storage, port=None):
    if port is None:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
    log = tempfile.TemporaryFile()
    process = subprocess.Popen([
        'java', '-jar', str(JAR), f'--server.port={port}', f'--migration.db-schema={schema}',
        '--migration.auth-enabled=true', '--migration.maintenance=false', '--migration.account-read-enabled=true',
        '--migration.works-enabled=true', f'--migration.storage-root={storage}',
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


def png_bytes():
    return (b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR'
            + struct.pack('>II', 640, 480) + b'\x08\x06\x00\x00\x00' + struct.pack('>I', 0))


def body_json(value):
    return json.dumps(value).encode()


def parse(response):
    return json.loads(response[2]) if response[2] else None


def main():
    schema = setup_schema()
    storage = Path(tempfile.mkdtemp(prefix='yingxiang-m15-storage-'))
    process = None
    created = True
    try:
        process, request = start_java(schema, storage)

        def call(method, path, cookie=None, headers=None, body=None):
            return request(method, path, cookie, headers, body)

        def work_state(ident):
            return [work for work in fixture('works-state', schema, {'username': 'm15_alice'})['works']
                    if work['id'] == ident][0]

        asset = ASSET.read_bytes()
        split = len(asset) // 2
        chunks = [asset[:split], asset[split:]]
        image = png_bytes()
        owner = {'X-Work-Owner': ALICE_ID, 'Content-Type': 'application/json'}

        check(call('GET', '/api/works')[0] == 401, 'works require login')
        no_owner = call('POST', '/api/works', cookie=ALICE, headers={'Content-Type': 'application/json'},
                        body=body_json({'id': str(uuid4()), 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        check(no_owner[0] == 409 and parse(no_owner)['error']['code'] == 'WORK_OWNER_CHANGED', 'owner header required')
        wrong_owner = call('POST', '/api/works', cookie=ALICE, headers=owner,
                           body=body_json({'id': str(uuid4()), 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': BOB_ID}))
        check(wrong_owner[0] == 400 and parse(wrong_owner)['error']['code'] == 'INVALID_WORK', 'owner id must match')
        invalid = call('POST', '/api/works', cookie=ALICE, headers=owner,
                       body=body_json({'id': 'not-a-uuid', 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        check(invalid[0] == 400, 'work id validated')

        work_id = str(uuid4())
        created_work = call('POST', '/api/works', cookie=ALICE, headers=owner,
                            body=body_json({'id': work_id, 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        check(created_work[0] == 201 and parse(created_work)['state'] == 'capturing', 'create capturing')
        check(parse(created_work)['title'] == '实时换装' and parse(created_work)['seconds'] == 15.0, 'create defaults')
        repeat_create = call('POST', '/api/works', cookie=ALICE, headers=owner,
                             body=body_json({'id': work_id, 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        check(repeat_create[0] == 201 and parse(repeat_create)['id'] == work_id, 'create idempotent')
        conflict_create = call('POST', '/api/works', cookie=ALICE, headers=owner,
                               body=body_json({'id': work_id, 'kind': 'edit', 'mime': 'video/webm', 'seconds': 30, 'ownerId': ALICE_ID}))
        check(conflict_create[0] == 404, 'create conflict hidden')

        chunk_headers = {**owner, 'Content-Type': 'application/octet-stream'}
        check(call('POST', f'/api/works/{work_id}/chunks/0', cookie=ALICE, headers=chunk_headers, body=chunks[0])[0] == 200,
              'chunk zero')
        check(call('POST', f'/api/works/{work_id}/chunks/0', cookie=ALICE, headers=chunk_headers, body=chunks[0])[0] == 200,
              'chunk idempotent')
        check(call('POST', f'/api/works/{work_id}/chunks/0', cookie=ALICE, headers=chunk_headers, body=chunks[1])[0] == 409,
              'chunk conflict')
        check(call('POST', f'/api/works/{work_id}/chunks/2', cookie=ALICE, headers=chunk_headers, body=chunks[1])[0] == 409,
              'chunk order')
        check(call('POST', f'/api/works/{work_id}/chunks/1', cookie=ALICE, headers=chunk_headers, body=b'')[0] == 400,
              'empty chunk rejected')
        check(call('POST', f'/api/works/{work_id}/chunks/1', cookie=ALICE, headers=chunk_headers, body=chunks[1])[0] == 200,
              'chunk one')

        ref_id = str(uuid4())
        ref_headers = {**owner, 'Content-Type': 'image/png'}
        check(call('POST', f'/api/works/{work_id}/references/{ref_id}', cookie=ALICE, headers=ref_headers, body=image)[0] == 200,
              'reference saved')
        check(call('POST', f'/api/works/{work_id}/references/{ref_id}', cookie=ALICE, headers=ref_headers, body=image)[0] == 200,
              'reference idempotent')
        check(call('POST', f'/api/works/{work_id}/references/{ref_id}', cookie=ALICE, headers=ref_headers, body=image + b'x')[0] == 409,
              'reference conflict')
        check(call('POST', f'/api/works/{work_id}/references/{str(uuid4())}', cookie=ALICE,
                   headers={**owner, 'Content-Type': 'text/plain'}, body=image)[0] == 400, 'reference mime')
        ref_content = call('GET', f'/api/works/{work_id}/references/{ref_id}', cookie=ALICE)
        check(ref_content[0] == 200 and ref_content[1]['content-type'] == 'image/png' and ref_content[2] == image,
              'reference content')

        complete = call('POST', f'/api/works/{work_id}/complete', cookie=ALICE,
                        headers={'Content-Type': 'application/json', 'X-Work-Owner': ALICE_ID},
                        body=body_json({'durationMs': 15000, 'interrupted': False}))
        check(complete[0] == 202 and parse(complete) == {'accepted': True}, 'complete accepted')
        detail = call('GET', f'/api/works/{work_id}', cookie=ALICE)
        check(detail[0] == 200 and parse(detail)['state'] == 'ready', 'work ready')
        check(parse(detail)['contentUrl'] == f'/api/works/{work_id}/content' and parse(detail)['bytes'] == len(asset),
              'ready content url and bytes')
        check(parse(detail)['references'][0]['url'] == f'/api/works/{work_id}/references/{ref_id}', 'reference url')
        content = call('GET', f'/api/works/{work_id}/content', cookie=ALICE)
        check(content[0] == 200 and content[1]['content-type'] == 'video/mp4' and content[2] == asset, 'content bytes')
        ranged = call('GET', f'/api/works/{work_id}/content', cookie=ALICE, headers={'Range': 'bytes=0-9'})
        check(ranged[0] == 206 and len(ranged[2]) == 10 and ranged[1]['content-range'] == f'bytes 0-9/{len(asset)}',
              'range bytes')
        check(call('GET', f'/api/works/{work_id}/content?download=1', cookie=ALICE)[1]['content-disposition'].startswith('attachment'),
              'download disposition')

        listing = call('GET', '/api/works?kind=realtime&page=1&pageSize=9', cookie=ALICE)
        check(listing[0] == 200 and parse(listing)['total'] == 1 and parse(listing)['items'][0]['id'] == work_id, 'list realtime')
        check(parse(call('GET', '/api/works?kind=edit', cookie=ALICE))['total'] == 0, 'list kind filter')
        check(parse(call('GET', '/api/works?sort=title', cookie=ALICE))['items'][0]['title'] == '实时换装', 'sort title')
        check(parse(call('GET', '/api/works?page=99', cookie=ALICE))['page'] == 1, 'page clamped')
        check(call('GET', '/api/works?sort=invalid', cookie=ALICE)[0] == 400, 'invalid sort')
        check(call('GET', '/api/works?kind=invalid', cookie=ALICE)[0] == 400, 'invalid kind')
        check(call('GET', '/api/works?q=%01', cookie=ALICE)[0] == 400, 'control character search')

        renamed = call('POST', f'/api/works/{work_id}', cookie=ALICE, headers=owner, body=body_json({'title': '合成作品'}))
        check(renamed[0] == 200 and parse(renamed)['title'] == '合成作品', 'rename')
        check(call('POST', f'/api/works/{work_id}', cookie=ALICE, headers=owner, body=body_json({'title': '   '}))[0] == 400,
              'empty title rejected')
        favorited = call('POST', f'/api/works/{work_id}', cookie=ALICE, headers=owner, body=body_json({'favorite': True}))
        check(favorited[0] == 200 and parse(favorited)['favorite'] is True, 'favorite')
        check(parse(call('GET', '/api/works?favorite=true', cookie=ALICE))['total'] == 1, 'favorite filter')
        check(call('POST', f'/api/works/{work_id}', cookie=ALICE, headers=owner, body=body_json({'favorite': 'yes'}))[0] == 400,
              'favorite type')
        check(call('GET', f'/api/works/{work_id}', cookie=BOB)[0] == 404, 'foreign work hidden')
        check(call('POST', f'/api/works/{work_id}/chunks/0', cookie=BOB, headers=chunk_headers, body=chunks[0])[0] == 409,
              'foreign chunk blocked by owner binding')
        check(call('GET', f'/api/works/{work_id}', cookie=ALICE, headers={'X-Work-Owner': BOB_ID})[0] == 409,
              'bound owner mismatch')

        # 参考图上限
        limit_work = str(uuid4())
        check(call('POST', '/api/works', cookie=ALICE, headers=owner,
                   body=body_json({'id': limit_work, 'kind': 'edit', 'mime': 'video/mp4', 'seconds': 30, 'ownerId': ALICE_ID}))[0] == 201,
              'create edit work')
        for index in range(24):
            response = call('POST', f'/api/works/{limit_work}/references/{uuid4()}', cookie=ALICE, headers=ref_headers, body=image)
            check(response[0] == 200, 'reference ' + str(index))
        over = call('POST', f'/api/works/{limit_work}/references/{uuid4()}', cookie=ALICE, headers=ref_headers, body=image)
        check(over[0] == 409 and parse(over)['error']['code'] == 'REFERENCE_LIMIT', 'reference limit')

        # 空录像、部分保存、参考图失败
        empty_id = str(uuid4())
        call('POST', '/api/works', cookie=ALICE, headers=owner,
             body=body_json({'id': empty_id, 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        call('POST', f'/api/works/{empty_id}/complete', cookie=ALICE,
             headers={'Content-Type': 'application/json', 'X-Work-Owner': ALICE_ID}, body=body_json({}))
        empty = call('GET', f'/api/works/{empty_id}', cookie=ALICE)
        check(empty[0] == 200 and parse(empty)['state'] == 'failed' and parse(empty)['message'] == '未收到可保存的生成画面。',
              'empty capture failed')

        partial_id = str(uuid4())
        call('POST', '/api/works', cookie=ALICE, headers=owner,
             body=body_json({'id': partial_id, 'kind': 'realtime', 'mime': 'video/mp4', 'seconds': 15, 'ownerId': ALICE_ID}))
        call('POST', f'/api/works/{partial_id}/chunks/0', cookie=ALICE, headers=chunk_headers, body=chunks[0])
        call('POST', f'/api/works/{partial_id}/complete', cookie=ALICE,
             headers={'Content-Type': 'application/json', 'X-Work-Owner': ALICE_ID},
             body=body_json({'interrupted': True, 'referenceFailed': True}))
        partial = call('GET', f'/api/works/{partial_id}', cookie=ALICE)
        check(partial[0] == 200 and parse(partial)['state'] == 'ready', 'partial saved')
        check(parse(partial)['message'] == '服装参考图未能完整保存，请查看作品中的已保存内容。', 'partial message')
        check(call('GET', f'/api/works/{partial_id}/content', cookie=ALICE)[0] == 200, 'partial content')

        # WebM 作品
        webm_id = str(uuid4())
        call('POST', '/api/works', cookie=ALICE, headers=owner,
             body=body_json({'id': webm_id, 'kind': 'edit', 'mime': 'video/webm', 'seconds': 60, 'ownerId': ALICE_ID}))
        webm = b'\x1aE\xdf\xa3' + b'synthetic-webm' * 10
        call('POST', f'/api/works/{webm_id}/chunks/0', cookie=ALICE, headers=chunk_headers, body=webm)
        call('POST', f'/api/works/{webm_id}/complete', cookie=ALICE,
             headers={'Content-Type': 'application/json', 'X-Work-Owner': ALICE_ID}, body=body_json({}))
        webm_detail = call('GET', f'/api/works/{webm_id}', cookie=ALICE)
        check(parse(webm_detail)['state'] == 'ready' and parse(webm_detail)['extension'] == 'webm', 'webm ready')
        check(call('GET', f'/api/works/{webm_id}/content', cookie=ALICE)[1]['content-type'] == 'video/webm', 'webm mime')

        # 删除后不能复活
        deleted = call('POST', f'/api/works/{work_id}', cookie=ALICE, headers=owner, body=body_json({'action': 'delete'}))
        check(deleted[0] == 200 and parse(deleted) == {'accepted': True}, 'delete accepted')
        check(not (storage / ALICE_ID / 'works' / work_id).exists(), 'files removed')
        check(work_state(work_id)['title'] == '' and work_state(work_id)['favorite'] == 0, 'deleted row cleared')
        check(call('GET', f'/api/works/{work_id}', cookie=ALICE)[0] == 404, 'deleted hidden')
        check(call('POST', f'/api/works/{work_id}/chunks/2', cookie=ALICE, headers=chunk_headers, body=chunks[1])[0] == 404,
              'deleted chunk blocked')
        check(call('POST', f'/api/works/{work_id}/complete', cookie=ALICE,
                   headers={'Content-Type': 'application/json', 'X-Work-Owner': ALICE_ID}, body=body_json({}))[0] == 404,
              'deleted complete blocked')
        check(call('POST', f'/api/works/{work_id}/references/{uuid4()}', cookie=ALICE, headers=ref_headers, body=image)[0] == 404,
              'deleted reference blocked')
        check(call('GET', f'/api/works/{work_id}/content', cookie=ALICE)[0] == 404, 'deleted content blocked')
        check(parse(call('GET', '/api/works', cookie=ALICE))['total'] == 4, 'deleted excluded from list')
        check(all(ref['workId'] != work_id for ref in fixture('works-state', schema, {'username': 'm15_alice'})['references']),
              'deleted references removed')

        # 重启后作品与文件仍在
        stop_java(process)
        process, request = start_java(schema, storage)
        after_restart = call('GET', f'/api/works/{partial_id}', cookie=ALICE)
        check(after_restart[0] == 200 and parse(after_restart)['state'] == 'ready', 'work survives restart')
        check(call('GET', f'/api/works/{partial_id}/content', cookie=ALICE)[0] == 200, 'file survives restart')
    finally:
        if process is not None:
            stop_java(process)
        if created:
            fixture('cleanup', schema)
        import shutil
        shutil.rmtree(storage, ignore_errors=True)
    print(json.dumps({'status': 'PASSED', 'checks': COUNT, 'realPostgres': True, 'privateStorage': True,
                      'temporarySchemaRemoved': True, 'realProviderCalls': 0}))


if __name__ == '__main__':
    main()
