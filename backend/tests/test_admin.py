from uuid import uuid4

import pytest
from sqlalchemy import select, update, insert

from app.core import digest, BusinessError, now_ms
from app.models import users, grants, entries, admin_audit, attempts, jobs
from conftest import signup


def promote(app, ident):
    with app.state.db.transaction(True) as session:
        session.execute(update(users).where(users.c.id == ident).values(role='admin'))


def body(**values):
    return {'requestId': str(uuid4()), 'reason': '自动化权限回归测试', **values}


READS = ['/api/admin/overview', '/api/admin/users', '/api/admin/records/video', '/api/admin/records/usage', '/api/admin/records/orders', '/api/admin/settings', '/api/admin/audit']


def test_admin_default_denial_even_username_suny_and_spoofed_headers(client, app):
    for path in READS:
        assert client.get(path).status_code == 401
    ident = signup(client, 'suny')
    assert client.get('/api/account/me').json()['user']['role'] == 'user'
    for path in READS:
        assert client.get(path, headers={'x-role': 'admin', 'x-user-id': ident}).status_code == 403
    for path in [f'/api/admin/users/{ident}', f'/api/admin/users/{ident}/quota', '/api/admin/settings/announcement', '/api/admin/settings/services']:
        assert client.post(path, json={'role': 'admin'}).status_code == 403
    assert client.post('/api/account/register', json={'username': 'spoofadmin', 'password': 'test-password-only', 'role': 'admin'}).status_code == 400


def test_admin_read_models_safe_and_paginated(client, app):
    ident = signup(client)
    promote(app, ident)
    assert client.get('/api/account/me').json()['user']['role'] == 'admin'
    for path in READS:
        result = client.get(path)
        assert result.status_code == 200, result.text
        assert result.headers['cache-control'] == 'no-store'
        for sensitive in ['password_hash', 'salt', 'checkout_url', 'session_id', 'provider_id', 'DECART_API_KEY']:
            assert sensitive not in result.text
    result = client.get('/api/admin/users').json()
    assert result['total'] == 1 and result['items'][0]['role'] == 'admin'
    assert client.get('/api/admin/users?q=%25').json()['total'] == 0
    assert client.get('/api/admin/users?page=0').status_code == 400
    assert client.get('/api/admin/users?page=2').json()['items'] == []


def test_admin_quota_idempotency_and_revoke_only_available(client, app):
    ident = signup(client)
    promote(app, ident)
    path = f'/api/admin/users/{ident}/quota'
    change = body(seconds=30, delta=3)
    assert client.post(path, json=change).status_code == 200
    assert client.post(path, json=change).status_code == 200
    assert client.get('/api/account/me').json()['durations'][1]['remaining'] == 3
    assert client.post(path, json={**change, 'delta': 4}).status_code == 409
    assert client.post(path, json=body(seconds=30, delta=True)).status_code == 400
    assert client.post(path, json=body(seconds=30, delta=0)).status_code == 400
    assert client.post(path, json=body(seconds=30, delta=3, role='admin')).status_code == 400
    hashed = digest(client.cookies.get('yingxiang_session'))
    with app.state.db.transaction(True) as session:
        app.state.accounts.reserve(session, hashed, str(uuid4()), 30)
    assert client.post(path, json=body(seconds=30, delta=-3)).status_code == 409
    assert client.post(path, json=body(seconds=30, delta=-2)).status_code == 200
    assert client.get('/api/account/me').json()['durations'][1]['remaining'] == 0
    with app.state.db.transaction() as session:
        rows = session.execute(select(grants).where(grants.c.seconds == 30)).mappings().all()
        assert sum(r['reserved'] for r in rows) == 1
        assert sum(r['revoked'] for r in rows) == 2
        assert len(session.execute(select(admin_audit)).all()) == 2
        assert len(session.execute(select(entries).where(entries.c.kind == 'revoke')).all()) == 1


def test_admin_protection_role_revocation_and_session_invalidation(client, app):
    admin_id = signup(client, 'owner_admin')
    owner_cookie = client.cookies.get('yingxiang_session')
    promote(app, admin_id)
    path = f'/api/admin/users/{admin_id}'
    assert client.post(path, json=body(role='user', disabled=False)).status_code == 409
    assert client.post(path, json=body(role='admin', disabled=True)).status_code == 409
    target = signup(client, 'second_user')
    target_cookie = client.cookies.get('yingxiang_session')
    client.cookies.clear()
    client.cookies.set('yingxiang_session', owner_cookie, domain='127.0.0.1', path='/')
    assert client.post(f'/api/admin/users/{target}', json=body(role='admin', disabled=False)).status_code == 200
    assert client.get('/api/account/me', headers={'cookie': f'yingxiang_session={target_cookie}'}).json()['user'] is None
    assert client.post(f'/api/admin/users/{target}', json=body(role='user', disabled=True)).status_code == 200
    assert client.post('/api/account/login', json={'username': 'second_user', 'password': 'test-password-only'}).status_code == 403
    assert client.post(f'/api/admin/users/{target}', json=body(role='user', disabled=False)).status_code == 200
    assert client.post('/api/account/login', json={'username': 'second_user', 'password': 'test-password-only'}).status_code == 200
    assert client.get('/api/admin/users').status_code == 403


def test_admin_origins_and_stale_permission_rechecked(client, app):
    ident = signup(client)
    promote(app, ident)
    change = body(seconds=15, delta=1)
    path = f'/api/admin/users/{ident}/quota'
    assert client.post(path, json=change, headers={'origin': 'https://evil.example'}).status_code == 403
    request = client.build_request('POST', path, json=change)
    del request.headers['origin']
    assert client.send(request).status_code == 403
    with app.state.db.transaction(True) as session:
        session.execute(update(users).where(users.c.id == ident).values(role='user'))
    assert client.post(path, json=change).status_code == 403
    with app.state.db.transaction() as session:
        assert len(session.execute(select(admin_audit)).all()) == 0


def test_admin_settings_version_replay_and_plain_text_announcement(client, app):
    ident = signup(client)
    promote(app, ident)
    path = '/api/admin/settings/announcement'
    draft = body(version=0, enabled=False, zh='未发布内容', en='Unpublished')
    assert client.post(path, json=draft).status_code == 200
    assert client.get('/api/site/announcement').json()['zh'] == ''
    change = body(version=1, enabled=True, zh='<script>not executable</script>', en='Test announcement')
    assert client.post(path, json=change).status_code == 200
    assert client.post(path, json=change).status_code == 200
    assert client.post(path, json={**change, 'requestId': str(uuid4())}).status_code == 409
    assert client.get('/api/site/announcement').json()['zh'] == change['zh']
    assert client.post(path, json=body(version=2, enabled=True, zh='', en='test')).status_code == 400
    assert client.post('/api/admin/settings/arbitrary', json=change).status_code == 400
    assert client.get('/api/admin/audit').json()['total'] == 2


def test_admin_pause_does_not_enable_config_or_reset_risk(client, app, settings):
    ident = signup(client)
    promote(app, ident)
    settings.env.update({'YINGXIANG_STUDIO_ENABLED': 'true', 'DECART_API_KEY': 'test-key-only', 'YINGXIANG_VIDEO_ENABLED': 'true', 'YINGXIANG_VIDEO_BUDGET_USD': '5', 'YINGXIANG_VIDEO_MAX_JOBS': '20'})
    assert client.get('/api/studio/status').json()['available'] is True
    change = body(version=0, paused={'studio': True, 'video': True, 'prompt': True})
    assert client.post('/api/admin/settings/services', json=change).status_code == 200
    assert client.get('/api/studio/status').json()['available'] is False
    assert client.get('/api/video/jobs').json()['available'] is False
    with pytest.raises(BusinessError):
        app.state.generation.reserve_job(ident, str(uuid4()), 5)
    with pytest.raises(BusinessError):
        app.state.generation.reserve_token('studio', digest(client.cookies.get('yingxiang_session')), {'attemptId': str(uuid4()), 'consentVersion': app.state.generation.studio_status()['policy']['consentVersion']})
    assert client.post('/api/admin/settings/services', json=body(version=1, paused={'studio': False, 'video': False, 'prompt': False})).status_code == 200
    assert client.get('/api/studio/status').json()['available'] is True
    assert client.get('/api/prompt/status').json()['available'] is False
    overview = client.get('/api/admin/overview').json()
    assert overview['livePaymentsEnabled'] is False
    assert next(v for v in overview['services'] if v['scene'] == 'video')['budgetUsd'] == 5
    with app.state.db.transaction() as session:
        assert len(session.execute(select(jobs)).all()) == 0
        assert len(session.execute(select(attempts)).all()) == 0


def test_admin_reads_records_without_provider_calls(client, app):
    ident = signup(client)
    promote(app, ident)
    with app.state.db.transaction(True) as session:
        session.execute(insert(jobs).values(id=str(uuid4()), user_id=ident, state='unknown', created_at=now_ms(), expires_at=now_ms()+10000, seconds_milli=5000, micro_usd=200000))
    result = client.get('/api/admin/records/video?state=unknown').json()
    assert result['total'] == 1 and result['items'][0]['seconds'] == 5
    assert client.get('/api/admin/overview').json()['unknownResults'] == 1
    assert client.post('/api/admin/records/video', json={'state': 'completed'}).status_code == 405
