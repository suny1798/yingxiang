import json
import math
import secrets
import asyncio
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select, insert, update, func
from starlette.concurrency import run_in_threadpool

from .accounts import one
from .core import BusinessError, DURATIONS, UUID, now_ms, iso, millis, check_access
from .models import access, attempts, reservations, campaigns, jobs, users, video_history

POLICIES = json.loads((Path(__file__).resolve().parents[1] / "contracts/node-fixtures.json").read_text(encoding="utf-8"))
STUDIO = POLICIES["studio"]
PROMPT = POLICIES["prompt"]
VIDEO = POLICIES["video"]
TOKEN_URL = "https://api.decart.ai/v1/client/tokens"
JOB_URL = "https://api.decart.ai/v1/jobs"


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


class Generation:
    def __init__(self, db, accounts, settings, client):
        self.db, self.accounts, self.settings, self.client = db, accounts, settings, client

    def key(self):
        return self.settings.env.get("DECART_API_KEY", "").strip()

    def nonce(self, scene):
        with self.db.transaction(True) as session:
            row = one(session, access, access.c.scene == scene)
            if row:
                return row["value"]
            value = secrets.token_hex(32)
            session.execute(insert(access).values(scene=scene, value=value))
            return value

    def studio_status(self):
        enabled, key = self.settings.env.get("YINGXIANG_STUDIO_ENABLED") == "true", bool(self.key())
        return {"enabled": enabled, "keyConfigured": key, "available": enabled and key, "policy": STUDIO, "state": "disabled" if not enabled else "missing-key" if not key else "ready", **({"access": self.nonce("studio")} if enabled and key else {})}

    def config(self, scene):
        e = self.settings.env
        try:
            budget = float(e.get(f"YINGXIANG_{scene.upper()}_BUDGET_USD", "0"))
            maximum = float(e.get(f"YINGXIANG_{scene.upper()}_MAX_" + ("SESSIONS" if scene == "prompt" else "JOBS"), "0"))
        except ValueError:
            budget = maximum = 0
        enabled = e.get(f"YINGXIANG_{scene.upper()}_ENABLED") == "true" and (0.3 if scene == "prompt" else 0) <= budget <= 5 and budget > 0 and maximum.is_integer() and 0 < maximum <= 20
        return {"enabled": enabled and bool(self.key()), "budget": round(budget * 1_000_000) if math.isfinite(budget) else 0, "max": int(maximum) if math.isfinite(maximum) else 0}

    def scene_allowed(self, session, scene, user_id):
        names = {name.strip() for name in self.settings.env.get(f"YINGXIANG_{scene.upper()}_ALLOWED_USERNAMES", "").split(",") if name.strip()}
        if not names:
            return True
        username = session.execute(select(users.c.username).where(users.c.id == user_id)).scalar_one_or_none() if user_id else None
        return username in names

    def prompt_ready(self, session, user_id=None):
        config = self.config("prompt")
        rows = session.execute(select(attempts).where(attempts.c.scene == "prompt")).mappings().all()
        reserved = session.execute(select(reservations).where(reservations.c.scene == "prompt")).mappings().all()
        if not config["enabled"]:
            return {"available": False, "message": "实时编辑待开放，可先准备提示词与相机预览。"}
        if not self.scene_allowed(session, "prompt", user_id):
            return {"available": False, "message": "实时编辑目前仅向指定测试账号开放。"}
        if any(row["state"] == "unknown" for row in rows):
            return {"available": False, "message": "上次连接申请待核查，请联系开发者，勿重复尝试。"}
        if any(row["lease_until"] > now_ms() for row in reserved):
            return {"available": False, "message": "连接窗口尚未结束，请稍后刷新状态。"}
        if len(rows) >= config["max"] or sum(row["micro_usd"] for row in reserved) + 300_000 > config["budget"]:
            return {"available": False, "message": "本轮实时编辑额度已用完。"}
        return {"available": True, "message": "实时编辑已就绪，每次最多15秒。"}

    def prompt_status(self, user_id):
        with self.db.transaction() as session:
            value = self.prompt_ready(session, user_id)
        if value["available"] and user_id:
            value["access"] = self.nonce("prompt")
        return value

    def authenticate(self, scene, supplied):
        prompt = scene == "prompt"
        enabled = self.config("prompt")["enabled"] if prompt else self.settings.env.get("YINGXIANG_STUDIO_ENABLED") == "true" and bool(self.key())
        if not enabled:
            raise BusinessError("PROMPT_DISABLED" if prompt else "SERVICE_DISABLED", "实时编辑尚未开放。" if prompt else "请先在服务端配置密钥并启用本机验证。", 503)
        check_access(supplied, self.nonce(scene), prompt)

    def reserve_token(self, scene, hashed, body):
        prompt = scene == "prompt"
        ident = body.get("attemptId")
        allowed = {"attemptId", "consentVersion", "durationSec"}
        if (set(body) != allowed if prompt else set(body) not in (allowed, allowed - {"durationSec"})) or not isinstance(ident, str) or not UUID.fullmatch(ident) or body.get("consentVersion") != (PROMPT if prompt else STUDIO)["consentVersion"]:
            raise BusinessError("INVALID_PROMPT_SESSION" if prompt else "INVALID_REQUEST", "连接参数或云端确认无效。" if prompt else "体验编号或云端处理确认无效，请重新确认。")
        seconds = body.get("durationSec", 15)
        if not number(seconds) or seconds not in ((15,) if prompt else DURATIONS):
            raise BusinessError("INVALID_PROMPT_SESSION" if prompt else "INVALID_DURATION", "连接参数或云端确认无效。" if prompt else "请选择15秒、30秒或1分钟。")
        with self.db.transaction(True) as session:
            if prompt:
                user = self.accounts.user(session, hashed, True)
                if one(session, attempts, attempts.c.id == ident):
                    raise BusinessError("PROMPT_ATTEMPT_SPENT", "这个连接已申请，请核查状态，不要重复提交。", 409)
                status = self.prompt_ready(session, user["id"])
                if not status["available"]:
                    raise BusinessError("PROMPT_LIMIT", status["message"], 409)
                if not one(session, campaigns, campaigns.c.scene == scene):
                    session.execute(insert(campaigns).values(scene=scene, created_at=now_ms()))
                session.execute(insert(attempts).values(id=ident, user_id=user["id"], scene=scene, seconds=15, state="unknown", created_at=now_ms()))
                session.execute(insert(reservations).values(id=ident, scene=scene, user_id=user["id"], micro_usd=300_000, lease_until=now_ms() + 30_000, created_at=now_ms()))
            else:
                self.accounts.reserve(session, hashed, ident, seconds)
        return ident, int(seconds)

    async def small_json(self, response, limit=16384):
        if not response.is_success:
            raise ValueError("上游拒绝")
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit:
                raise ValueError("上游响应过大")
            chunks.append(chunk)
        value = json.loads(b"".join(chunks))
        if not isinstance(value, dict):
            raise ValueError("上游响应异常")
        return value

    async def issue(self, scene, hashed, body, origin):
        prompt = scene == "prompt"
        ident, seconds = await run_in_threadpool(self.reserve_token, scene, hashed, body)
        start, model = now_ms(), (PROMPT if prompt else STUDIO)["model"]
        try:
            async with asyncio.timeout(10):
                async with self.client.stream("POST", TOKEN_URL, headers={"X-API-KEY": self.key()}, json={"expiresIn": 10, "allowedModels": [model], "allowedOrigins": [origin], "constraints": {"realtime": {"maxSessionDuration": seconds}}}, timeout=10) as response:
                    token = await self.small_json(response)
            expiry = millis(token["expiresAt"])
            if not isinstance(token.get("apiKey"), str) or len(token["apiKey"]) < 10 or token["apiKey"] == self.key() or not now_ms() < expiry <= start + 15_000 or token.get("permissions", {}).get("models") != [model] or token.get("permissions", {}).get("origins") != [origin] or token.get("constraints", {}).get("realtime", {}).get("maxSessionDuration") != seconds:
                raise ValueError("上游权限未确认")
            if prompt:
                await run_in_threadpool(self.mark_prompt_issued, ident)
            else:
                await run_in_threadpool(self.accounts.issued, ident)
            return {"apiKey": token["apiKey"], "expiresAt": token["expiresAt"], "durationSec": seconds}
        except Exception:
            raise BusinessError("PROMPT_TOKEN_UNKNOWN" if prompt else "TOKEN_RESULT_UNKNOWN", "连接凭据未能安全取得，请核对供应商用量并联系开发者；不会自动重试。" if prompt else "令牌未能安全取得。请检查模型权限、余额和网络并核对用量；本轮不自动重试。", 503) from None

    def mark_prompt_issued(self, ident):
        with self.db.transaction(True) as session:
            session.execute(update(attempts).where(attempts.c.id == ident, attempts.c.scene == "prompt").values(state="issued", updated_at=now_ms()))

    def observe(self, user_id, body):
        ident = body.get("attemptId")
        fields = {"attemptId", "firstFrameMs", "localTracksEnded", "outcome", "providerReportedSeconds"}
        if set(body) != fields or not isinstance(ident, str) or not UUID.fullmatch(ident) or body.get("outcome") not in ("ended", "error") or type(body.get("localTracksEnded")) is not bool:
            raise BusinessError("INVALID_REQUEST", "观测记录无效。")
        for key in ("firstFrameMs", "providerReportedSeconds"):
            value = body[key]
            if value is not None and (not number(value) or not 0 <= value <= 120_000):
                raise BusinessError("INVALID_REQUEST", "观测数值无效。")
        with self.db.transaction(True) as session:
            row = one(session, attempts, (attempts.c.id == ident) & (attempts.c.user_id == user_id) & (attempts.c.scene == "studio"))
            if not row or row["state"] == "reserved":
                raise BusinessError("ATTEMPT_NOT_FOUND", "没有可归属的测试记录。", 409)
            if row["observation"]:
                return
            session.execute(update(attempts).where(attempts.c.id == ident).values(observation=json.dumps({k: v for k, v in body.items() if k != "attemptId"}), outcome=body["outcome"], state="finished" if row["state"] == "issued" else row["state"], updated_at=now_ms()))

    @staticmethod
    def job_view(row):
        return {"id": row["id"], "state": row["state"], "createdAt": iso(row["created_at"]), "expiresAt": iso(row["expires_at"]), "seconds": row["seconds_milli"] / 1000, "estimateUsd": row["micro_usd"] / 1_000_000, "expired": now_ms() >= row["expires_at"]}

    def video_status(self, user_id):
        config = self.config("video")
        with self.db.transaction() as session:
            rows = session.execute(select(jobs).order_by(jobs.c.created_at, jobs.c.id)).mappings().all()
            active = any(r["state"] not in ("completed", "failed") for r in rows)
            remaining = config["budget"] - sum(r["micro_usd"] for r in rows)
            archived = set(session.execute(select(video_history.c.job_id).where(video_history.c.archived == 1)).scalars())
            allowed = self.scene_allowed(session, "video", user_id)
            available = allowed and config["enabled"] and remaining >= 40_000 and len(rows) < config["max"] and not active
            return {"available": available, "message": "视频换装目前仅向指定测试账号开放。" if config["enabled"] and not allowed else "视频生成待开放，可先预览素材。" if not config["enabled"] else "有任务正在处理或待核查，请先查看任务。" if active else "本轮视频额度已用完，请联系开发者。" if not available else "本轮视频生成已开放。", "jobs": [self.job_view(r) for r in list(reversed([r for r in rows if r["user_id"] == user_id and r["id"] not in archived][-20:]))]}

    def own_job(self, user_id, ident):
        with self.db.transaction() as session:
            row = one(session, jobs, (jobs.c.id == ident) & (jobs.c.user_id == user_id))
            if not row:
                raise BusinessError("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404)
            return dict(row)

    def previous_job(self, user_id, ident):
        with self.db.transaction() as session:
            row = one(session, jobs, jobs.c.id == ident)
            if row and row["user_id"] != user_id:
                raise BusinessError("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404)
            return self.job_view(row) if row else None

    def reserve_job(self, user_id, ident, seconds):
        config = self.config("video")
        estimate = math.ceil(seconds) * 40_000
        with self.db.transaction(True) as session:
            if not config["enabled"] or not self.scene_allowed(session, "video", user_id):
                raise BusinessError("VIDEO_DISABLED", "视频换装目前仅向指定测试账号开放。", 503)
            row = one(session, jobs, jobs.c.id == ident)
            if row:
                if row["user_id"] != user_id:
                    raise BusinessError("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404)
                return dict(row), False
            rows = session.execute(select(jobs)).mappings().all()
            if any(r["state"] not in ("completed", "failed") for r in rows):
                raise BusinessError("VIDEO_IN_PROGRESS", "请等待现有任务完成或核查，不要重复提交。", 409)
            if len(rows) >= config["max"] or sum(r["micro_usd"] for r in rows) + estimate > config["budget"]:
                raise BusinessError("VIDEO_BUDGET_LIMIT", "本轮视频额度不足，请联系开发者。", 409)
            row = {"id": ident, "user_id": user_id, "state": "unknown", "created_at": now_ms(), "expires_at": now_ms() + VIDEO["resultWindowMs"], "seconds_milli": math.ceil(seconds * 1000), "micro_usd": estimate}
            if not one(session, campaigns, campaigns.c.scene == "video"):
                session.execute(insert(campaigns).values(scene="video", created_at=now_ms()))
            session.execute(insert(jobs).values(**row))
            session.execute(insert(reservations).values(id=ident, scene="video", user_id=user_id, micro_usd=estimate, lease_until=row["expires_at"], created_at=row["created_at"]))
            return row, True

    async def submit_video(self, user_id, ident, video, image, mime, seconds):
        row, fresh = await run_in_threadpool(self.reserve_job, user_id, ident, seconds)
        if not fresh:
            return self.job_view(row)
        provider = None
        try:
            async with asyncio.timeout(60):
                async with self.client.stream("POST", f"{JOB_URL}/{VIDEO['model']}", headers={"X-API-KEY": self.key()}, files={"data": ("person.mp4", video, "video/mp4"), "reference_image": ("garment." + {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[mime], image, mime)}, data={"prompt": VIDEO["prompt"], "resolution": "720p", "enhance_prompt": "false"}, timeout=60) as response:
                    value = await self.small_json(response, 8192)
            import re
            if isinstance(value.get("job_id"), str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", value["job_id"]) and value.get("status") in ("pending", "processing", "completed", "failed"):
                provider = value
        except Exception:
            pass  # 已持久化 unknown，不重试生成 POST。
        if provider:
            await run_in_threadpool(self.bind_job, ident, provider)
        return self.job_view(await run_in_threadpool(self.own_job, user_id, ident))

    def bind_job(self, ident, value):
        with self.db.transaction(True) as session:
            session.execute(update(jobs).where(jobs.c.id == ident).values(provider_id=value["job_id"], state=value["status"]))

    def prepare_poll(self, user_id, ident):
        with self.db.transaction(True) as session:
            row = one(session, jobs, (jobs.c.id == ident) & (jobs.c.user_id == user_id))
            if not row:
                raise BusinessError("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404)
            check = bool(row["provider_id"]) and row["state"] in ("pending", "processing") and now_ms() < row["expires_at"] and now_ms() - (row["checked_at"] or 0) >= 3000
            if check:
                session.execute(update(jobs).where(jobs.c.id == ident).values(checked_at=now_ms()))
            return dict(row), check

    async def get_video(self, user_id, ident):
        row, check = await run_in_threadpool(self.prepare_poll, user_id, ident)
        if check:
            try:
                async with asyncio.timeout(15):
                    async with self.client.stream("GET", f"{JOB_URL}/{row['provider_id']}", headers={"X-API-KEY": self.key()}, timeout=15) as response:
                        value = await self.small_json(response, 8192)
                if value.get("job_id") != row["provider_id"] or value.get("status") not in ("pending", "processing", "completed", "failed"):
                    raise ValueError()
                await run_in_threadpool(self.apply_poll, ident, value["status"])
            except Exception:
                raise BusinessError("VIDEO_STATUS_UNAVAILABLE", "暂时无法更新进度，稍后可刷新任务；请勿重复提交。", 502) from None
            row = await run_in_threadpool(self.own_job, user_id, ident)
        return self.job_view(row)

    def apply_poll(self, ident, state):
        with self.db.transaction(True) as session:
            row = one(session, jobs, jobs.c.id == ident)
            if row["state"] in ("pending", "processing") and not (row["state"] == "processing" and state == "pending"):
                session.execute(update(jobs).where(jobs.c.id == ident).values(state=state))
