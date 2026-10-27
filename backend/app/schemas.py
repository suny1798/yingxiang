"""公开 DTO/OpenAPI；HTTP 仍先按旧合同顺序限长、鉴权及映射错误。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, StrictStr, StrictInt


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class AuthRequest(DTO):
    username: StrictStr
    password: StrictStr


class TokenRequest(DTO):
    attemptId: StrictStr
    consentVersion: StrictStr
    durationSec: StrictInt = 15


class PromptTokenRequest(TokenRequest):
    durationSec: Literal[15]


class CheckoutRequest(DTO):
    requestId: StrictStr
    sku: StrictStr


class ReconcileRequest(DTO):
    orderId: StrictStr


class ObservationRequest(DTO):
    attemptId: StrictStr
    firstFrameMs: float | None
    providerReportedSeconds: float | None
    localTracksEnded: bool
    outcome: Literal["ended", "error"]


class UserView(DTO):
    id: str
    username: str
    createdAt: str
    role: Literal["user", "admin"] = "user"


class DurationView(DTO):
    seconds: Literal[15, 30, 60]
    limit: int
    remaining: int


class HistoryView(DTO):
    id: str
    createdAt: str
    durationSec: Literal[15, 30, 60]
    state: Literal["used", "review"]
    outcome: Literal["ended", "error"] | None = None


class AccountView(DTO):
    user: UserView | None
    trial: Literal["ready", "review", "used"] | None
    trialLimit: int
    trialRemaining: int
    durations: list[DurationView]
    history: list[HistoryView]


class ApiError(DTO):
    class Error(DTO):
        code: str
        message: str
        retryable: bool
    error: Error
    requestId: str


class VideoHistoryItem(DTO):
    id: str
    title: str
    archived: bool
    state: Literal["submitting", "unknown", "pending", "processing", "completed", "failed"]
    createdAt: str
    expiresAt: str
    seconds: float
    estimateUsd: float
    expired: bool


class VideoHistoryPage(DTO):
    items: list[VideoHistoryItem]
    page: int
    pageSize: int
    pages: int
    total: int


class WorkReference(DTO):
    id: str
    url: str
    bytes: int


class WorkCreate(DTO):
    id: str
    ownerId: str
    kind: Literal['realtime', 'edit']
    mime: Literal['video/mp4', 'video/webm']
    seconds: Literal[15, 30, 60]


class WorkComplete(DTO):
    durationMs: int | None = None
    referenceFailed: bool = False
    promptsFailed: bool = False
    interrupted: bool = False


class WorkChange(DTO):
    title: str | None = None
    action: Literal['retry', 'delete'] | None = None
    favorite: bool | None = None


class WorkPromptState(DTO):
    atMs: StrictInt
    instructions: list[StrictStr]


class WorkPromptHistory(DTO):
    states: list[WorkPromptState]


class WorkItem(DTO):
    id: str
    kind: Literal['realtime', 'video', 'edit']
    title: str
    state: Literal['capturing', 'waiting', 'saving', 'ready', 'failed']
    createdAt: str
    updatedAt: str
    bytes: int
    seconds: float
    extension: Literal['mp4', 'webm']
    message: str | None
    canRetry: bool
    favorite: bool
    contentUrl: str | None
    references: list[WorkReference]


class WorkPage(DTO):
    items: list[WorkItem]
    page: int
    pageSize: int
    pages: int
    total: int


class PaymentOrderView(DTO):
    id: str
    sku: str
    seconds: Literal[15, 30, 60] | None
    count: Literal[1, 5, 10] | None
    amount: int
    currency: Literal["cny"]
    state: Literal["creating", "pending", "paid", "failed", "expired"]
    createdAt: str
    fulfilledAt: str | None = None
    planId: Literal["light", "creator", "plus"] | None = None
    credits: int | None = None

class SandboxCreditPackView(DTO):
    orderId: str
    planId: Literal["light", "creator", "plus"]
    credits: int
    scenes: list[Literal["tryon", "video", "edit"]]
    createdAt: str

class PaymentsView(DTO):
    orders: list[PaymentOrderView]
    sandboxCredits: dict[str, int]
    sandboxCreditPacks: list[SandboxCreditPackView]
    sandboxPointBalance: int
    url: str | None = None


def extend_openapi(app):
    from fastapi.openapi.utils import get_openapi
    def openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        for model in (AuthRequest, TokenRequest, PromptTokenRequest, CheckoutRequest, ReconcileRequest, ObservationRequest, AccountView, ApiError, PaymentsView, WorkCreate, WorkComplete, WorkChange, WorkPromptState):
            value = model.model_json_schema(ref_template="#/components/schemas/{model}")
            components.update(value.pop("$defs", {}))
            components[model.__name__] = value
        requests = {"/api/account/register": AuthRequest, "/api/account/login": AuthRequest, "/api/studio/token": TokenRequest, "/api/prompt/token": PromptTokenRequest, "/api/studio/observation": ObservationRequest, "/api/payments/checkout": CheckoutRequest, "/api/payments/reconcile": ReconcileRequest}
        requests.update({'/api/works': WorkCreate, '/api/works/{ident}/complete': WorkComplete, '/api/works/{ident}': WorkChange})
        requests['/api/works/{ident}/prompts/{index}'] = WorkPromptState
        from .admin import UserChange, QuotaChange, SettingsChange
        for path, model in {'/api/admin/users/{ident}': UserChange, '/api/admin/users/{ident}/quota': QuotaChange, '/api/admin/settings/{key}': SettingsChange}.items():
            value = model.model_json_schema(ref_template="#/components/schemas/{model}")
            components.update(value.pop('$defs', {}))
            components[model.__name__] = value
            requests[path] = model
        for path, model in requests.items():
            schema["paths"][path]["post"]["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{model.__name__}"}}}}
        for path, methods in schema["paths"].items():
            for method, op in methods.items():
                if method not in ("get", "post"):
                    continue
                op["responses"].pop("422", None)
                for code in (400, 401, 403, 409, 413, 415, 429, 503):
                    op["responses"][str(code)] = {"description": "受控业务错误", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ApiError"}}}}
        for path, method in (("/api/account/me", "get"), ("/api/account/register", "post"), ("/api/account/login", "post")):
            schema["paths"][path][method]["responses"]["200"] = {"description": "兼容原账户响应；可选字段维持省略语义。", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AccountView"}}}}
        schema["paths"]["/api/video/jobs"]["post"]["requestBody"] = {"required": True, "content": {"multipart/form-data": {"schema": {"type": "object", "additionalProperties": False, "required": ["data", "reference_image", "consentVersion"], "properties": {"data": {"type": "string", "format": "binary"}, "reference_image": {"type": "string", "format": "binary"}, "consentVersion": {"type": "string"}}}}}}
        schema["paths"]["/api/video/prepare"]["post"]["requestBody"] = {"required": True, "content": {"video/mp4": {"schema": {"type": "string", "format": "binary"}}}}
        schema["paths"]["/api/video/jobs/{ident}/history"]["post"]["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"type": "object", "additionalProperties": False, "minProperties": 1, "properties": {"title": {"type": "string", "minLength": 1, "maxLength": 60}, "archived": {"type": "boolean"}}}}}}
        for path, formats in {
            '/api/works/{ident}/chunks/{index}': ('application/octet-stream',),
            '/api/works/{ident}/references/{ref_id}': ('image/png', 'image/jpeg', 'image/webp'),
        }.items():
            schema['paths'][path]['post']['requestBody'] = {'required': True, 'content': {mime: {'schema': {'type': 'string', 'format': 'binary'}} for mime in formats}}
        for path in ('/api/works', '/api/works/{ident}/complete', '/api/works/{ident}/chunks/{index}', '/api/works/{ident}/references/{ref_id}', '/api/works/{ident}/prompts/{index}'):
            schema['paths'][path]['post'].setdefault('parameters', []).append({'name': 'X-Work-Owner', 'in': 'header', 'required': True, 'schema': {'type': 'string'}})
        for path, formats in {
            '/api/works/{ident}/content': ('video/mp4', 'video/webm'),
            '/api/works/{ident}/references/{ref_id}': ('image/png', 'image/jpeg', 'image/webp'),
        }.items():
            response = {'description': '本人作品文件；私有、不缓存。视频支持Range。', 'content': {mime: {'schema': {'type': 'string', 'format': 'binary'}} for mime in formats}}
            schema['paths'][path]['get']['responses']['200'] = response
            if path.endswith('/content'):
                schema['paths'][path]['get']['responses']['206'] = response
        for path, method in (("/api/payments/orders", "get"), ("/api/payments/reconcile", "post")):
            schema["paths"][path][method]["responses"]["200"] = {"description": "沙盒订单与长期有效测试积分，独立于真实模型额度。", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/PaymentsView"}}}}
        app.openapi_schema = schema
        return schema
    app.openapi = openapi
