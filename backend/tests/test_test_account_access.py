from dataclasses import replace
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.core import BusinessError, COOKIE, digest
from app.generation import PROMPT
from conftest import initialize, signup


def test_scene_allowlist_enforced_by_status_and_reservation(settings):
    env = {'DECART_API_KEY':'fixture_long_term_key'}
    for scene, suffix in [('VIDEO','JOBS'),('PROMPT','SESSIONS')]:
        env.update({f'YINGXIANG_{scene}_ENABLED':'true',f'YINGXIANG_{scene}_BUDGET_USD':'5',f'YINGXIANG_{scene}_MAX_{suffix}':'20',f'YINGXIANG_{scene}_ALLOWED_USERNAMES':'suny'})
    settings = replace(settings, env=env)
    initialize(settings)
    with TestClient(create_app(settings), base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin
        gen=client.app.state.generation
        assert not client.get('/api/video/jobs').json()['available']
        assert not client.get('/api/prompt/status').json()['available']
        outsider=signup(client,'other_fixture')
        assert not client.get('/api/video/jobs').json()['available']
        assert 'access' not in client.get('/api/prompt/status').json()
        with pytest.raises(BusinessError):
            gen.reserve_job(outsider,str(uuid4()),8)
        body={'attemptId':str(uuid4()),'consentVersion':PROMPT['consentVersion'],'durationSec':15}
        with pytest.raises(BusinessError):
            gen.reserve_token('prompt',digest(client.cookies[COOKIE]),body)
        client.post('/api/account/logout')
        owner=signup(client,'suny')
        assert client.get('/api/video/jobs').json()['available']
        assert client.get('/api/prompt/status').json()['available']
        assert 'access' in client.get('/api/prompt/status').json()
        body['attemptId']=str(uuid4())
        gen.reserve_token('prompt',digest(client.cookies[COOKIE]),body)
        row,fresh=gen.reserve_job(owner,str(uuid4()),8)
        assert fresh and row['micro_usd']==320000
        # 仍保留并发/未知任务拦截，不因测试账号绕过。
        with pytest.raises(BusinessError):
            gen.reserve_job(owner,str(uuid4()),8)
