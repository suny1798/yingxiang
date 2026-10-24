from contextlib import asynccontextmanager
from uuid import uuid4
import asyncio
import struct
import json

import httpx
from fastapi import FastAPI, Request, Query
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse, Response
from starlette.background import BackgroundTask
from sqlalchemy.exc import SQLAlchemyError

from .core import Settings, BusinessError, private_json, error_response, local_origin, session_hash, read_json, bounded_body, COOKIE, SESSION_MS, UUID, now_ms
from .db import Database
from .accounts import Accounts
from .payments import Payments
from .generation import Generation, POLICIES
from .media import multipart_parts
from .video_prepare import prepare_video
from .video_history import VideoHistory
from .schemas import VideoHistoryItem, VideoHistoryPage


def create_app(settings=None, *, transport=None, stripe_client=None):
    settings = settings or Settings.load()
    db = Database(settings.database, settings.journal_mode)
    accounts = Accounts(db)

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(transport=transport, timeout=15, follow_redirects=False, limits=httpx.Limits(max_connections=8, max_keepalive_connections=4)) as client:
            app.state.generation = Generation(db, accounts, settings, client)
            app.state.video_history = VideoHistory(db, app.state.generation)
            app.state.upload_busy = False
            yield
        db.close()

    app = FastAPI(title="映想 API", version="0.1.0", redirect_slashes=False, lifespan=lifespan, docs_url=None, redoc_url=None)
    payments = Payments(db, accounts, settings, stripe_client)
    app.state.db, app.state.accounts, app.state.payments, app.state.settings = db, accounts, payments, settings

    @app.middleware("http")
    async def guard(request, call_next):
        try:
            if settings.maintenance and request.method not in ("GET", "HEAD", "OPTIONS"):
                raise BusinessError("MAINTENANCE", "服务维护中，请稍后再试。", 503)
            response = await call_next(request)
        except BusinessError as error:
            response = error_response(error)
        except Exception:
            # 不打印完整框架/上游异常，防止凭据和请求体进入日志。
            response = error_response(BusinessError("SERVICE_UNAVAILABLE", "服务暂不可用，请刷新状态核查，不要重复提交。", 503))
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(BusinessError)
    async def business_error(request, error):
        return error_response(error)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return error_response(BusinessError("INVALID_REQUEST", "请求参数无效。"))

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return error_response(BusinessError("NOT_FOUND" if error.status_code == 404 else "METHOD_NOT_ALLOWED", "接口不存在。" if error.status_code == 404 else "请求方法不支持。", error.status_code))

    @app.get("/internal/live", include_in_schema=False)
    async def live():
        return private_json({"status": "ok"})

    @app.get("/internal/ready", include_in_schema=False)
    async def ready():
        try:
            await run_in_threadpool(db.readiness)
        except Exception:
            return error_response(BusinessError("STORAGE_UNAVAILABLE", "数据库尚未就绪。", 503))
        return private_json({"status": "ok", "maintenance": settings.maintenance})

    @app.get("/api/account/me")
    async def me(request: Request):
        local_origin(request, settings)
        return private_json(await run_in_threadpool(accounts.me, session_hash(request)))

    async def authenticate(request, register):
        local_origin(request, settings, True)
        body = await read_json(request, True)
        value, token = await run_in_threadpool(accounts.authenticate, body, register)
        secure = "; Secure" if settings.public_origin.startswith("https:") else ""
        return private_json(value, headers={"Set-Cookie": f"{COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_MS // 1000}{secure}"})

    @app.post("/api/account/register")
    async def register(request: Request):
        return await authenticate(request, True)

    @app.post("/api/account/login")
    async def login(request: Request):
        return await authenticate(request, False)

    @app.post("/api/account/logout")
    async def logout(request: Request):
        local_origin(request, settings, True)
        await run_in_threadpool(accounts.logout, session_hash(request))
        return private_json({"accepted": True}, headers={"Set-Cookie": f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})

    # 原动态路由接受 GET/POST；不存在的 action 保持既有简短 404。
    @app.api_route("/api/account/{action}", methods=["GET", "POST"], include_in_schema=False)
    @app.api_route("/api/payments/{action}", methods=["GET", "POST"], include_in_schema=False)
    async def unknown_action(action: str):
        return private_json({"error": {"code": "NOT_FOUND", "message": "接口不存在。"}}, 404)

    @app.get("/api/payments/status")
    async def payment_status():
        return private_json({"testEnabled": payments.enabled(), "liveEnabled": False})

    @app.get("/api/payments/orders")
    async def payment_orders(request: Request):
        local_origin(request, settings)
        return private_json(await run_in_threadpool(payments.list, session_hash(request)))

    @app.post("/api/payments/checkout")
    async def checkout(request: Request):
        # 原实现先检查支付门禁，再检查来源/body。
        await run_in_threadpool(payments.client)
        origin = local_origin(request, settings, True)
        body = await read_json(request, True)
        return private_json(await run_in_threadpool(payments.checkout, session_hash(request), body, origin))

    @app.post("/api/payments/reconcile")
    async def reconcile(request: Request):
        await run_in_threadpool(payments.client)
        body = await read_json(request)
        origin = local_origin(request, settings, True)
        return private_json(await run_in_threadpool(payments.reconcile, session_hash(request), body, origin))

    @app.post("/api/payments/webhook")
    async def webhook(request: Request):
        await run_in_threadpool(payments.client)
        signature = request.headers.get("stripe-signature")
        if not signature:
            raise BusinessError("INVALID_SIGNATURE", "付款通知验签失败。")
        body = await bounded_body(request, 262144)
        return private_json(await run_in_threadpool(payments.webhook, body, signature))

    @app.get("/api/studio/status")
    async def studio_status(request: Request):
        local_origin(request, settings)
        return private_json(await run_in_threadpool(app.state.generation.studio_status))

    @app.post("/api/studio/token")
    @app.post("/api/prompt/token")
    async def token(request: Request):
        origin = local_origin(request, settings, True)
        await run_in_threadpool(accounts.require, session_hash(request))
        scene = "prompt" if request.url.path.startswith("/api/prompt") else "studio"
        await run_in_threadpool(app.state.generation.authenticate, scene, request.headers.get("x-studio-access", ""))
        body = await read_json(request, True)
        return private_json(await app.state.generation.issue(scene, session_hash(request), body, origin))

    @app.post("/api/studio/observation")
    async def observation(request: Request):
        local_origin(request, settings, True)
        user_id = await run_in_threadpool(accounts.require, session_hash(request))
        body = await read_json(request)
        await run_in_threadpool(app.state.generation.authenticate, "studio", request.headers.get("x-studio-access", ""))
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise BusinessError("INVALID_REQUEST", "请使用JSON请求。", 415)
        await run_in_threadpool(app.state.generation.observe, user_id, body)
        return private_json({"accepted": True})

    @app.get("/api/prompt/status")
    async def prompt_status(request: Request):
        local_origin(request, settings)
        account = await run_in_threadpool(accounts.me, session_hash(request))
        return private_json(await run_in_threadpool(app.state.generation.prompt_status, account["user"]["id"] if account["user"] else None))

    @app.get("/api/video/jobs")
    async def video_status(request: Request):
        local_origin(request, settings)
        account = await run_in_threadpool(accounts.me, session_hash(request))
        return private_json(await run_in_threadpool(app.state.generation.video_status, account["user"]["id"] if account["user"] else None))

    @app.get("/api/video/history", response_model=VideoHistoryPage)
    async def video_history_list(request: Request, archived: bool = False, page: int = Query(1, ge=1, le=100000), pageSize: int = Query(3, ge=1, le=12)):
        local_origin(request, settings)
        user_id = await run_in_threadpool(accounts.require, session_hash(request))
        return private_json(await run_in_threadpool(app.state.video_history.list, user_id, archived, page, pageSize))

    @app.post("/api/video/jobs/{ident}/history", response_model=VideoHistoryItem)
    async def video_history_change(ident: str, request: Request):
        local_origin(request, settings, True)
        user_id = await run_in_threadpool(accounts.require, session_hash(request))
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise BusinessError("INVALID_REQUEST", "请使用JSON请求。", 415)
        body = await read_json(request)
        return private_json(await run_in_threadpool(app.state.video_history.change, user_id, ident, body))

    @app.post("/api/video/prepare", response_class=Response, responses={200: {"content": {"video/mp4": {"schema": {"type": "string", "format": "binary"}}}}})
    async def video_prepare(request: Request):
        local_origin(request, settings, True)
        if request.headers.get("content-type", "").split(";")[0] != "video/mp4":
            raise BusinessError("INVALID_VIDEO_UPLOAD", "请选择MP4视频。", 415)
        if app.state.upload_busy:
            raise BusinessError("VIDEO_BUSY", "视频处理正忙，请稍后重试。", 503)
        app.state.upload_busy = True
        try:
            def limited():
                with db.transaction(True) as session:
                    return accounts.rate_limit(session, "video-prepare:global", 30, 10 * 60_000)
            if await run_in_threadpool(limited):
                raise BusinessError("RATE_LIMITED", "视频处理过于频繁，请稍后重试。", 429)
            data = await bounded_body(request, 25 * 1024 * 1024)
            try:
                result, _, removed = await run_in_threadpool(prepare_video, data)
            except (ValueError, StopIteration, OverflowError, struct.error):
                raise BusinessError("INVALID_VIDEO_MEDIA", "视频未能自动处理，请确认是1—15秒的普通H.264 MP4后重试。") from None
            return Response(result, media_type="video/mp4", headers={"X-Video-Audio-Removed": "1" if removed else "0", "Content-Disposition": 'inline; filename="prepared-video.mp4"'})
        finally:
            app.state.upload_busy = False

    @app.post("/api/video/jobs")
    async def video_submit(request: Request):
        local_origin(request, settings, True)
        hashed = session_hash(request)
        user_id = await run_in_threadpool(accounts.require, hashed)
        ident = request.headers.get("x-video-attempt", "")
        if not UUID.fullmatch(ident):
            raise BusinessError("INVALID_VIDEO_ATTEMPT", "缺少有效的提交编号，请刷新后重试。")
        generation = app.state.generation
        previous = await run_in_threadpool(generation.previous_job, user_id, ident)
        if previous:
            return private_json(previous)
        if not generation.config("video")["enabled"]:
            raise BusinessError("VIDEO_DISABLED", "视频生成待开放，可先预览素材。", 503)
        content_type = request.headers.get("content-type", "")
        if len(content_type) > 256 or not content_type.startswith("multipart/form-data;"):
            raise BusinessError("INVALID_VIDEO_UPLOAD", "请通过页面选择视频与服装图。", 415)
        # 单 worker 内先占内存槽，不 await 排队；跨进程不支持，运维固定一个 worker。
        if app.state.upload_busy:
            raise BusinessError("VIDEO_BUSY", "任务服务正忙，请稍后刷新。", 503)
        app.state.upload_busy = True
        try:
            try:
                data = await bounded_body(request, 35 * 1024 * 1024 + 4096)
            except BusinessError as error:
                if error.status == 413:
                    raise BusinessError("VIDEO_TOO_LARGE", "上传内容过大。", 413) from None
                raise
            video, image, mime, seconds = await run_in_threadpool(multipart_parts, data, content_type)
            del data
            return private_json(await generation.submit_video(user_id, ident, video, image, mime, seconds))
        finally:
            app.state.upload_busy = False

    @app.get("/api/video/jobs/{ident}")
    async def video_get(ident: str, request: Request):
        local_origin(request, settings)
        user_id = await run_in_threadpool(accounts.require, session_hash(request))
        return private_json(await app.state.generation.get_video(user_id, ident))

    @app.get("/api/video/jobs/{ident}/content")
    async def video_content(ident: str, request: Request):
        local_origin(request, settings)
        user_id = await run_in_threadpool(accounts.require, session_hash(request))
        generation = app.state.generation
        job = await run_in_threadpool(generation.own_job, user_id, ident)
        if now_ms() >= job["expires_at"]:
            raise BusinessError("VIDEO_EXPIRED", "视频访问窗口已结束。", 410)
        if job["state"] != "completed" or not job["provider_id"]:
            raise BusinessError("VIDEO_NOT_READY", "视频尚未生成完成。", 409)
        from .generation import JOB_URL
        response = None
        try:
            response = await generation.client.send(generation.client.build_request("GET", f"{JOB_URL}/{job['provider_id']}/content", headers={"X-API-KEY": generation.key()}, timeout=120), stream=True)
            if not response.is_success or response.headers.get("content-type", "").split(";")[0].strip() not in ("video/mp4", "application/octet-stream") or int(response.headers.get("content-length", "0")) > 200 * 1024 * 1024:
                raise ValueError()
        except Exception:
            if response:
                await response.aclose()
            raise BusinessError("VIDEO_DOWNLOAD_UNAVAILABLE", "视频暂时无法下载，请稍后再试。", 502) from None

        async def content():
            size = 0
            try:
                async with asyncio.timeout(120):
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 200 * 1024 * 1024:
                            raise RuntimeError("视频结果过大。")
                        yield chunk
            finally:
                await response.aclose()

        attachment = "attachment" if request.query_params.get("download") == "1" else "inline"
        return StreamingResponse(content(), media_type="video/mp4", background=BackgroundTask(response.aclose), headers={"Content-Disposition": f'{attachment}; filename="yingxiang-{job["id"]}.mp4"', "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/api/v1/config")
    async def config():
        value = POLICIES["publicConfig"]
        return private_json({**value, "features": {**value["features"], "realtime": settings.env.get("YINGXIANG_STUDIO_ENABLED") == "true" and bool(settings.env.get("DECART_API_KEY", "").strip())}})

    @app.get("/api/v1/health")
    async def health():
        return private_json({"status": "ok", "application": "yingxiang", "mode": "real", "providerReady": False, "storageReady": False})

    async def disabled():
        return error_response(BusinessError("SERVICE_DISABLED", "账号与会话服务尚未启用。", 503))

    for path in ("/api/v1/access/redeem", "/api/v1/sessions", "/api/v1/sessions/{ident}/token", "/api/v1/sessions/{ident}/heartbeat", "/api/v1/sessions/{ident}/end"):
        app.add_api_route(path, disabled, methods=["POST"])
    # Next 自动派生的 HEAD/OPTIONS 也属于合同；仅 GET 能派生 HEAD。
    allowed = {}
    for route in list(app.router.routes):
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set())
        if not path.startswith("/api/"):
            continue
        if "GET" in methods:
            app.add_api_route(path, route.endpoint, methods=["HEAD"], include_in_schema=False)
        if path.startswith(("/api/account/", "/api/payments/")) and "{" not in path:
            continue  # 这两组原来是 GET/POST 动态 action 路由。
        allowed.setdefault(path, set()).update(methods)
    def options_handler(value):
        async def options_response():
            return Response(status_code=204, headers={"Allow": value})
        return options_response
    for path, methods in allowed.items():
        if "GET" in methods:
            methods.add("HEAD")
        methods.add("OPTIONS")
        app.add_api_route(path, options_handler(", ".join(sorted(methods))), methods=["OPTIONS"], include_in_schema=False)
    # 精确路径先注册，再加动态 fallback，防止吞掉合法支付路由。
    fallback = [r for r in app.router.routes if getattr(r, "endpoint", None) is unknown_action]
    app.router.routes[:] = [r for r in app.router.routes if r not in fallback] + fallback
    from .schemas import extend_openapi
    extend_openapi(app)
    return app
