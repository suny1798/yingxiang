import hmac
import re
import secrets
from uuid import uuid4
from sqlalchemy import select, insert, update, delete, func
from sqlalchemy.exc import IntegrityError

from .core import BusinessError, DURATIONS, SESSION_MS, now_ms, iso, digest, password_hash, js_length
from .models import users, sessions, limits, grants, entries, attempts


def grant(session, user_id, seconds, total, source, source_key, environment="real_usage"):
    ident = str(uuid4())
    session.execute(insert(grants).values(id=ident, user_id=user_id, seconds=seconds, total=total, source=source, source_key=source_key, environment=environment))
    if total:
        session.execute(insert(entries).values(id=str(uuid4()), grant_id=ident, operation_key=f"grant:{source_key}", kind="grant", quantity=total, created_at=now_ms()))
    return ident


def one(session, table, condition):
    return session.execute(select(table).where(condition)).mappings().first()


class Accounts:
    def __init__(self, db):
        self.db = db

    def user(self, session, hashed, required=False):
        value = session.execute(select(users).join(sessions, users.c.id == sessions.c.user_id).where(sessions.c.hash == hashed, sessions.c.expires_at > now_ms())).mappings().first()
        if value is not None and value["disabled"]:
            value = None
        if value is None and required:
            raise BusinessError("LOGIN_REQUIRED", "请先登录后继续。", 401)
        return value

    def require(self, hashed):
        with self.db.transaction() as session:
            return self.user(session, hashed, True)["id"]

    def view(self, session, user):
        empty = {"user": None, "trial": None, "trialLimit": 0, "trialRemaining": 0, "durations": [{"seconds": s, "limit": 0, "remaining": 0} for s in DURATIONS], "history": []}
        if not user:
            return empty
        rows = session.execute(select(grants).where(grants.c.user_id == user["id"], grants.c.environment == "real_usage")).mappings().all()
        history = session.execute(select(attempts).where(attempts.c.user_id == user["id"], attempts.c.scene == "studio", attempts.c.account_state.is_not(None)).order_by(attempts.c.created_at, attempts.c.id)).mappings().all()
        durations = []
        for seconds in DURATIONS:
            items = [r for r in rows if r["seconds"] == seconds]
            total = sum(r["total"] - r["revoked"] for r in items)
            remaining = sum(r["total"] - r["reserved"] - r["used"] - r["revoked"] for r in items)
            durations.append({"seconds": seconds, "limit": total, "remaining": remaining})
        total, remaining = durations[0]["limit"], durations[0]["remaining"]
        return {"user": {"id": user["id"], "username": user["username"], "createdAt": iso(user["created_at"]), "role": user.get("role", "user")},
            "trial": "ready" if remaining > 0 else "review" if any(a["seconds"] == 15 and a["account_state"] == "review" for a in history) else "used",
            "trialLimit": total, "trialRemaining": remaining, "durations": durations,
            "history": [{"id": a["id"], "createdAt": iso(a["created_at"]), "durationSec": a["seconds"], "state": a["account_state"], **({"outcome": a["outcome"]} if a["outcome"] else {})} for a in list(reversed(history[-20:]))]}

    def me(self, hashed):
        with self.db.transaction() as session:
            return self.view(session, self.user(session, hashed))

    def rate_limit(self, session, key, maximum, duration):
        row = one(session, limits, limits.c.key == key)
        if row is None or row["until"] <= now_ms():
            session.execute(delete(limits).where(limits.c.key == key))
            session.execute(insert(limits).values(key=key, count=1, until=now_ms() + duration))
            return False
        session.execute(update(limits).where(limits.c.key == key).values(count=row["count"] + 1))
        return row["count"] + 1 > maximum

    def authenticate(self, body, register):
        from .schemas import AuthRequest
        from pydantic import ValidationError
        try:
            AuthRequest.model_validate(body)
        except ValidationError:
            raise BusinessError("INVALID_ACCOUNT", "账号需为3—24位字母、数字或下划线，密码需为8—128位。") from None
        username, password = body.get("username"), body.get("password")
        if set(body) != {"username", "password"} or not isinstance(username, str) or not re.fullmatch(r"[a-zA-Z0-9_]{3,24}", username) or not isinstance(password, str) or not 8 <= js_length(password) <= 128:
            raise BusinessError("INVALID_ACCOUNT", "账号需为3—24位字母、数字或下划线，密码需为8—128位。")
        username = username.lower()
        # 独立事务：密码错误和后续注册冲突不能回滚失败计数。
        with self.db.transaction(True) as session:
            denied = self.rate_limit(session, "auth:global", 60, 15 * 60_000)
            if not denied:
                denied = self.rate_limit(session, f"auth:{username}", 10, 15 * 60_000)
            if not denied and register:
                denied = self.rate_limit(session, "signup", 20, 60 * 60_000)
            user = one(session, users, users.c.username == username)
        if denied:
            raise BusinessError("RATE_LIMITED", "操作过于频繁，请稍后再试。", 429)
        if register and user:
            raise BusinessError("ACCOUNT_EXISTS", "这个账号已注册，请直接登录或换一个账号。", 409)
        salt = secrets.token_hex(16) if register else user["salt"] if user else "yingxiang-nonexistent-account"
        encoded = password_hash(password, salt)  # 不持有数据库事务/写锁。
        if not register and (not user or not hmac.compare_digest(encoded, user["password_hash"])):
            raise BusinessError("INVALID_CREDENTIALS", "账号或密码不正确。", 401)
        token = secrets.token_hex(32)
        try:
            with self.db.transaction(True) as session:
                if register:
                    user = {"id": str(uuid4()), "username": username, "salt": salt, "password_hash": encoded, "created_at": now_ms()}
                    session.execute(insert(users).values(**user))
                    grant(session, user["id"], 15, 1, "free", f"signup:{user['id']}")
                else:
                    user = one(session, users, users.c.id == user["id"])
                    if user["disabled"]:
                        raise BusinessError("ACCOUNT_DISABLED", "账号已暂停，请联系项目维护者。", 403)
                session.execute(insert(sessions).values(hash=digest(token), user_id=user["id"], expires_at=now_ms() + SESSION_MS))
                value = self.view(session, user)
        except IntegrityError:
            raise BusinessError("ACCOUNT_EXISTS", "这个账号已注册，请直接登录或换一个账号。", 409) from None
        return value, token

    def logout(self, hashed):
        with self.db.transaction(True) as session:
            session.execute(delete(sessions).where(sessions.c.hash == hashed))

    def reserve(self, session, hashed, ident, seconds):
        user = self.user(session, hashed, True)
        if one(session, attempts, attempts.c.id == ident):
            raise BusinessError("ATTEMPT_SPENT", "这次连接已申请，不能重复发送。请结束当前体验后手动再次开启。", 409)
        row = session.execute(select(grants).where(grants.c.user_id == user["id"], grants.c.seconds == seconds, grants.c.environment == "real_usage", grants.c.total > grants.c.reserved + grants.c.used + grants.c.revoked).order_by(grants.c.id)).mappings().first()
        if not row:
            raise BusinessError("TRIAL_USED" if seconds == 15 else "DURATION_UNAVAILABLE", "免费体验已使用或正在处理中，付费功能尚未开放。" if seconds == 15 else "当前账号没有此时长权益，在线购买尚未开放。", 409)
        session.execute(update(grants).where(grants.c.id == row["id"]).values(reserved=grants.c.reserved + 1))
        session.execute(insert(entries).values(id=str(uuid4()), grant_id=row["id"], operation_key=f"reserve:{ident}", kind="reserve", quantity=1, created_at=now_ms()))
        session.execute(insert(attempts).values(id=ident, user_id=user["id"], grant_id=row["id"], scene="studio", seconds=seconds, state="unknown", account_state="review", created_at=now_ms()))

    def issued(self, ident):
        with self.db.transaction(True) as session:
            row = one(session, attempts, attempts.c.id == ident)
            if row is None:
                raise RuntimeError("缺少签发预留")
            if row["account_state"] == "used":
                return
            session.execute(update(grants).where(grants.c.id == row["grant_id"]).values(reserved=grants.c.reserved - 1, used=grants.c.used + 1))
            session.execute(insert(entries).values(id=str(uuid4()), grant_id=row["grant_id"], operation_key=f"consume:{ident}", kind="consume", quantity=1, created_at=now_ms()))
            session.execute(update(attempts).where(attempts.c.id == ident).values(state="issued", account_state="used", updated_at=now_ms()))
