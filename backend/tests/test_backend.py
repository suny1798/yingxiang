from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from uuid import uuid4
import hashlib
import hmac
import json
import sqlite3
import time

import httpx
import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import insert, select, update, text

from app.core import password_hash, js_length, digest, BusinessError, now_ms, iso
from app.db import Database
from app.main import create_app
from app.models import grants, attempts, sessions, orders, entries, reservations, users
from app.payments import checkout_params
from conftest import initialize, signup

FIXTURE = json.loads((Path(__file__).resolve().parents[1] / "contracts/node-fixtures.json").read_text(encoding="utf-8"))


def test_node_credential_fixture():
    for value in FIXTURE["passwords"]:
        assert js_length(value["password"]) == value["jsLength"]
        assert password_hash(value["password"], value["salt"]) == value["hash"]
    assert digest(FIXTURE["session"]["token"]) == FIXTURE["session"]["hash"]


def test_http_account_lifecycle_and_origin(client):
    assert client.get("/api/account/me").json()["user"] is None
    user_id = signup(client)
    cookie = client.cookies.get("yingxiang_session")
    view = client.get("/api/account/me").json()
    assert view["user"]["id"] == user_id
    assert view["trialRemaining"] == 1
    assert [v["remaining"] for v in view["durations"]] == [1, 0, 0]
    assert client.post("/api/account/logout", headers={"origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/account/logout").status_code == 200
    assert client.get("/api/account/me", headers={"cookie": f"yingxiang_session={cookie}"}).json()["user"] is None
    response = client.post("/api/account/login", json={"username": "FIXTURE_USER", "password": "test-password-only"})
    assert response.status_code == 200
    for part in ("HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=604800"):
        assert part in response.headers["set-cookie"]


def test_auth_validation_and_persistent_failures(client, app):
    signup(client)
    assert client.post("/api/account/login", json={"username": "fixture_user", "password": "test-password-only", "other": 1}).status_code == 400
    for _ in range(9):
        assert client.post("/api/account/login", json={"username": "fixture_user", "password": "wrong-password"}).status_code == 401
    assert client.post("/api/account/login", json={"username": "fixture_user", "password": "test-password-only"}).status_code == 429
    assert client.post("/api/account/login", content="{}", headers={"content-type": "text/plain"}).status_code == 415
    assert client.post("/api/account/login", content="x" * 4097, headers={"content-type": "application/json"}).status_code == 413
    assert client.post("/api/account/login", content='{"username":"sensitive", "password":NaN}', headers={"content-type": "application/json"}).json()["error"]["code"] == "INVALID_REQUEST"


def test_db_explicit_transaction_savepoint_rollback_and_missing(settings):
    initialize(settings)
    db = Database(settings.database)
    assert db.readiness()
    with pytest.raises(RuntimeError):
        with db.transaction(True) as session:
            session.execute(insert(users).values(id="rollback", username="rollback", salt="test", password_hash="test", created_at=0))
            with session.begin_nested():
                session.execute(insert(users).values(id="nested", username="nested", salt="test", password_hash="test", created_at=0))
            raise RuntimeError()
    with db.transaction() as session:
        assert session.execute(select(users)).first() is None
        assert session.execute(text("PRAGMA synchronous")).scalar_one() == 2
    db.close()
    missing = Database(settings.database.parent / "missing.sqlite3")
    with pytest.raises(Exception):
        missing.readiness()
    assert not missing.path.exists()


def test_parallel_last_trial_only_one_and_sandbox_cannot_spend(client, app):
    user_id = signup(client)
    hashed = digest(client.cookies.get("yingxiang_session"))
    account = app.state.accounts
    def reserve(_):
        try:
            with app.state.db.transaction(True) as session:
                account.reserve(session, hashed, str(uuid4()), 15)
            return "reserved"
        except BusinessError as error:
            return error.code
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(reserve, range(2))) == ["TRIAL_USED", "reserved"]
    assert client.get("/api/account/me").json()["trial"] == "review"
    with app.state.db.transaction() as session:
        ident = session.execute(select(attempts.c.id)).scalar_one()
    account.issued(ident)
    account.issued(ident)
    with app.state.db.transaction() as session:
        balance = session.execute(select(grants)).mappings().one()
        assert (balance["total"], balance["reserved"], balance["used"]) == (1, 0, 1)
        assert len(session.execute(select(entries)).all()) == 3


def test_sql_constraints_and_lock_timeout(client, app):
    user_id = signup(client)
    with pytest.raises(Exception):
        with app.state.db.transaction(True) as session:
            session.execute(update(grants).where(grants.c.user_id == user_id).values(used=2))
    # 第二连接最多等待 busy_timeout；HTTP 输出受控，不能泄漏路径/SQL。
    with app.state.db.transaction(True):
        response = client.post("/api/account/logout")
    assert response.status_code == 503
    assert "sqlite" not in response.text
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


def test_public_contracts_methods_and_disabled_states(client):
    assert client.get("/api/v1/config").json() == FIXTURE["publicConfig"]
    assert client.get("/api/v1/health").json()["storageReady"] is False
    assert client.get("/internal/ready").status_code == 200
    assert client.get("/api/account/me/", follow_redirects=False).status_code == 404
    assert client.put("/api/account/me").status_code == 405
    assert client.head("/api/account/me").status_code == 200
    assert client.head("/api/studio/token").status_code == 405
    response = client.options("/api/account/login")
    assert response.status_code == 204
    assert response.headers["allow"] == "GET, HEAD, OPTIONS, POST"
    response = client.options("/api/studio/token")
    assert response.status_code == 204 and response.headers["allow"] == "OPTIONS, POST"
    assert client.post("/api/v1/sessions").status_code == 503
    assert client.get("/api/account/unknown").json() == {"error": {"code": "NOT_FOUND", "message": "接口不存在。"}}
    assert client.get("/api/payments/status").json() == {"testEnabled": False, "liveEnabled": False}
    assert client.post("/api/payments/checkout", json={}).json()["error"]["code"] == "PAYMENTS_DISABLED"
    assert client.post("/api/studio/token", json={}).status_code == 401
    assert client.get("/api/prompt/status").json()["available"] is False
    assert client.get("/api/video/jobs").json()["jobs"] == []
    response = client.get("/api/account/me", headers={"host": "evil.example", "x-forwarded-host": "127.0.0.1:8787"})
    assert response.status_code == 403
    response = client.get("/api/account/me", headers={"sec-fetch-site": "cross-site"})
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_maintenance_rejects_webhook_and_writes(settings):
    initialize(settings)
    with TestClient(create_app(replace(settings, maintenance=True)), base_url=settings.public_origin) as client:
        assert client.post("/api/payments/webhook").status_code == 503
        assert client.post("/api/account/login").json()["error"]["code"] == "MAINTENANCE"
        assert client.get("/internal/ready").status_code == 200


def test_paid_replay_atomic_sandbox_isolation_and_mismatch(client, app):
    user_id = signup(client)
    hashed = digest(client.cookies.get("yingxiang_session"))
    pay = app.state.payments
    order = pay.reserve(hashed, "tryon-v1-60-10", str(uuid4()), app.state.settings.public_origin)
    value = {"id": "cs_test_fixture", "livemode": False, "mode": "payment", "client_reference_id": order["id"], "metadata": {"orderId": order["id"], "userId": user_id, "sku": order["sku"]}, "currency": "cny", "amount_total": order["amount"], "status": "complete", "payment_status": "paid", "expires_at": 123, "url": "https://checkout.stripe.com/c/pay/fixture"}
    for change in ({"amount_total": 1}, {"livemode": True}, {"mode": "subscription"}, {"currency": "usd"}, {"client_reference_id": "other"}):
        with pytest.raises(BusinessError, match="付款资料不匹配"):
            pay.apply({**value, **change}, "evt_bad")
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _: pay.apply(value, "evt_repeat"), range(2)))
    pay.apply(value, "evt_other")
    pay.apply({**value, "status": "expired", "payment_status": "unpaid"}, "evt_late")
    assert pay.list(hashed)["sandboxCredits"] == {"60": 10}
    assert pay.list(hashed)["orders"][0]["state"] == "paid"
    assert app.state.accounts.me(hashed)["durations"][2]["remaining"] == 0
    assert pay.reserve(hashed, order["sku"], order["request_id"], app.state.settings.public_origin)["id"] == order["id"]


def test_paid_transaction_failure_does_not_mark_event_or_fulfilled(client, app):
    from app.models import events
    user_id = signup(client)
    hashed = digest(client.cookies.get("yingxiang_session"))
    pay = app.state.payments
    order = pay.reserve(hashed, "tryon-v1-15-1", str(uuid4()), app.state.settings.public_origin)
    value = {"id": "cs_test_atomic", "livemode": False, "mode": "payment", "client_reference_id": order["id"], "metadata": {"orderId": order["id"], "userId": user_id, "sku": order["sku"]}, "currency": "cny", "amount_total": order["amount"], "status": "complete", "payment_status": "paid"}
    with app.state.db.transaction(True) as session:
        session.execute(text("CREATE TRIGGER synthetic_disk_failure BEFORE INSERT ON entitlement_entries WHEN NEW.kind='grant' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END"))
    with pytest.raises(Exception):
        pay.apply(value, "evt_atomic")
    assert pay.list(hashed)["sandboxCredits"] == {}
    assert pay.own(hashed, order["id"])["fulfilled_at"] is None
    with app.state.db.transaction(True) as session:
        assert session.execute(select(events)).first() is None
        session.execute(text("DROP TRIGGER synthetic_disk_failure"))
    pay.apply(value, "evt_atomic")
    assert pay.list(hashed)["sandboxCredits"] == {"15": 1}


def test_stripe_real_sdk_signature_and_query_current_state(settings):
    from types import SimpleNamespace
    env = {"YINGXIANG_PAYMENTS_TEST_ENABLED": "true", "STRIPE_SECRET_KEY": "sk_test_fixture", "STRIPE_WEBHOOK_SECRET": "whsec_fixture", "STRIPE_EXPECTED_ACCOUNT_ID": "acct_fixture"}
    settings = replace(settings, env=env)
    initialize(settings)
    app = create_app(settings)
    pay = app.state.payments
    client = stripe.StripeClient("sk_test_fixture")
    with TestClient(app, base_url=settings.public_origin) as browser:
        browser.headers["origin"] = settings.public_origin
        user_id = signup(browser)
        hashed = digest(browser.cookies.get("yingxiang_session"))
        order = pay.reserve(hashed, "tryon-v1-15-5", str(uuid4()), settings.public_origin)
        current = {"id": "cs_test_fixture", "livemode": False, "mode": "payment", "client_reference_id": order["id"], "metadata": {"orderId": order["id"], "userId": user_id, "sku": order["sku"]}, "currency": "cny", "amount_total": order["amount"], "status": "complete", "payment_status": "paid"}
        # 官方 SDK 负责验签，仅查单替换为本地固定响应。
        client.v1.checkout.sessions.retrieve = lambda _: current
        pay._client = client
        payload = json.dumps({"id": "evt_signature", "object": "event", "type": "checkout.session.completed", "livemode": False, "data": {"object": {"id": "cs_test_fixture"}}}).encode()
        timestamp = str(int(time.time()))
        signature = hmac.new(b"whsec_fixture", timestamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
        headers = {"stripe-signature": f"t={timestamp},v1={signature}"}
        assert browser.post("/api/payments/webhook", content=payload + b" ", headers=headers).status_code == 400
        pay.webhook(payload, headers["stripe-signature"])
        assert browser.post("/api/payments/webhook", content=payload, headers=headers).status_code == 200
        assert browser.post("/api/payments/webhook", content=payload, headers=headers).status_code == 200
        assert pay.list(hashed)["sandboxCredits"] == {"15": 5}


@pytest.mark.parametrize("scene", ["studio", "prompt"])
def test_token_constraints_unknown_and_no_retry(settings, scene):
    calls = []
    def upstream(request):
        calls.append(json.loads(request.content))
        raise httpx.ReadTimeout("合成超时")
    env = {"DECART_API_KEY": "fixture_long_term_key", "YINGXIANG_STUDIO_ENABLED": "true", "YINGXIANG_PROMPT_ENABLED": "true", "YINGXIANG_PROMPT_BUDGET_USD": "0.5", "YINGXIANG_PROMPT_MAX_SESSIONS": "1"}
    settings = replace(settings, env=env)
    initialize(settings)
    app = create_app(settings, transport=httpx.MockTransport(upstream))
    with TestClient(app, base_url=settings.public_origin) as client:
        client.headers["origin"] = settings.public_origin
        signup(client)
        status = client.get(f"/api/{scene}/status").json()
        ident = str(uuid4())
        body = {"attemptId": ident, "consentVersion": FIXTURE[scene]["consentVersion"], "durationSec": 15}
        response = client.post(f"/api/{scene}/token", json=body, headers={"x-studio-access": status["access"]})
        assert response.status_code == 503, response.text
        assert len(calls) == 1
        assert calls[0]["constraints"] == {"realtime": {"maxSessionDuration": 15}}
        assert calls[0]["allowedModels"] == [FIXTURE[scene]["model"]]
        assert client.post(f"/api/{scene}/token", json=body, headers={"x-studio-access": status["access"]}).status_code == 409
        assert len(calls) == 1
        if scene == "studio":
            assert client.get("/api/account/me").json()["trial"] == "review"
        else:
            assert not client.get("/api/prompt/status").json()["available"]


def test_token_issued_observation_does_not_refund(settings):
    def upstream(request):
        body = json.loads(request.content)
        return httpx.Response(200, json={"apiKey": "fixture_temporary_token", "expiresAt": iso(now_ms() + 9000), "permissions": {"models": body["allowedModels"], "origins": body["allowedOrigins"]}, "constraints": body["constraints"]})
    settings = replace(settings, env={"DECART_API_KEY": "fixture_long_term_key", "YINGXIANG_STUDIO_ENABLED": "true"})
    initialize(settings)
    app = create_app(settings, transport=httpx.MockTransport(upstream))
    with TestClient(app, base_url=settings.public_origin) as client:
        client.headers["origin"] = settings.public_origin
        signup(client)
        status = client.get("/api/studio/status").json()
        ident = str(uuid4())
        headers = {"x-studio-access": status["access"]}
        response = client.post("/api/studio/token", json={"attemptId": ident, "consentVersion": FIXTURE["studio"]["consentVersion"]}, headers=headers)
        assert response.status_code == 200, response.text
        body = {"attemptId": ident, "firstFrameMs": None, "providerReportedSeconds": None, "outcome": "error", "localTracksEnded": True}
        assert client.post("/api/studio/observation", json=body, headers=headers).status_code == 200
        assert client.post("/api/studio/observation", json={**body, "outcome": "ended"}, headers=headers).status_code == 200
        account = client.get("/api/account/me").json()
        assert account["trialRemaining"] == 0
        assert account["history"][0]["state"] == "used"
        assert account["history"][0]["outcome"] == "error"


@pytest.mark.parametrize("scene", ["studio", "prompt"])
@pytest.mark.parametrize("fault", ["model", "origin", "duration", "ttl", "permanent", "oversized"])
def test_wrong_provider_permissions_never_return_token(settings, scene, fault):
    def upstream(request):
        body = json.loads(request.content)
        value = {"apiKey": "fixture_temporary_token", "expiresAt": iso(now_ms() + 9000), "permissions": {"models": body["allowedModels"], "origins": body["allowedOrigins"]}, "constraints": body["constraints"]}
        if fault == "model": value["permissions"]["models"] = ["other-model"]
        if fault == "origin": value["permissions"]["origins"] = ["https://evil.example"]
        if fault == "duration": value["constraints"]["realtime"]["maxSessionDuration"] = 60
        if fault == "ttl": value["expiresAt"] = iso(now_ms() + 90_000)
        if fault == "permanent": value["apiKey"] = "fixture_long_term_key"
        if fault == "oversized": value["padding"] = "x" * 16385
        return httpx.Response(200, json=value)
    settings = replace(settings, env={"DECART_API_KEY": "fixture_long_term_key", "YINGXIANG_STUDIO_ENABLED": "true", "YINGXIANG_PROMPT_ENABLED": "true", "YINGXIANG_PROMPT_BUDGET_USD": "0.5", "YINGXIANG_PROMPT_MAX_SESSIONS": "1"})
    initialize(settings)
    app = create_app(settings, transport=httpx.MockTransport(upstream))
    with TestClient(app, base_url=settings.public_origin) as client:
        client.headers["origin"] = settings.public_origin
        signup(client)
        status = client.get(f"/api/{scene}/status").json()
        response = client.post(f"/api/{scene}/token", json={"attemptId": str(uuid4()), "consentVersion": FIXTURE[scene]["consentVersion"], "durationSec": 15}, headers={"x-studio-access": status["access"]})
        assert response.status_code == 503
        assert "apiKey" not in response.text and "fixture_long_term_key" not in response.text


@pytest.mark.parametrize("seconds", [30, 60])
def test_duration_grant_does_not_spend_free_trial(settings, seconds):
    from app.accounts import grant
    def upstream(request):
        body = json.loads(request.content)
        assert body["constraints"]["realtime"]["maxSessionDuration"] == seconds
        return httpx.Response(200, json={"apiKey": "fixture_temporary_token", "expiresAt": iso(now_ms() + 9000), "permissions": {"models": body["allowedModels"], "origins": body["allowedOrigins"]}, "constraints": body["constraints"]})
    settings = replace(settings, env={"DECART_API_KEY": "fixture_long_term_key", "YINGXIANG_STUDIO_ENABLED": "true"})
    initialize(settings)
    app = create_app(settings, transport=httpx.MockTransport(upstream))
    with TestClient(app, base_url=settings.public_origin) as client:
        client.headers["origin"] = settings.public_origin
        uid = signup(client)
        status = client.get("/api/studio/status").json()
        body = {"attemptId": str(uuid4()), "consentVersion": FIXTURE["studio"]["consentVersion"], "durationSec": seconds}
        headers = {"x-studio-access": status["access"]}
        assert client.post("/api/studio/token", json=body, headers=headers).status_code == 409
        with app.state.db.transaction(True) as session:
            grant(session, uid, seconds, 1, "manual", "fixture-duration")
        response = client.post("/api/studio/token", json=body, headers=headers)
        assert response.status_code == 200
        assert response.json()["durationSec"] == seconds
        account = client.get("/api/account/me").json()
        assert account["trialRemaining"] == 1
        assert next(d for d in account["durations"] if d["seconds"] == seconds)["remaining"] == 0
