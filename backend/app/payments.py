import hashlib
import json
import re
from urllib.parse import urlsplit
from uuid import uuid4

import stripe
from sqlalchemy import select, insert, update

from .accounts import one, grant
from .core import BusinessError, UUID, iso, now_ms
from .models import orders, events, grants

API_VERSION = "2026-09-30.endive"
PRICES = {15: {1: 690, 5: 2990, 10: 5690}, 30: {1: 1290, 5: 5690, 10: 10900}, 60: {1: 2390, 5: 10900, 10: 20900}}


def product(sku):
    for sec, counts in PRICES.items():
        for count, amount in counts.items():
            if sku == f"tryon-v1-{sec}-{count}":
                return {"sku": sku, "seconds": sec, "count": count, "amount": amount, "currency": "cny"}
    raise BusinessError("INVALID_SKU", "请选择有效体验包。")


def checkout_params(order, origin):
    suffix = "".join(chr(97 + byte % 26) for byte in hashlib.sha256(order["id"].encode()).digest()[:8])
    return {"mode": "payment", "client_reference_id": order["id"],
        "metadata": {"orderId": order["id"], "userId": order["user_id"], "sku": order["sku"]},
        "line_items": [{"quantity": 1, "price_data": {"currency": order["currency"], "unit_amount": order["amount"], "product_data": {"name": f"映想实时换装 · {order['seconds']}秒 × {order['count']}次（沙盒）"}}}],
        "success_url": f"{origin}/account?payment=returned", "cancel_url": f"{origin}/account?payment=cancelled",
        "adaptive_pricing": {"enabled": False}, "integration_identifier": f"yingxiang_test_{suffix}"}


def safe_url(value):
    return isinstance(value, str) and urlsplit(value).scheme == "https" and urlsplit(value).netloc == "checkout.stripe.com"


def stripe_data(value):
    return value.to_dict() if isinstance(value, stripe.StripeObject) else value


class Payments:
    def __init__(self, db, accounts, settings, client=None):
        self.db, self.accounts, self.settings, self._client = db, accounts, settings, client

    def enabled(self):
        e = self.settings.env
        return e.get("YINGXIANG_PAYMENTS_TEST_ENABLED") == "true" and bool(re.match(r"^(rk|sk)_test_", e.get("STRIPE_SECRET_KEY", ""))) and e.get("STRIPE_WEBHOOK_SECRET", "").startswith("whsec_") and e.get("STRIPE_EXPECTED_ACCOUNT_ID", "").startswith("acct_")

    def client(self):
        if not self.enabled():
            raise BusinessError("PAYMENTS_DISABLED", "沙盒支付尚未配置，正式购买暂未开放。", 503)
        if self._client is None:
            self._client = stripe.StripeClient(self.settings.env["STRIPE_SECRET_KEY"], stripe_version=API_VERSION, max_network_retries=1, http_client=stripe.HTTPXClient(timeout=15, allow_sync_methods=True))
        return self._client

    def list(self, hashed):
        with self.db.transaction() as session:
            user = self.accounts.user(session, hashed, True)
            rows = session.execute(select(orders).where(orders.c.user_id == user["id"]).order_by(orders.c.created_at.desc(), orders.c.id.desc()).limit(50)).mappings().all()
            credits = {}
            for row in session.execute(select(grants).where(grants.c.user_id == user["id"], grants.c.environment == "stripe_sandbox")).mappings():
                key = str(row["seconds"])
                credits[key] = credits.get(key, 0) + row["total"] - row["reserved"] - row["used"] - row["revoked"]
            return {"orders": [{"id": r["id"], "sku": r["sku"], "seconds": r["seconds"], "count": r["count"], "amount": r["amount"], "currency": r["currency"], "createdAt": iso(r["created_at"]), "state": r["state"], **({"fulfilledAt": iso(r["fulfilled_at"])} if r["fulfilled_at"] is not None else {})} for r in rows], "sandboxCredits": credits}

    def reserve(self, hashed, sku, request_id, origin):
        if not isinstance(request_id, str) or not UUID.fullmatch(request_id):
            raise BusinessError("INVALID_REQUEST", "支付操作编号无效。")
        item = product(sku)
        denied = False
        with self.db.transaction(True) as session:
            user = self.accounts.user(session, hashed, True)
            previous = one(session, orders, (orders.c.user_id == user["id"]) & (orders.c.request_id == request_id))
            if previous:
                if previous["sku"] != sku:
                    raise BusinessError("PAYMENT_CONFLICT", "同一操作不能更改方案。", 409)
                return dict(previous)
            unknown = one(session, orders, (orders.c.user_id == user["id"]) & (orders.c.sku == sku) & (orders.c.state == "creating") & orders.c.session_id.is_(None))
            if unknown:
                return dict(unknown)
            denied = self.accounts.rate_limit(session, f"checkout:{user['id']}", 10, 60 * 60_000)
            if not denied:
                order = {"id": str(uuid4()), "user_id": user["id"], "request_id": request_id, **item, "created_at": now_ms(), "state": "creating"}
                order["request_snapshot"] = json.dumps(checkout_params(order, origin), ensure_ascii=False, separators=(",", ":"))
                session.execute(insert(orders).values(**order))
                return order
        raise BusinessError("RATE_LIMITED", "操作过于频繁，请稍后再试。", 429)

    def own(self, hashed, ident):
        with self.db.transaction() as session:
            user = self.accounts.user(session, hashed, True)
            value = one(session, orders, (orders.c.id == ident) & (orders.c.user_id == user["id"]))
            if value is None:
                raise BusinessError("ORDER_NOT_FOUND", "找不到此订单。", 404)
            return dict(value)

    def apply(self, value, event_id=None, failed=False):
        value = stripe_data(value)
        metadata = value.get("metadata") or {}
        with self.db.transaction(True) as session:
            order = one(session, orders, orders.c.id == metadata.get("orderId"))
            ident = value.get("id")
            if (not order or not isinstance(ident, str) or not ident or value.get("livemode") is not False or value.get("mode") != "payment" or value.get("client_reference_id") != order["id"] or metadata.get("userId") != order["user_id"] or metadata.get("sku") != order["sku"] or value.get("currency") != order["currency"] or type(value.get("amount_total")) is not int or value.get("amount_total") != order["amount"] or (order["session_id"] and order["session_id"] != ident) or one(session, orders, (orders.c.id != order["id"]) & (orders.c.session_id == ident))):
                raise BusinessError("PAYMENT_MISMATCH", "付款资料不匹配，需要人工核查。", 409)
            if event_id and one(session, events, events.c.id == event_id):
                return
            changes = {"session_id": ident, "expires_at": value.get("expires_at")}
            if safe_url(value.get("url")):
                changes["checkout_url"] = value["url"]
            if value.get("status") == "complete" and value.get("payment_status") == "paid":
                if order["fulfilled_at"] is None:
                    grant(session, order["user_id"], order["seconds"], order["count"], "paid", f"order:{order['id']}", "stripe_sandbox")
                    changes["fulfilled_at"] = now_ms()
                changes["state"] = "paid"
            elif order["fulfilled_at"] is None:
                changes["state"] = "expired" if value.get("status") == "expired" else "failed" if failed or order["state"] == "failed" else "pending"
            session.execute(update(orders).where(orders.c.id == order["id"]).values(**changes))
            if event_id:
                session.execute(insert(events).values(id=event_id, order_id=order["id"], source="stripe_sandbox", created_at=now_ms()))

    def checkout(self, hashed, body, origin):
        client = self.client()
        if set(body) != {"requestId", "sku"}:
            raise BusinessError("INVALID_REQUEST", "支付参数无效。")
        order = self.reserve(hashed, body["sku"], body["requestId"], origin)
        if client.v1.accounts.retrieve_current().id != self.settings.env.get("STRIPE_EXPECTED_ACCOUNT_ID"):
            raise BusinessError("WRONG_ACCOUNT", "支付密钥不属于配置的映想沙盒。", 503)
        if order["state"] == "paid":
            return {"orderId": order["id"], "paid": True}
        if order.get("session_id"):
            value = stripe_data(client.v1.checkout.sessions.retrieve(order["session_id"]))
            self.apply(value)
            if value.get("status") == "open" and safe_url(value.get("url")):
                return {"orderId": order["id"], "url": value["url"]}
            return {"orderId": order["id"], "paid": value.get("payment_status") == "paid"}
        if now_ms() - order["created_at"] > 23 * 60 * 60_000:
            raise BusinessError("ORDER_REVIEW", "此订单需要人工核查，请勿重新付款。", 409)
        params = checkout_params(order, origin)
        if order.get("request_snapshot"):
            if json.loads(order["request_snapshot"]) != params:
                raise BusinessError("ORDER_REVIEW", "此订单需要人工核查，请勿重新付款。", 409)
            params = json.loads(order["request_snapshot"])
        value = stripe_data(client.v1.checkout.sessions.create(params=params, options={"idempotency_key": f"yingxiang-test-{order['id']}"}))
        self.apply(value)
        if not safe_url(value.get("url")):
            raise BusinessError("CHECKOUT_UNAVAILABLE", "支付链接尚未准备好，请到订单中核查。", 503)
        return {"orderId": order["id"], "url": value["url"]}

    def reconcile(self, hashed, body, origin):
        client = self.client()
        if set(body) != {"orderId"} or not isinstance(body["orderId"], str):
            raise BusinessError("INVALID_REQUEST", "订单编号无效。")
        order = self.own(hashed, body["orderId"])
        if not order.get("session_id"):
            result = self.checkout(hashed, {"sku": order["sku"], "requestId": order["request_id"]}, origin)
            return {**self.list(hashed), **({"url": result["url"]} if "url" in result else {})}
        value = stripe_data(client.v1.checkout.sessions.retrieve(order["session_id"]))
        self.apply(value)
        return {**self.list(hashed), **({"url": value.get("url")} if value.get("status") == "open" else {})}

    def webhook(self, payload, signature):
        client = self.client()
        try:
            value = stripe_data(client.construct_event(payload, signature, self.settings.env["STRIPE_WEBHOOK_SECRET"]))
        except Exception:
            raise BusinessError("INVALID_SIGNATURE", "付款通知验签失败。") from None
        if value.get("livemode") or value.get("account"):
            raise BusinessError("WRONG_ACCOUNT_MODE", "只接受当前沙盒的直接付款通知。")
        if value["type"] in ("checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"):
            current = client.v1.checkout.sessions.retrieve(value["data"]["object"]["id"])
            self.apply(current, value["id"], value["type"] == "checkout.session.async_payment_failed")
        return {"received": True}
