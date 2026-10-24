"""只读旧快照，显式验证并一次事务导入。失败不调整余额、不跳过坏记录。"""
from collections import Counter
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import hashlib
import json
import re

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from sqlalchemy import insert, select, func

from .accounts import grant
from .core import DURATIONS, HEX64, UUID, now_ms, millis, iso
from .models import users, sessions, limits, grants, entries, attempts, orders, events, campaigns, reservations, jobs, imports, access
from .payments import product, checkout_params


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class User(StrictModel):
    id: StrictStr
    username: StrictStr
    salt: StrictStr
    passwordHash: StrictStr
    createdAt: StrictStr


class LoginSession(StrictModel):
    hash: StrictStr
    userId: StrictStr
    expiresAt: StrictInt


class Attempt(StrictModel):
    id: StrictStr
    userId: StrictStr
    createdAt: StrictStr
    durationSec: StrictInt = 15
    state: StrictStr
    outcome: StrictStr | None = None


class Limit(StrictModel):
    count: StrictInt
    until: StrictInt


class Order(StrictModel):
    id: StrictStr
    userId: StrictStr
    requestId: StrictStr
    sku: StrictStr
    seconds: StrictInt
    count: StrictInt
    amount: StrictInt
    currency: StrictStr
    createdAt: StrictStr
    state: StrictStr
    sessionId: StrictStr | None = None
    checkoutUrl: StrictStr | None = None
    expiresAt: StrictInt | None = None
    fulfilledAt: StrictStr | None = None


class AccountData(StrictModel):
    version: StrictInt
    users: list[User]
    sessions: list[LoginSession]
    attempts: list[Attempt]
    limits: dict[str, Limit]
    quotas: dict[str, StrictInt] = Field(default_factory=dict)
    durationQuotas: dict[str, dict[str, StrictInt]] = Field(default_factory=dict)
    paymentOrders: list[Order] = Field(default_factory=list)
    paymentEvents: list[StrictStr] = Field(default_factory=list)
    sandboxGrants: dict[str, dict[str, StrictInt]] = Field(default_factory=dict)


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("重复源键")
        result[key] = value
    return result


def read_json(path):
    if not path.is_file() or path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("源文件缺失或过大")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("非法数字")))


def check(condition, category):
    if not condition:
        raise ValueError(category)


def quota(data, user_id, seconds):
    value = data.quotas.get(user_id) if seconds == 15 else data.durationQuotas.get(user_id, {}).get(str(seconds))
    return min(value, 1000) if type(value) is int and value > 0 else 1 if seconds == 15 else 0


def micro_usd(value):
    number = Decimal(str(value)) * 1_000_000
    check(number.is_finite() and number == number.to_integral() and number > 0, "预算单位不兼容")
    return int(number)


def source_manifest(root):
    root = Path(root).resolve()
    check(not list(root.glob("**/*.lock")), "快照含有未处理的锁")
    # 只认这四个仓储；旧 PoC 完整保存在快照归档，不转换为可消费额度。
    paths = [root / "accounts/store.json", root / "prompt/limits.json", root / "video-jobs/jobs.json"]
    paths += sorted((root / "studio").glob("*.json"))
    paths += [p for scene in ("studio", "prompt") if (p := root / scene / "access").exists()]
    manifest = {}
    for path in paths:
        check(path.is_file() and not path.is_symlink(), "源文件缺失或链接不受支持")
        manifest[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    return fingerprint, manifest


def import_snapshot(db, root, origin):
    root = Path(root).resolve()
    fingerprint, manifest = source_manifest(root)
    try:
        data = AccountData.model_validate(read_json(root / "accounts/store.json"))
    except Exception:
        # Pydantic 原始异常可能含密码摘要，不向 CLI 输出。
        raise ValueError("账号源结构校验失败") from None
    check(data.version == 1, "账号源版本不兼容")
    user_ids = {u.id for u in data.users}
    check(len(user_ids) == len(data.users), "重复用户ID")
    check(set(data.quotas) <= user_ids and set(data.durationQuotas) <= user_ids and set(data.sandboxGrants) <= user_ids, "孤立配额")
    check(all(set(v) <= {"30", "60"} for v in data.durationQuotas.values()), "未知配额时长")
    studios = {}
    for path in sorted((root / "studio").glob("*.json")):
        record = read_json(path)
        check(set(record) <= {"batchId", "attemptId", "userId", "state", "createdAt", "updatedAt", "model", "approvedBudgetUsd", "connectionCapSec", "singleConnectionEstimateUsd", "observation"}, "未知换装字段")
        check(record.get("attemptId") == path.stem and UUID.fullmatch(path.stem) and record.get("userId") in user_ids, "换装归属冲突")
        check(record.get("state") in {"reserved", "issued", "unknown", "finished"}, "换装状态无效")
        check(record.get("connectionCapSec", 15) in DURATIONS and record.get("model") == "lucy-vton-3.6", "换装模型/时长冲突")
        studios[path.stem] = record
    prompt = read_json(root / "prompt/limits.json")
    video = read_json(root / "video-jobs/jobs.json")
    check(set(prompt) == {"version", "attempts"} and prompt["version"] == 1 and isinstance(prompt["attempts"], list), "提示词源结构无效")
    check(set(video) == {"version", "jobs"} and video["version"] == 1 and isinstance(video["jobs"], list), "视频源结构无效")
    summary = {"users": len(data.users), "sessions": len(data.sessions), "studioAttempts": len(data.attempts), "orders": len(data.paymentOrders), "events": len(data.paymentEvents), "promptAttempts": len(prompt["attempts"]), "videoJobs": len(video["jobs"])}
    with db.transaction(True) as session:
        previous = session.execute(select(imports).where(imports.c.fingerprint == fingerprint)).mappings().first()
        if previous:
            check(json.loads(previous["summary"]) == summary, "导入摘要冲突")
            return {**summary, "alreadyImported": True, "fingerprint": fingerprint}
        check(session.execute(select(func.count()).select_from(users)).scalar_one() == 0, "目标数据库并非空库")
        for user in data.users:
            check(UUID.fullmatch(user.id) and re.fullmatch(r"[a-z0-9_]{3,24}", user.username) and re.fullmatch(r"[a-f0-9]{32}", user.salt) and re.fullmatch(r"[a-f0-9]{128}", user.passwordHash), "用户凭据格式不兼容")
            session.execute(insert(users).values(id=user.id, username=user.username, salt=user.salt, password_hash=user.passwordHash, created_at=millis(user.createdAt)))
        for row in data.sessions:
            check(HEX64.fullmatch(row.hash) and row.userId in user_ids, "孤立或无效会话")
            session.execute(insert(sessions).values(hash=row.hash, user_id=row.userId, expires_at=row.expiresAt))
        for key, value in data.limits.items():
            check(value.count >= 0, "限流计数异常")
            session.execute(insert(limits).values(key=key, count=value.count, until=value.until))
        grouped = Counter((a.userId, a.durationSec) for a in data.attempts)
        for user in data.users:
            for seconds in DURATIONS:
                relevant = [a for a in data.attempts if a.userId == user.id and a.durationSec == seconds]
                total = quota(data, user.id, seconds)
                check(len(relevant) <= total, "历史使用超过授权")
                gid = grant(session, user.id, seconds, total, "legacy", f"legacy:{user.id}:{seconds}")
                for attempt in relevant:
                    check(UUID.fullmatch(attempt.id) and attempt.state in {"used", "review"} and attempt.outcome in {None, "ended", "error"}, "使用记录无效")
                    ledger = studios.pop(attempt.id, None)
                    check(ledger is not None and ledger["userId"] == user.id and ledger.get("connectionCapSec", 15) == seconds, "签发与使用记录不一致")
                    observation = ledger.get("observation")
                    if observation is not None:
                        check(set(observation) == {"outcome", "firstFrameMs", "providerReportedSeconds", "localTracksEnded"} and observation["outcome"] == attempt.outcome, "观测记录冲突")
                    session.execute(insert(attempts).values(id=attempt.id, user_id=user.id, grant_id=gid, scene="studio", seconds=seconds, state=ledger["state"], account_state=attempt.state, created_at=millis(attempt.createdAt), updated_at=millis(ledger["updatedAt"]) if ledger.get("updatedAt") else None, observation=json.dumps(observation) if observation else None, outcome=attempt.outcome))
                    session.execute(insert(entries).values(id=str(uuid4()), grant_id=gid, operation_key=f"reserve:{attempt.id}", kind="reserve", quantity=1, created_at=millis(attempt.createdAt)))
                    if attempt.state == "used":
                        session.execute(insert(entries).values(id=str(uuid4()), grant_id=gid, operation_key=f"consume:{attempt.id}", kind="consume", quantity=1, created_at=millis(attempt.createdAt)))
                from sqlalchemy import update
                used = sum(a.state == "used" for a in relevant)
                session.execute(update(grants).where(grants.c.id == gid).values(used=used, reserved=len(relevant) - used))
        check(all(a.userId in user_ids and a.durationSec in DURATIONS for a in data.attempts), "孤立使用记录")
        # 旧 Node 在 claim 前可能已写 reserved，但没有成功扣账号权益；仍封存该 UUID 防止重签。
        for ident, ledger in studios.items():
            check(ledger["state"] == "reserved", "孤立签发记录需核查")
            session.execute(insert(attempts).values(id=ident, user_id=ledger["userId"], scene="studio", seconds=ledger.get("connectionCapSec", 15), state="reserved", created_at=millis(ledger["createdAt"])))
        sandbox = {}
        for order in data.paymentOrders:
            check(order.userId in user_ids and UUID.fullmatch(order.id) and UUID.fullmatch(order.requestId), "订单归属无效")
            # 旧 JSON 没有保存 Checkout 原参数/Origin，不能猜测未知创建请求。
            check(not (order.state == "creating" and order.sessionId is None), "未知创建订单缺少原请求快照，需先人工核对")
            p = product(order.sku)
            check(all(getattr(order, k) == v for k, v in p.items()), "订单价格快照冲突")
            row = {"id": order.id, "user_id": order.userId, "request_id": order.requestId, "sku": order.sku, "seconds": order.seconds, "count": order.count, "amount": order.amount, "currency": order.currency, "created_at": millis(order.createdAt), "state": order.state, "session_id": order.sessionId, "checkout_url": order.checkoutUrl, "expires_at": order.expiresAt, "fulfilled_at": millis(order.fulfilledAt) if order.fulfilledAt else None}
            row["request_snapshot"] = json.dumps(checkout_params(row, origin), ensure_ascii=False, separators=(",", ":"))
            session.execute(insert(orders).values(**row))
            if order.fulfilledAt:
                check(order.state == "paid" and order.sessionId, "已发放订单状态冲突")
                grant(session, order.userId, order.seconds, order.count, "paid", f"order:{order.id}", "stripe_sandbox")
                bucket = sandbox.setdefault(order.userId, {})
                key = str(order.seconds)
                bucket[key] = bucket.get(key, 0) + order.count
        check(sandbox == data.sandboxGrants, "沙盒聚合权益与订单不一致")
        for event_id in data.paymentEvents:
            check(event_id.startswith("evt_"), "事件编号无效")
            session.execute(insert(events).values(id=event_id, source="legacy", created_at=now_ms()))
        for scene, records in (("prompt", prompt["attempts"]), ("video", video["jobs"])):
            session.execute(insert(campaigns).values(scene=scene, created_at=now_ms()))
            for record in records:
                check(UUID.fullmatch(record.get("id", "")) and record.get("userId") in user_ids, "场景任务归属无效")
                created = millis(record["createdAt"])
                amount = micro_usd(record["estimateUsd"])
                if scene == "prompt":
                    check(set(record) == {"id", "userId", "state", "createdAt", "leaseUntil", "estimateUsd"} and record["state"] in {"unknown", "issued"} and amount == 300_000 and type(record["leaseUntil"]) is int, "提示词记录无效")
                    session.execute(insert(attempts).values(id=record["id"], user_id=record["userId"], scene=scene, seconds=15, state=record["state"], created_at=created))
                    lease = record["leaseUntil"]
                else:
                    check(set(record) <= {"id", "userId", "state", "createdAt", "expiresAt", "seconds", "estimateUsd", "providerId", "checkedAt"}, "未知视频字段")
                    seconds = Decimal(str(record["seconds"])) * 1000
                    check(seconds == seconds.to_integral() and 1000 <= seconds <= 15001, "视频时长无法无损导入")
                    if record.get("providerId"):
                        check(re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", record["providerId"]), "视频供应商编号无效")
                    lease = millis(record["expiresAt"])
                    session.execute(insert(jobs).values(id=record["id"], user_id=record["userId"], state=record["state"], created_at=created, expires_at=lease, seconds_milli=int(seconds), micro_usd=amount, provider_id=record.get("providerId"), checked_at=record.get("checkedAt")))
                session.execute(insert(reservations).values(id=record["id"], user_id=record["userId"], scene=scene, micro_usd=amount, lease_until=lease, created_at=created))
        for scene in ("studio", "prompt"):
            path = root / scene / "access"
            if path.exists():
                value = path.read_text(encoding="utf-8")
                check(HEX64.fullmatch(value), "场景访问凭据无效")
                session.execute(insert(access).values(scene=scene, value=value))
        # 在提交前，从目标查询核对账号每档总量/风险占用、订单、事件和独立预算。
        for user in data.users:
            target = session.execute(select(users).where(users.c.id == user.id)).mappings().one()
            check(target["password_hash"] == user.passwordHash and target["salt"] == user.salt and target["username"] == user.username and target["created_at"] == millis(user.createdAt), "用户迁移核对失败")
            for seconds in DURATIONS:
                balance = session.execute(select(grants).where(grants.c.source_key == f"legacy:{user.id}:{seconds}")).mappings().one()
                history = [a for a in data.attempts if a.userId == user.id and a.durationSec == seconds]
                check(balance["total"] == quota(data, user.id, seconds) and balance["used"] == sum(a.state == "used" for a in history) and balance["reserved"] == sum(a.state == "review" for a in history), "账户余额核对失败")
        for row in data.sessions:
            target = session.execute(select(sessions).where(sessions.c.hash == row.hash)).mappings().one()
            check(target["user_id"] == row.userId and target["expires_at"] == row.expiresAt, "有效会话核对失败")
        for order in data.paymentOrders:
            target = session.execute(select(orders).where(orders.c.id == order.id)).mappings().one()
            check(target["state"] == order.state and target["amount"] == order.amount and target["session_id"] == order.sessionId and target["fulfilled_at"] == (millis(order.fulfilledAt) if order.fulfilledAt else None), "订单核对失败")
        check({r for r in session.execute(select(events.c.id)).scalars()} == set(data.paymentEvents), "事件集合核对失败")
        for scene, records in (("prompt", prompt["attempts"]), ("video", video["jobs"])):
            target = session.execute(select(reservations).where(reservations.c.scene == scene)).mappings().all()
            check({r["id"]: r["micro_usd"] for r in target} == {r["id"]: micro_usd(r["estimateUsd"]) for r in records}, "场景风险预算核对失败")
            if scene == "prompt":
                check({r["id"]: r["lease_until"] for r in target} == {r["id"]: r["leaseUntil"] for r in records}, "提示词租约核对失败")
        # 导入期间源变化即回滚；最终快照必须由停写步骤保证。
        check(source_manifest(root)[0] == fingerprint, "导入期间源快照发生变化")
        session.execute(insert(imports).values(fingerprint=fingerprint, importer_version="1", manifest=json.dumps(manifest, sort_keys=True), summary=json.dumps(summary), created_at=now_ms()))
    db.readiness()
    return {**summary, "alreadyImported": False, "fingerprint": fingerprint}
