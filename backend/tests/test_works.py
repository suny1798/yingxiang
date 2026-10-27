"""只用临时用户目录/库与供应商替身；不发起真实模型。"""
import asyncio
import base64
import json
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update, text

from app.core import now_ms
from app.main import create_app
from app.models import works, work_references, jobs
from app.works import Works
from conftest import initialize, signup
from test_video_history import seed

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv9kAAAAASUVORK5CYII=')
WEBM = b'\x1aE\xdf\xa3' + b'synthetic-video-only' * 5
MP4 = b'\x00\x00\x00\x18ftypisom' + b'synthetic-result' * 5


@pytest.fixture(autouse=True)
def no_automatic_worker(monkeypatch):
    async def park(self):
        await self.stopping.wait()
    monkeypatch.setattr(Works, 'run', park)


def create(client, uid, kind='realtime'):
    ident = str(uuid4())
    headers = {'x-work-owner': uid}
    body = {'id': ident, 'ownerId': uid, 'kind': kind, 'mime': 'video/webm', 'seconds': 15}
    response = client.post('/api/works', json=body, headers=headers)
    assert response.status_code == 201, response.text
    return ident, headers, body


def ready(client, uid):
    ident, headers, _ = create(client, uid)
    assert client.post(f'/api/works/{ident}/chunks/0', content=WEBM, headers=headers).status_code == 200
    assert client.post(f'/api/works/{ident}/complete', json={'durationMs': 2400}, headers=headers).status_code == 202
    client.portal.call(client.app.state.works.tick)
    assert client.get(f'/api/works/{ident}').json()['state'] == 'ready'
    return ident


def test_realtime_chunks_references_range_and_private_user_directory(client, settings):
    uid = signup(client); ident, headers, body = create(client, uid)
    service = client.app.state.works
    ref_ids = [str(uuid4()), str(uuid4())]
    for ref in ref_ids:
        result = client.post(f'/api/works/{ident}/references/{ref}', content=PNG, headers={**headers, 'content-type': 'image/png'})
        assert result.status_code == 200, result.text
    assert client.post('/api/works', json=body, headers=headers).status_code == 201  # 创建幂等
    assert client.post(f'/api/works/{ident}/chunks/1', content=WEBM, headers=headers).status_code == 409
    for i, data in enumerate((WEBM[:20], WEBM[20:])):
        assert client.post(f'/api/works/{ident}/chunks/{i}', content=data, headers=headers).status_code == 200
        assert client.post(f'/api/works/{ident}/chunks/{i}', content=data, headers=headers).status_code == 200
    assert client.post(f'/api/works/{ident}/chunks/0', content=b'conflict', headers=headers).status_code == 409
    assert client.get(f'/api/works/{ident}/content').status_code == 409
    assert client.post(f'/api/works/{ident}/complete', json={'durationMs': 1000}, headers=headers).status_code == 202
    client.portal.call(service.tick)
    item = client.get(f'/api/works/{ident}').json()
    assert item['state'] == 'ready' and len(item['references']) == 2 and item['seconds'] == 1
    path = settings.data_dir / 'users' / uid / 'works' / ident
    assert (path / 'result.webm').read_bytes() == WEBM
    assert len(list(path.glob('reference-*.png'))) == 2
    assert not list(path.glob('chunk-*'))
    partial = client.get(item['contentUrl'], headers={'range': 'bytes=4-11'})
    assert partial.status_code == 206 and partial.content == WEBM[4:12]
    assert partial.headers['accept-ranges'] == 'bytes' and partial.headers['cache-control'] == 'no-store'
    assert client.get(item['contentUrl'], headers={'range': 'bytes=9999-10000'}).status_code == 416
    assert client.head(item['contentUrl']).status_code == 200
    assert client.get(item['contentUrl'] + '?download=1').headers['content-disposition'].startswith('attachment')
    assert client.get(item['references'][0]['url']).content == PNG
    assert client.post(f'/api/works/{ident}/complete', json={}, headers=headers).status_code == 202


def test_auth_owner_binding_origin_validation_and_cross_user_isolation(client):
    assert client.get('/api/works').status_code == 401
    uid = signup(client); ident, headers, body = create(client, uid)
    ref_id = str(uuid4())
    assert client.post('/api/works', json={**body, 'id': '../outside'}, headers=headers).status_code == 400
    assert client.post(f'/api/works/{ident}/chunks/0', content=WEBM).status_code == 409
    assert client.post(f'/api/works/{ident}/chunks/0', content=WEBM, headers={**headers, 'origin': 'https://other.example'}).status_code == 403
    assert client.post(f'/api/works/{ident}/references/{ref_id}', content=b'<html>unsafe</html>', headers={**headers, 'content-type': 'image/png'}).status_code == 400
    assert client.get('/api/works?page=0').status_code == 400
    assert client.get('/api/works?kind=other').status_code == 400
    client.post('/api/account/logout'); other = signup(client, 'other_owner')
    assert client.get('/api/works').json()['items'] == []
    assert client.get(f'/api/works/{ident}').status_code == 404
    assert client.get(f'/api/works/{ident}/content').status_code == 404
    assert client.get(f'/api/works/{ident}/references/{ref_id}').status_code == 404
    assert client.post(f'/api/works/{ident}', json={'title': 'stolen'}).status_code == 404
    assert client.post('/api/works', json={**body, 'ownerId': other}, headers={'x-work-owner': other}).status_code == 404
    assert client.post(f'/api/works/{ident}/chunks/0', content=WEBM, headers=headers).status_code == 409


def test_edit_prompt_history_private_ordered_persistent_and_deleted(client, settings):
    uid = signup(client); ident, headers, _ = create(client, uid, 'edit')
    base = f'/api/works/{ident}/prompts'
    first = {'atMs': 0, 'instructions': ['把上衣改成米白色针织开衫。', '保留人物的面部和动作。']}
    second = {'atMs': 2500, 'instructions': ['保留人物的面部和动作。', '材质保留细密织纹。\n不要增加图案。']}
    assert client.get(base).json() == {'states': []}  # 旧作品不会补造
    assert client.post(base + '/1', json=second, headers=headers).status_code == 409
    for index, state in enumerate((first, second)):
        assert client.post(base + f'/{index}', json=state, headers=headers).status_code == 200
        assert client.post(base + f'/{index}', json=state, headers=headers).status_code == 200
    assert client.post(base + '/0', json=second, headers=headers).status_code == 409
    assert client.post(base + '/2', json={'atMs': 2000, 'instructions': ['倒退']}, headers=headers).status_code == 409
    response = client.get(base)
    assert response.json() == {'states': [first, second]} and response.headers['cache-control'] == 'no-store'
    assert 'instructions' not in client.get('/api/works').text
    replacement = Works(client.app.state.db, client.app.state.generation, settings)
    assert replacement.prompt_history(uid, ident) == [first, second]
    path = settings.data_dir / 'users' / uid / 'works' / ident / 'prompts.json'
    assert path.exists() and '米白色' in path.read_text(encoding='utf-8')
    assert client.post(base + '/2', json=second).status_code == 409
    assert client.post(base + '/2', json=second, headers={**headers, 'origin': 'https://other.example'}).status_code == 403
    client.post('/api/account/logout'); signup(client, 'prompt_other')
    assert client.get(base).status_code == 404
    assert client.post(base + '/2', json=second, headers=headers).status_code == 409
    replacement.complete(uid, ident)
    assert replacement.change(uid, ident, {'action': 'delete'}) == {'accepted': True}
    assert not path.exists() and client.get(base).status_code == 404


def test_edit_prompt_validation_and_failure_does_not_discard_video(client, settings):
    uid = signup(client); ident, headers, _ = create(client, uid, 'edit')
    base = f'/api/works/{ident}/prompts'
    for state in ({}, {'atMs': True, 'instructions': ['x']}, {'atMs': 0, 'instructions': []},
                  {'atMs': 0, 'instructions': ['x'] * 13}, {'atMs': 0, 'instructions': ['字' * 501]},
                  {'atMs': 15001, 'instructions': ['x']}, {'atMs': 0, 'instructions': [12]},
                  {'atMs': 0, 'instructions': ['\ud800']}, {'atMs': 0, 'instructions': ['x'], 'extra': True}):
        assert client.post(base + '/0', content=json.dumps(state).encode('utf-8'), headers={**headers, 'content-type': 'application/json'}).status_code == 400
    large = {'atMs': 0, 'instructions': ['字' * 500] * 12}
    assert client.post(base + '/0', content=json.dumps(large, ensure_ascii=False).encode('utf-8'), headers={**headers, 'content-type': 'application/json'}).status_code == 200
    assert client.post(base + '/128', json=large, headers=headers).status_code == 400
    other, other_headers, _ = create(client, uid)
    assert client.post(f'/api/works/{other}/prompts/0', json=large, headers=other_headers).status_code == 400
    assert client.post(f'/api/works/{ident}/chunks/0', content=WEBM, headers=headers).status_code == 200
    assert client.post(f'/api/works/{ident}/complete', json={'promptsFailed': True}, headers=headers).status_code == 202
    client.portal.call(client.app.state.works.tick)
    item = client.get(f'/api/works/{ident}').json()
    assert item['state'] == 'ready' and '提示词' in item['message']
    assert client.post(base + '/0', json=large, headers=headers).status_code == 200
    assert client.post(base + '/1', json={'atMs': 1000, 'instructions': ['late']}, headers=headers).status_code == 409
    path = settings.data_dir / 'users' / uid / 'works' / ident / 'prompts.json'
    path.write_text('corrupted', encoding='utf-8')
    assert client.get(base).status_code == 503


def test_interrupted_recording_finalizes_confirmed_chunks_after_recreation(client, settings):
    uid = signup(client); ident, headers, _ = create(client, uid, 'edit')
    client.post(f'/api/works/{ident}/chunks/0', content=WEBM, headers=headers)
    with client.app.state.db.transaction(True) as s:
        s.execute(update(works).where(works.c.id == ident).values(updated_at=now_ms() - 121_000))
    replacement = Works(client.app.state.db, client.app.state.generation, settings)
    client.portal.call(replacement.tick); client.portal.call(replacement.tick)
    result = client.get(f'/api/works/{ident}').json()
    assert result['state'] == 'ready' and '片段' in result['message']
    empty, _, _ = create(client, uid)
    client.post(f'/api/works/{empty}/complete', json={}, headers=headers)
    assert client.get(f'/api/works/{empty}').json()['state'] == 'failed'
    empty_ref, _, _ = create(client, uid)
    client.post(f'/api/works/{empty_ref}/complete', json={'referenceFailed': True}, headers=headers)
    empty_result = client.get(f'/api/works/{empty_ref}').json()
    assert empty_result['state'] == 'failed' and '未收到' in empty_result['message']
    partial_ref, _, _ = create(client, uid)
    client.post(f'/api/works/{partial_ref}/chunks/0', content=WEBM, headers=headers)
    client.post(f'/api/works/{partial_ref}/complete', json={'referenceFailed': True}, headers=headers)
    client.portal.call(replacement.tick)
    reference_result = client.get(f'/api/works/{partial_ref}').json()
    assert reference_result['state'] == 'ready' and '参考图未能完整' in reference_result['message']


def test_paging_rename_delete_including_reference_files_and_no_resurrection(client, settings):
    uid = signup(client); ident, headers, _ = create(client, uid)
    ref_id = str(uuid4())
    client.post(f'/api/works/{ident}/references/{ref_id}', content=PNG, headers={**headers, 'content-type': 'image/png'})
    client.post(f'/api/works/{ident}/chunks/0', content=WEBM, headers=headers)
    client.post(f'/api/works/{ident}/complete', json={}, headers=headers)
    client.portal.call(client.app.state.works.tick)
    for _ in range(3): ready(client, uid)
    assert client.get('/api/works?pageSize=2').json()['pages'] == 2
    for title in ('', 'x' * 61, 'line\nbreak'):
        assert client.post(f'/api/works/{ident}', json={'title': title}).status_code == 400
    assert client.post(f'/api/works/{ident}', json={'title': '  我的第一件作品  '}).json()['title'] == '我的第一件作品'
    assert client.post(f'/api/works/{ident}', json={'action': 'delete'}).status_code == 200
    assert not (settings.data_dir / 'users' / uid / 'works' / ident).exists()
    assert client.get(f'/api/works/{ident}').status_code == 404
    assert client.get(f'/api/works/{ident}/references/{ref_id}').status_code == 404
    client.portal.call(client.app.state.works.tick)
    assert client.get('/api/works').json()['total'] == 3
    with client.app.state.db.transaction() as s:
        assert s.execute(select(works.c.state).where(works.c.id == ident)).scalar_one() == 'deleted'
        assert not s.execute(select(work_references).where(work_references.c.work_id == ident)).all()


def test_video_background_save_without_page_and_restart_recovery(settings):
    initialize(settings)
    calls = []
    def upstream(request):
        calls.append((request.method, request.url.path))
        if request.url.path.endswith('/content'):
            return httpx.Response(200, headers={'content-type': 'video/mp4'}, content=MP4)
        return httpx.Response(200, json={'job_id': request.url.path.split('/')[-1], 'status': 'completed'})
    configured = replace(settings, env={'DECART_API_KEY': 'fixture_key'})
    app = create_app(configured, transport=httpx.MockTransport(upstream))
    with TestClient(app, base_url='http://127.0.0.1:8787') as client:
        client.headers['origin'] = 'http://127.0.0.1:8787'
        uid = signup(client); job_id = seed(client, uid, 'pending')
        generation = app.state.generation
        row = generation.own_job(uid, job_id)
        app.state.works.video_reference(row, PNG, 'image/png')
        service = Works(app.state.db, generation, configured)  # 重建队列服务，不依赖页面轮询
        def age():
            with app.state.db.transaction(True) as s:
                s.execute(update(works).values(updated_at=now_ms() - 20_000))
        age(); client.portal.call(service.tick)
        age(); client.portal.call(service.tick)
        item = client.get('/api/works').json()['items'][0]
        assert item['kind'] == 'video' and item['state'] == 'ready' and len(item['references']) == 1
        assert client.get(item['contentUrl']).content == MP4
        with app.state.db.transaction(True) as s:
            s.execute(update(jobs).where(jobs.c.id == job_id).values(expires_at=now_ms() - 1))
        assert client.get(item['contentUrl']).status_code == 200  # 本站副本不依赖供应商到期
        assert client.post(f'/api/works/{item["id"]}', json={'action': 'delete'}).status_code == 200
        client.portal.call(service.tick)
        assert client.get('/api/works').json()['total'] == 0
        assert len(calls) == 2 and all(method == 'GET' for method, _ in calls)


def test_failed_video_save_retry_is_download_only_and_expiry_visible(settings):
    initialize(settings); success = False
    def upstream(request):
        assert request.method == 'GET' and request.url.path.endswith('/content')
        return httpx.Response(200 if success else 502, headers={'content-type': 'video/mp4'}, content=MP4 if success else b'')
    app = create_app(replace(settings, env={'DECART_API_KEY': 'fixture'}), transport=httpx.MockTransport(upstream))
    with TestClient(app, base_url='http://127.0.0.1:8787') as client:
        client.headers['origin'] = 'http://127.0.0.1:8787'
        uid = signup(client); source = seed(client, uid)
        service = app.state.works; row = service.ensure_video(app.state.generation.own_job(uid, source))
        for _ in range(3):
            row = service.own(uid, row['id'])
            client.portal.call(service.save_video, row)
        assert client.get(f'/api/works/{row["id"]}').json()['state'] == 'failed'
        success = True
        assert client.post(f'/api/works/{row["id"]}', json={'action': 'retry'}).status_code == 200
        client.portal.call(service.save_video, service.own(uid, row['id']))
        assert client.get(f'/api/works/{row["id"]}').json()['state'] == 'ready'
        expired = service.ensure_video(app.state.generation.own_job(uid, seed(client, uid, expired=True)))
        client.portal.call(service.save_video, expired)
        result = client.get(f'/api/works/{expired["id"]}').json()
        assert result['state'] == 'failed' and not result['canRetry'] and '过期' in result['message']


def test_directory_rejects_symlinks_and_unsafe_ids(client, settings):
    uid = signup(client); ident, _, _ = create(client, uid)
    with pytest.raises(Exception):
        client.app.state.works.directory(uid, '../escape')
    directory = settings.data_dir / 'users' / uid
    directory.parent.mkdir(exist_ok=True)
    outside = settings.data_dir / 'outside'; outside.mkdir()
    try:
        directory.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip('当前Windows未授权创建符号链接')
    with pytest.raises(Exception):
        client.app.state.works.directory(uid, ident)


def test_favorite_is_private_persistent_idempotent_and_does_not_touch_save_clock(client):
    uid = signup(client); ident = ready(client, uid)
    before = client.get(f'/api/works/{ident}').json()
    assert before['favorite'] is False
    assert client.post(f'/api/works/{ident}', json={'favorite': 'yes'}).status_code == 400
    assert client.post(f'/api/works/{ident}', json={'favorite': True}, headers={'origin': 'https://other.example'}).status_code == 403
    for _ in range(2):
        result = client.post(f'/api/works/{ident}', json={'favorite': True})
        assert result.status_code == 200 and result.json()['favorite'] is True
    assert client.get(f'/api/works/{ident}').json()['updatedAt'] == before['updatedAt']
    assert client.get('/api/works?favorite=true').json()['total'] == 1
    assert client.get('/api/works?favorite=false').json()['total'] == 1  # false表示不筛选，而非仅未收藏
    replacement = Works(client.app.state.db, client.app.state.generation, client.app.state.settings)
    assert replacement.own(uid, ident)['favorite'] == 1
    client.post('/api/account/logout'); signup(client, 'favorite_other')
    assert client.post(f'/api/works/{ident}', json={'favorite': False}).status_code == 404
    assert client.get('/api/works?favorite=true').json()['total'] == 0


def test_search_literal_sort_and_combined_filters_cover_all_pages(client):
    uid = signup(client); identifiers = [ready(client, uid) for _ in range(3)]
    titles = ('100% 真丝', '蓝色_外套', '莓果\\针织')
    for index, (ident, title) in enumerate(zip(identifiers, titles)):
        assert client.post(f'/api/works/{ident}', json={'title': title}).status_code == 200
    with client.app.state.db.transaction(True) as session:
        for index, ident in enumerate(identifiers):
            session.execute(update(works).where(works.c.id == ident).values(created_at=1000 + index))
    assert [item['title'] for item in client.get('/api/works?q=100%25').json()['items']] == ['100% 真丝']
    assert [item['title'] for item in client.get('/api/works?q=_').json()['items']] == ['蓝色_外套']
    assert [item['title'] for item in client.get('/api/works?q=%5C').json()['items']] == ['莓果\\针织']
    assert client.get('/api/works?q=%25').json()['total'] == 1  # %不是任意匹配符
    assert client.get('/api/works?sort=oldest&pageSize=2&page=2').json()['items'][0]['id'] == identifiers[2]
    assert [item['title'] for item in client.get('/api/works?sort=title').json()['items']] == sorted(titles, key=lambda value: (value.lower(), value))
    assert client.post(f'/api/works/{identifiers[1]}', json={'favorite': True}).status_code == 200
    filtered = client.get('/api/works?favorite=true&kind=realtime&q=%E8%93%9D%E8%89%B2&sort=oldest').json()
    assert filtered['total'] == 1 and filtered['items'][0]['id'] == identifiers[1]
    assert client.get('/api/works?kind=video&q=100%25').json()['total'] == 0
    assert client.get('/api/works?sort=unknown').status_code == 400
    assert client.get('/api/works?q=line%0Abreak').status_code == 400


def test_upgrade_0005_preserves_work_and_adds_default_favorite(settings):
    from pathlib import Path
    from alembic import command
    from alembic.config import Config
    from app.db import Database
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    config.attributes['settings'] = settings
    command.upgrade(config, '0005')
    db = Database(settings.database)
    with db.transaction(True) as session:
        session.execute(text("INSERT INTO users (id,username,salt,password_hash,created_at) VALUES ('fixture-user','fixture','salt','hash',1)"))
        session.execute(text("INSERT INTO works (id,user_id,kind,source_id,title,state,mime,extension,bytes,chunks,duration_ms,created_at,updated_at,error_code,retries) VALUES ('fixture-work','fixture-user','realtime',NULL,'旧作品','ready','video/webm','webm',12,0,15000,100,200,NULL,0)"))
        before = dict(session.execute(text("SELECT * FROM works WHERE id='fixture-work'")).mappings().one())
    db.close()
    command.upgrade(config, 'head')
    db = Database(settings.database)
    assert db.readiness()
    with db.transaction() as session:
        after = dict(session.execute(text("SELECT * FROM works WHERE id='fixture-work'")).mappings().one())
        assert after['favorite'] == 0
        assert {key: after[key] for key in before} == before
        assert session.execute(text('PRAGMA foreign_key_check')).all() == []
        assert session.execute(text('PRAGMA integrity_check')).scalar() == 'ok'
    db.close()
