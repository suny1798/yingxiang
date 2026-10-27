"""小型运营台：现有会话鉴权、短事务修改、幂等与必要审计。"""
import json
import math
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Query
from pydantic import Field, ValidationError
from sqlalchemy import select, insert, update, delete, func, or_
from starlette.concurrency import run_in_threadpool

from .accounts import one, grant
from .core import BusinessError, iso, now_ms, local_origin, session_hash, read_json, UUID
from .models import users, sessions, grants, entries, attempts, jobs, video_history, orders, reservations, admin_audit, admin_settings
from .schemas import DTO, DurationView
from typing import Literal


class Mutation(DTO):
    requestId: str
    reason: str = Field(min_length=3, max_length=200)


class UserChange(Mutation):
    role: Literal['user', 'admin']
    disabled: bool


class QuotaChange(Mutation):
    seconds: Literal[15, 30, 60]
    delta: int = Field(ge=-1_000_000, le=1_000_000)


class SettingsChange(Mutation):
    version: int = Field(ge=0)
    paused: dict[Literal['studio', 'video', 'prompt'], bool] | None = None
    enabled: bool | None = None
    zh: str | None = Field(default=None, max_length=240)
    en: str | None = Field(default=None, max_length=400)


class AdminUser(DTO):
    id: str
    username: str
    role: Literal['user', 'admin']
    disabled: bool
    createdAt: str
    durations: list[DurationView]


class AdminUsers(DTO):
    items: list[AdminUser]
    total: int
    page: int
    pages: int


class AdminRecord(DTO):
    id: str
    username: str
    scene: str
    state: str
    createdAt: str
    seconds: float | None = None
    amount: int | None = None
    title: str | None = None


class AdminRecords(DTO):
    items: list[AdminRecord]
    total: int
    page: int
    pages: int


class AuditItem(DTO):
    id: str
    actor: str
    action: str
    target: str
    reason: str
    changes: str
    createdAt: str


class AuditPage(DTO):
    items: list[AuditItem]
    total: int
    page: int
    pages: int


class ServiceSettings(DTO):
    version: int
    studio: bool
    video: bool
    prompt: bool


class Announcement(DTO):
    version: int
    enabled: bool
    zh: str
    en: str


class AdminSettings(DTO):
    services: ServiceSettings
    announcement: Announcement


class ServiceStatus(DTO):
    scene: Literal['studio', 'video', 'prompt']
    configured: bool
    paused: bool
    budgetUsd: float | None
    reservedUsd: float
    maxRequests: int | None
    requests: int


class Overview(DTO):
    users: int
    admins: int
    disabledUsers: int
    videoJobs: int
    usageAttempts: int
    sandboxOrders: int
    unknownResults: int
    sandboxEnabled: bool
    livePaymentsEnabled: bool
    services: list[ServiceStatus]


def setting(session, key):
    row = one(session, admin_settings, admin_settings.c.key == key)
    return (json.loads(row['value']), row['version']) if row else ({}, 0)


def paused(session, scene):
    value, _ = setting(session, 'services')
    return value.get(scene, False) is True


class Administration:
    def __init__(self, db, accounts):
        self.db, self.accounts = db, accounts

    def require(self, session, hashed):
        actor = self.accounts.user(session, hashed, True)
        if actor['role'] != 'admin':
            raise BusinessError('ADMIN_REQUIRED', '需要管理员权限。', 403)
        return actor

    def authorize(self, hashed):
        with self.db.transaction() as session:
            return self.require(session, hashed)['id']

    @staticmethod
    def validate(model, body):
        try:
            value = model.model_validate(body)
        except ValidationError:
            raise BusinessError('INVALID_REQUEST', '管理参数无效，请核对填写内容。') from None
        if not UUID.fullmatch(value.requestId) or len(value.reason.strip()) < 3:
            raise BusinessError('INVALID_REQUEST', '请填写有效操作编号及至少3字的操作原因。')
        return value

    def mutate(self, hashed, action, target, body, model, callback):
        value = self.validate(model, body)
        payload = value.model_dump()
        with self.db.transaction(True) as session:
            actor = self.require(session, hashed)
            old = one(session, admin_audit, admin_audit.c.request_id == value.requestId)
            if old:
                if old['actor_id'] != actor['id'] or old['action'] != action or old['target'] != target or json.loads(old['changes']).get('input') != payload:
                    raise BusinessError('REQUEST_CONFLICT', '操作编号已用于不同的修改，请重新核对。', 409)
                return {'accepted': True}
            changes = callback(session, actor, value)
            session.execute(insert(admin_audit).values(id=str(uuid4()), request_id=value.requestId, actor_id=actor['id'], action=action, target=target, reason=value.reason.strip(), changes=json.dumps({'input': payload, **changes}, ensure_ascii=False), created_at=now_ms()))
        return {'accepted': True}

    def user_change(self, hashed, ident, body):
        def apply(session, actor, value):
            user = one(session, users, users.c.id == ident)
            if not user:
                raise BusinessError('NOT_FOUND', '账号不存在。', 404)
            if ident == actor['id'] and (value.role != 'admin' or value.disabled):
                raise BusinessError('ADMIN_SELF_LOCK', '不能撤销自己的管理员权限或暂停自己。', 409)
            if user['role'] == 'admin' and not user['disabled'] and (value.role != 'admin' or value.disabled):
                count = session.execute(select(func.count()).select_from(users).where(users.c.role == 'admin', users.c.disabled == 0)).scalar_one()
                if count <= 1:
                    raise BusinessError('LAST_ADMIN', '至少保留一名可用管理员。', 409)
            session.execute(update(users).where(users.c.id == ident).values(role=value.role, disabled=int(value.disabled)))
            if value.disabled or value.role != user['role']:
                session.execute(delete(sessions).where(sessions.c.user_id == ident))
            return {'before': {'role': user['role'], 'disabled': bool(user['disabled'])}, 'after': {'role': value.role, 'disabled': value.disabled}}
        return self.mutate(hashed, 'user.update', ident, body, UserChange, apply)

    def quota_change(self, hashed, ident, body):
        def apply(session, actor, value):
            if not one(session, users, users.c.id == ident):
                raise BusinessError('NOT_FOUND', '账号不存在。', 404)
            if value.delta == 0:
                raise BusinessError('INVALID_REQUEST', '调整次数不能为0。')
            rows = session.execute(select(grants).where(grants.c.user_id == ident, grants.c.seconds == value.seconds, grants.c.environment == 'real_usage').order_by(grants.c.id)).mappings().all()
            before = sum(r['total'] - r['reserved'] - r['used'] - r['revoked'] for r in rows)
            if before + value.delta < 0:
                raise BusinessError('INSUFFICIENT_AVAILABLE', '只能回收未使用、未预留的次数。', 409)
            if value.delta > 0:
                grant(session, ident, value.seconds, value.delta, 'admin', f'admin:{value.requestId}')
            else:
                remaining = -value.delta
                for row in rows:
                    quantity = min(remaining, row['total'] - row['reserved'] - row['used'] - row['revoked'])
                    if quantity:
                        session.execute(update(grants).where(grants.c.id == row['id']).values(revoked=grants.c.revoked + quantity))
                        session.execute(insert(entries).values(id=str(uuid4()), grant_id=row['id'], operation_key=f'admin-revoke:{value.requestId}:{row["id"]}', kind='revoke', quantity=quantity, created_at=now_ms()))
                    remaining -= quantity
                    if remaining == 0:
                        break
            return {'before': before, 'after': before + value.delta, 'seconds': value.seconds}
        return self.mutate(hashed, 'quota.adjust', ident, body, QuotaChange, apply)

    def settings_change(self, hashed, key, body):
        if key not in ('services', 'announcement'):
            raise BusinessError('NOT_FOUND', '设置不存在。', 404)
        def apply(session, actor, value):
            before, version = setting(session, key)
            if version != value.version:
                raise BusinessError('SETTINGS_CONFLICT', '设置已被更新，请刷新后重新确认。', 409)
            if key == 'services':
                if value.paused is None or set(value.paused) != {'studio', 'video', 'prompt'} or any(v is not None for v in (value.enabled, value.zh, value.en)):
                    raise BusinessError('INVALID_REQUEST', '请填写完整的服务暂停状态。')
                after = value.paused
            else:
                if value.enabled is None or value.zh is None or value.en is None or value.paused is not None or (value.enabled and (not value.zh.strip() or not value.en.strip())):
                    raise BusinessError('INVALID_REQUEST', '启用公告时，请填写中英文正文。')
                after = {'enabled': value.enabled, 'zh': value.zh.strip(), 'en': value.en.strip()}
            session.execute(delete(admin_settings).where(admin_settings.c.key == key))
            session.execute(insert(admin_settings).values(key=key, value=json.dumps(after, ensure_ascii=False), version=version + 1))
            return {'before': before, 'after': after}
        return self.mutate(hashed, f'{key}.update', key, body, SettingsChange, apply)

    def settings_view(self, hashed):
        with self.db.transaction() as session:
            self.require(session, hashed)
            services, sv = setting(session, 'services')
            announcement, av = setting(session, 'announcement')
            return {'services': {'version': sv, **{k: services.get(k, False) for k in ('studio', 'video', 'prompt')}}, 'announcement': {'version': av, 'enabled': announcement.get('enabled', False), 'zh': announcement.get('zh', ''), 'en': announcement.get('en', '')}}

    def announcement(self):
        with self.db.transaction() as session:
            value, version = setting(session, 'announcement')
            return {'version': version, 'enabled': value.get('enabled', False), 'zh': value.get('zh', '') if value.get('enabled') else '', 'en': value.get('en', '') if value.get('enabled') else ''}

    @staticmethod
    def page_info(session, table, conditions, page):
        total = session.execute(select(func.count()).select_from(table).where(*conditions)).scalar_one()
        return {'total': total, 'page': page, 'pages': max(1, math.ceil(total / 20))}

    def list_users(self, hashed, query, page):
        with self.db.transaction() as session:
            self.require(session, hashed)
            where = [users.c.username.contains(query, autoescape=True)] if query else []
            info = self.page_info(session, users, where, page)
            rows = session.execute(select(users).where(*where).order_by(users.c.created_at.desc(), users.c.id).limit(20).offset((page - 1) * 20)).mappings()
            items = []
            for row in rows:
                view = self.accounts.view(session, row)
                items.append({**view['user'], 'disabled': bool(row['disabled']), 'durations': view['durations']})
            return {**info, 'items': items}

    def records(self, hashed, kind, query, state, page):
        table = {'video': jobs, 'usage': attempts, 'orders': orders}[kind]
        with self.db.transaction() as session:
            self.require(session, hashed)
            joined = table.join(users, table.c.user_id == users.c.id)
            where = []
            if query:
                where.append(or_(users.c.username.contains(query, autoescape=True), table.c.id.contains(query, autoescape=True)))
            if state:
                where.append(table.c.state == state)
            info = self.page_info(session, joined, where, page)
            rows = session.execute(select(table, users.c.username).select_from(joined).where(*where).order_by(table.c.created_at.desc(), table.c.id).limit(20).offset((page - 1) * 20)).mappings()
            items = []
            for row in rows:
                items.append({'id': row['id'], 'username': row['username'], 'state': row['state'], 'createdAt': iso(row['created_at']), 'scene': 'video' if kind == 'video' else row['scene'] if kind == 'usage' else 'stripe_sandbox', 'seconds': row['seconds_milli'] / 1000 if kind == 'video' else row['seconds'], 'amount': row['amount'] if kind == 'orders' else None, 'title': row['sku'] if kind == 'orders' else None})
            return {**info, 'items': items}

    def audit(self, hashed, page):
        with self.db.transaction() as session:
            self.require(session, hashed)
            info = self.page_info(session, admin_audit, [], page)
            rows = session.execute(select(admin_audit, users.c.username).join(users, admin_audit.c.actor_id == users.c.id).order_by(admin_audit.c.created_at.desc(), admin_audit.c.id).limit(20).offset((page - 1) * 20)).mappings()
            return {**info, 'items': [{'id': r['id'], 'actor': r['username'], 'action': r['action'], 'target': r['target'], 'reason': r['reason'], 'changes': r['changes'], 'createdAt': iso(r['created_at'])} for r in rows]}

    def overview(self, hashed, generation, payments):
        with self.db.transaction() as session:
            self.require(session, hashed)
            def count(table, *conditions):
                return session.execute(select(func.count()).select_from(table).where(*conditions)).scalar_one()
            services = []
            for scene in ('studio', 'video', 'prompt'):
                config = generation.config(scene) if scene != 'studio' else None
                configured = config['enabled'] if config else generation.settings.env.get('YINGXIANG_STUDIO_ENABLED') == 'true' and bool(generation.key())
                services.append({'scene': scene, 'configured': configured, 'paused': paused(session, scene), 'budgetUsd': config['budget'] / 1e6 if config and not config.get('unlimited') else None, 'maxRequests': config['max'] if config and not config.get('unlimited') else None, 'reservedUsd': (session.execute(select(func.coalesce(func.sum(reservations.c.micro_usd), 0)).where(reservations.c.scene == scene)).scalar_one()) / 1e6, 'requests': count(jobs) if scene == 'video' else count(attempts, attempts.c.scene == scene)})
            return {'users': count(users), 'admins': count(users, users.c.role == 'admin', users.c.disabled == 0), 'disabledUsers': count(users, users.c.disabled == 1), 'videoJobs': count(jobs), 'usageAttempts': count(attempts), 'sandboxOrders': count(orders), 'unknownResults': count(jobs, jobs.c.state == 'unknown') + count(attempts, attempts.c.state == 'unknown'), 'sandboxEnabled': payments.enabled(), 'livePaymentsEnabled': False, 'services': services}


def install_admin(app, db, accounts, settings, payments):
    admin = Administration(db, accounts)
    app.state.admin = admin

    async def require_admin(request: Request):
        local_origin(request, settings, request.method != 'GET')
        await run_in_threadpool(admin.authorize, session_hash(request))

    router = APIRouter(prefix='/api/admin', dependencies=[Depends(require_admin)])

    @router.get('/overview', response_model=Overview)
    async def overview(request: Request):
        return await run_in_threadpool(admin.overview, session_hash(request), app.state.generation, payments)

    @router.get('/users', response_model=AdminUsers)
    async def user_list(request: Request, q: str = Query('', max_length=80), page: int = Query(1, ge=1, le=100000)):
        return await run_in_threadpool(admin.list_users, session_hash(request), q.strip(), page)

    @router.post('/users/{ident}')
    async def change_user(request: Request, ident: str):
        return await run_in_threadpool(admin.user_change, session_hash(request), ident, await read_json(request, True))

    @router.post('/users/{ident}/quota')
    async def change_quota(request: Request, ident: str):
        return await run_in_threadpool(admin.quota_change, session_hash(request), ident, await read_json(request, True))

    @router.get('/records/{kind}', response_model=AdminRecords)
    async def records(request: Request, kind: Literal['video', 'usage', 'orders'], q: str = Query('', max_length=80), state: str = Query('', max_length=32), page: int = Query(1, ge=1, le=100000)):
        return await run_in_threadpool(admin.records, session_hash(request), kind, q.strip(), state, page)

    @router.get('/audit', response_model=AuditPage)
    async def audit(request: Request, page: int = Query(1, ge=1, le=100000)):
        return await run_in_threadpool(admin.audit, session_hash(request), page)

    @router.get('/settings', response_model=AdminSettings)
    async def settings_view(request: Request):
        return await run_in_threadpool(admin.settings_view, session_hash(request))

    @router.post('/settings/{key}')
    async def settings_update(request: Request, key: Literal['services', 'announcement']):
        return await run_in_threadpool(admin.settings_change, session_hash(request), key, await read_json(request, True))

    app.include_router(router)

    @app.get('/api/site/announcement', response_model=Announcement)
    async def announcement():
        return await run_in_threadpool(admin.announcement)
