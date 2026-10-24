"""仅用于隔离联调：所有供应商请求都交给进程内替身。"""
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
import json

import httpx
import stripe
from sqlalchemy import select

from app.core import ROOT, Settings, now_ms, iso
from app.main import create_app
from app.models import orders
from scripts.ops import initialize


def create():
    settings = Settings(data_dir=ROOT / "data/integration", maintenance=False,
        public_origin="http://127.0.0.1:8789", allowed_origins=("http://127.0.0.1:8787", "http://localhost:8787", "http://127.0.0.1:8789"),
        env={"DECART_API_KEY": "fixture_key", "YINGXIANG_STUDIO_ENABLED": "true", "YINGXIANG_PROMPT_ENABLED": "true", "YINGXIANG_PROMPT_BUDGET_USD": "0.5", "YINGXIANG_PROMPT_MAX_SESSIONS": "1", "YINGXIANG_VIDEO_ENABLED": "true", "YINGXIANG_VIDEO_BUDGET_USD": "1", "YINGXIANG_VIDEO_MAX_JOBS": "2", "YINGXIANG_PAYMENTS_TEST_ENABLED": "true", "STRIPE_SECRET_KEY": "sk_test_fixture", "STRIPE_WEBHOOK_SECRET": "whsec_integration_fixture", "STRIPE_EXPECTED_ACCOUNT_ID": "acct_fixture"})
    initialize(settings)
    def upstream(request):
        if request.url.path.endswith("/client/tokens"):
            params = json.loads(request.content)
            return httpx.Response(200, json={"apiKey": "fixture_temporary_key", "expiresAt": iso(now_ms() + 9000), "permissions": {"models": params["allowedModels"], "origins": params["allowedOrigins"]}, "constraints": params["constraints"]})
        if request.url.path.endswith("/content"):
            return httpx.Response(200, content=(ROOT.parent / "frontend/public/assets/try-on-demo.mp4").read_bytes(), headers={"content-type": "video/mp4"})
        return httpx.Response(200, json={"job_id": "integration_fixture_job", "status": "completed"})
    sdk = stripe.StripeClient("sk_test_fixture")
    sdk.v1.accounts.retrieve_current = lambda: SimpleNamespace(id="acct_fixture")
    app = create_app(settings, transport=httpx.MockTransport(upstream), stripe_client=sdk)
    @app.middleware("http")
    async def inspect_proxy(request, call_next):
        if request.url.path.startswith("/api/"):
            app.state.proxy_headers = {key: request.headers.get(key) for key in ("host", "origin", "x-forwarded-host")}
        return await call_next(request)
    @app.get("/internal/test-headers", include_in_schema=False)
    async def test_headers():
        return getattr(app.state, "proxy_headers", {})
    def session_value(row, paid=False):
        return {"id": "cs_test_" + row["id"], "mode": "payment", "livemode": False, "client_reference_id": row["id"], "metadata": {"orderId": row["id"], "userId": row["user_id"], "sku": row["sku"]}, "currency": row["currency"], "amount_total": row["amount"], "status": "complete" if paid else "open", "payment_status": "paid" if paid else "unpaid", "url": "https://checkout.stripe.com/c/pay/fixture", "expires_at": (now_ms() // 1000) + 1800}
    def create_session(params, options):
        with app.state.db.transaction() as session:
            row = session.execute(select(orders).where(orders.c.id == params["client_reference_id"])).mappings().one()
            return session_value(row)
    def retrieve_session(ident):
        with app.state.db.transaction() as session:
            row = session.execute(select(orders).where(orders.c.session_id == ident)).mappings().one()
            return session_value(row, True)
    sdk.v1.checkout.sessions.create = create_session
    sdk.v1.checkout.sessions.retrieve = retrieve_session
    return app
