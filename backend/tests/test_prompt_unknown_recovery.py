from dataclasses import replace
from uuid import uuid4
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, delete

from app.core import COOKIE, digest, iso, now_ms
from app.main import create_app
from app.generation import PROMPT
from app.models import attempts, reservations
from conftest import initialize, signup


def configured(settings, budget="5", maximum="20"):
    return replace(settings, env={"DECART_API_KEY":"fixture_long_term_key", "YINGXIANG_PROMPT_ENABLED":"true", "YINGXIANG_PROMPT_BUDGET_USD":budget, "YINGXIANG_PROMPT_MAX_SESSIONS":maximum})


def body(ident=None):
    return {"attemptId":ident or str(uuid4()), "consentVersion":PROMPT["consentVersion"], "durationSec":15}


def test_expired_unknown_keeps_risk_and_never_reissues_same_attempt(settings, monkeypatch):
    settings = configured(settings); initialize(settings); calls=[]
    def upstream(request):
        calls.append(1)
        raise httpx.ReadTimeout("fixture-private-token-error")
    app=create_app(settings,transport=httpx.MockTransport(upstream))
    with TestClient(app,base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin; signup(client)
        access=client.get('/api/prompt/status').json()['access']; initial=body()
        response=client.post('/api/prompt/token',json=initial,headers={'x-studio-access':access})
        assert response.status_code==503 and 'UPSTREAM_TIMEOUT' in response.text
        assert 'fixture-private' not in response.text
        assert not client.get('/api/prompt/status').json()['available']
        with app.state.db.transaction() as session:
            old=dict(session.execute(select(attempts).where(attempts.c.id==initial['attemptId'])).mappings().one())
            risk=dict(session.execute(select(reservations).where(reservations.c.id==initial['attemptId'])).mappings().one())
        assert json.loads(old['observation'])=={'tokenFailure':'UPSTREAM_TIMEOUT','httpStatus':None}
        until=max(old['created_at']+60000,old['updated_at']+60000,risk['lease_until'])
        monkeypatch.setattr('app.generation.now_ms',lambda:until-1)
        assert not client.get('/api/prompt/status').json()['available']
        monkeypatch.setattr('app.generation.now_ms',lambda:until)
        assert client.get('/api/prompt/status').json()['available']
        assert client.post('/api/prompt/token',json=initial,headers={'x-studio-access':access}).status_code==409
        assert len(calls)==1
        # 用户新的明确操作才能预留下一次；旧unknown原样保存、不退款、不额外调用供应商。
        app.state.generation.reserve_token('prompt',digest(client.cookies[COOKIE]),body())
        with app.state.db.transaction() as session:
            assert dict(session.execute(select(attempts).where(attempts.c.id==initial['attemptId'])).mappings().one())==old
            assert dict(session.execute(select(reservations).where(reservations.c.id==initial['attemptId'])).mappings().one())==risk
            rows=session.execute(select(reservations).where(reservations.c.scene=='prompt')).mappings().all()
            assert len(rows)==2 and sum(r['micro_usd'] for r in rows)==600000
    # 重启不释放风险，新一次unknown继续有自己的等待窗口。
    with TestClient(create_app(settings),base_url=settings.public_origin) as again:
        again.headers['origin']=settings.public_origin
        with again.app.state.db.transaction() as session:
            user_id=old['user_id']
            assert not again.app.state.generation.prompt_ready(session,user_id)['available']


@pytest.mark.parametrize('budget,maximum', [('0.5','20'),('5','1')])
def test_elapsed_unknown_still_counts_budget_and_requests(settings,monkeypatch,budget,maximum):
    settings=configured(settings,budget,maximum); initialize(settings)
    app=create_app(settings)
    with TestClient(app,base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin; uid=signup(client)
        app.state.generation.reserve_token('prompt',digest(client.cookies[COOKIE]),body())
        later=now_ms()+120000; monkeypatch.setattr('app.generation.now_ms',lambda:later)
        with app.state.db.transaction() as session:
            status=app.state.generation.prompt_ready(session,uid)
        assert not status['available'] and '额度已用完' in status['message']


def test_unknown_without_risk_fails_closed(settings,monkeypatch):
    settings=configured(settings); initialize(settings)
    app=create_app(settings)
    with TestClient(app,base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin; uid=signup(client); attempt=body()
        app.state.generation.reserve_token('prompt',digest(client.cookies[COOKIE]),attempt)
        with app.state.db.transaction(True) as session:
            session.execute(delete(reservations).where(reservations.c.id==attempt['attemptId']))
        later=now_ms()+120000; monkeypatch.setattr('app.generation.now_ms',lambda:later)
        with app.state.db.transaction() as session:
            status=app.state.generation.prompt_ready(session,uid)
        assert not status['available'] and '预算预留无法核对' in status['message']


@pytest.mark.parametrize('fault,code,status',[('http','UPSTREAM_REJECTED',502),('json','INVALID_RESPONSE',200),('permissions','TOKEN_MODEL_MISMATCH',200),('network','UPSTREAM_CONNECTION',None)])
def test_token_failure_has_only_safe_diagnostic(settings,fault,code,status):
    settings=configured(settings); initialize(settings)
    def upstream(request):
        if fault=='network': raise httpx.ConnectError('fixture-private-key')
        if fault=='http': return httpx.Response(502,text='fixture-private-key')
        if fault=='json': return httpx.Response(200,text='fixture-private-key')
        return httpx.Response(200,json={'apiKey':'fixture-private-key','expiresAt':iso(now_ms()+9000),'permissions':{},'constraints':{}})
    app=create_app(settings,transport=httpx.MockTransport(upstream))
    with TestClient(app,base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin; signup(client)
        access=client.get('/api/prompt/status').json()['access']; attempt=body()
        response=client.post('/api/prompt/token',json=attempt,headers={'x-studio-access':access})
        assert response.status_code==503 and code in response.text and 'fixture-private' not in response.text
        with app.state.db.transaction() as session:
            row=session.execute(select(attempts).where(attempts.c.id==attempt['attemptId'])).mappings().one()
            assert row['state']=='unknown'
            assert json.loads(row['observation'])=={'tokenFailure':code,'httpStatus':status}
