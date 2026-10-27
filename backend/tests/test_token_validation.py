from dataclasses import replace
from uuid import uuid4
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core import iso
from app.main import create_app
from app.generation import validate_client_token, TokenValidationError, PROMPT
from conftest import initialize, signup


def token(received_at):
    return {'apiKey':'fixture_temporary_token','expiresAt':iso(received_at+11000),'permissions':{'models':['lucy-2.5'],'origins':['http://127.0.0.1:8787']},'constraints':{'realtime':{'maxSessionDuration':15}}}


def test_expiry_uses_receipt_not_request_start():
    # 请求耗时5秒；签发响应到达时仍有效11秒。旧上界requestStart+15秒会误拦。
    started=1792941000000; received=started+5000
    value=token(received)
    validate_client_token(value,'lucy-2.5','http://127.0.0.1:8787',15,'fixture_permanent_key',received)


@pytest.mark.parametrize('field,code',[
    ('expired','TOKEN_EXPIRED'),('ttl','INVALID_TOKEN_TTL'),('date','INVALID_TOKEN_EXPIRY'),
    ('key','INVALID_TOKEN_KEY'),('model','TOKEN_MODEL_MISMATCH'),('origin','TOKEN_ORIGIN_MISMATCH'),
    ('duration','TOKEN_DURATION_MISMATCH'),('null_permissions','TOKEN_MODEL_MISMATCH'),('null_constraints','TOKEN_DURATION_MISMATCH'),
])
def test_invalid_fields_remain_rejected_with_specific_safe_codes(field,code):
    received=1792941005000; value=token(received)
    if field=='expired':value['expiresAt']=iso(received)
    if field=='ttl':value['expiresAt']=iso(received+15001)
    if field=='date':value['expiresAt']='invalid-private-response'
    if field=='key':value['apiKey']='fixture_permanent_key'
    if field=='model':value['permissions']['models']=['other']
    if field=='origin':value['permissions']['origins']=['https://other.invalid']
    if field=='duration':value['constraints']['realtime']['maxSessionDuration']=60
    if field=='null_permissions':value['permissions']=None
    if field=='null_constraints':value['constraints']=None
    with pytest.raises(TokenValidationError) as error:
        validate_client_token(value,'lucy-2.5','http://127.0.0.1:8787',15,'fixture_permanent_key',received)
    assert error.value.code==code
    assert 'private' not in str(error.value)


def test_delayed_valid_provider_token_passes_business_endpoint(settings,monkeypatch):
    settings=replace(settings,env={'DECART_API_KEY':'fixture_permanent_key','YINGXIANG_PROMPT_ENABLED':'true','YINGXIANG_PROMPT_UNLIMITED_USERNAMES':'fixture_user'})
    initialize(settings); clock=[1792941000000]; calls=[]
    monkeypatch.setattr('app.generation.now_ms',lambda:clock[0])
    def upstream(request):
        calls.append(json.loads(request.content)); clock[0]+=5000
        return httpx.Response(200,json=token(clock[0]))
    with TestClient(create_app(settings,transport=httpx.MockTransport(upstream)),base_url=settings.public_origin) as client:
        client.headers['origin']=settings.public_origin; signup(client)
        access=client.get('/api/prompt/status').json()['access']
        response=client.post('/api/prompt/token',json={'attemptId':str(uuid4()),'consentVersion':PROMPT['consentVersion'],'durationSec':15},headers={'x-studio-access':access})
        assert response.status_code==200,response.text
        assert response.json()['apiKey']=='fixture_temporary_token'
        assert len(calls)==1 and calls[0]['expiresIn']==10
