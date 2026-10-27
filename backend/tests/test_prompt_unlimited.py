from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func

from app.core import COOKIE, BusinessError, digest
from app.main import create_app
from app.generation import PROMPT
from app.models import attempts, reservations
from conftest import initialize, signup


def request_body(ident=None):
    return {'attemptId':ident or str(uuid4()), 'consentVersion':PROMPT['consentVersion'], 'durationSec':15}


@pytest.mark.parametrize('budget,maximum',[('0.5','1'),('0','0')])
def test_explicit_user_can_repeat_without_budget_count_or_cooldown(settings,budget,maximum):
    settings=replace(settings,env={'DECART_API_KEY':'fixture_long_term_key','YINGXIANG_PROMPT_ENABLED':'true','YINGXIANG_PROMPT_BUDGET_USD':budget,'YINGXIANG_PROMPT_MAX_SESSIONS':maximum,'YINGXIANG_PROMPT_ALLOWED_USERNAMES':'suny','YINGXIANG_PROMPT_UNLIMITED_USERNAMES':'suny'})
    initialize(settings)
    with TestClient(create_app(settings),base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin
        assert not client.get('/api/prompt/status').json()['available']
        signup(client,'suny'); generation=client.app.state.generation; hashed=digest(client.cookies[COOKIE])
        first=request_body()
        generation.reserve_token('prompt',hashed,first)
        # 第一条unknown和活动lease存在时，连续新操作仍可用；超过20次/$5也不拦截。
        for _ in range(24):
            assert client.get('/api/prompt/status').json()['available']
            generation.reserve_token('prompt',hashed,request_body())
        assert client.get('/api/prompt/status').json()['available']
        with client.app.state.db.transaction() as session:
            assert session.execute(select(func.count()).select_from(attempts)).scalar_one()==25
            assert session.execute(select(func.sum(reservations.c.micro_usd))).scalar_one()==7500000
            assert session.execute(select(attempts.c.state).where(attempts.c.id==first['attemptId'])).scalar_one()=='unknown'
        with pytest.raises(BusinessError) as error:generation.reserve_token('prompt',hashed,first)
        assert error.value.code=='PROMPT_ATTEMPT_SPENT'
        client.post('/api/account/logout'); signup(client,'other_fixture')
        assert not client.get('/api/prompt/status').json()['available']
        with pytest.raises(BusinessError):generation.reserve_token('prompt',digest(client.cookies[COOKIE]),request_body())


def test_unlimited_user_does_not_change_other_users_bounded_rules(settings):
    settings=replace(settings,env={'DECART_API_KEY':'fixture_long_term_key','YINGXIANG_PROMPT_ENABLED':'true','YINGXIANG_PROMPT_BUDGET_USD':'0.5','YINGXIANG_PROMPT_MAX_SESSIONS':'1','YINGXIANG_PROMPT_UNLIMITED_USERNAMES':'suny'})
    initialize(settings)
    with TestClient(create_app(settings),base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin; signup(client,'other_fixture')
        client.app.state.generation.reserve_token('prompt',digest(client.cookies[COOKIE]),request_body())
        assert not client.get('/api/prompt/status').json()['available']
