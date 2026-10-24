from dataclasses import dataclass, field
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4
import hashlib
import hmac
import json
import os
import re
import time

from dotenv import dotenv_values
from fastapi import Request
from starlette.responses import JSONResponse

ROOT = Path(__file__).resolve().parents[1]
DURATIONS = (15, 30, 60)
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
HEX64 = re.compile(r"^[a-f0-9]{64}$")
COOKIE = "yingxiang_session"
SESSION_MS = 7 * 24 * 60 * 60 * 1000


def now_ms():
    return time.time_ns() // 1_000_000


def iso(ms=None):
    return datetime.fromtimestamp((now_ms() if ms is None else ms) / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def millis(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def js_length(value):
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def node_utf8(value):
    # JS TextEncoder 将未配对的代理项替换为 U+FFFD。
    return value.encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="replace").encode("utf-8")


def password_hash(password, salt):
    return hashlib.scrypt(node_utf8(password), salt=salt.encode(), n=16384, r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024).hex()


class BusinessError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status


def private_json(value, status=200, headers=None):
    return JSONResponse(value, status_code=status, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", **(headers or {})})


def error_response(error):
    return private_json({"error": {"code": error.code, "message": error.message, "retryable": False}, "requestId": str(uuid4())}, error.status)


@dataclass(frozen=True)
class Settings:
    data_dir: Path = ROOT / "data"
    public_origin: str = "http://127.0.0.1:8787"
    allowed_origins: tuple[str, ...] = ("http://127.0.0.1:8787", "http://localhost:8787")
    maintenance: bool = True
    journal_mode: str = "DELETE"
    env: dict = field(default_factory=dict, repr=False)

    @classmethod
    def load(cls):
        env = {**dotenv_values(ROOT / ".env"), **os.environ}
        origin = env.get("PUBLIC_ORIGIN", "http://127.0.0.1:8787")
        allowed = tuple(env.get("ALLOWED_ORIGINS", "http://127.0.0.1:8787,http://localhost:8787").split(","))
        from urllib.parse import urlsplit
        for item in allowed:
            parsed = urlsplit(item)
            if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
                raise ValueError("无效的公共 Origin 配置")
        if origin not in allowed:
            raise ValueError("PUBLIC_ORIGIN 必须位于 ALLOWED_ORIGINS")
        mode = env.get("SQLITE_JOURNAL_MODE", "DELETE").upper()
        if mode not in ("DELETE", "WAL"):
            raise ValueError("无效的 SQLite journal mode")
        return cls((ROOT / env.get("DATA_DIR", "data")).resolve(), origin, allowed, env.get("MAINTENANCE", "true") == "true", mode, env)

    @property
    def database(self):
        return self.data_dir / "yingxiang.sqlite3"


def local_origin(request: Request, settings: Settings, mutation=False):
    # 代理保留外部 Host；不接受 X-Forwarded-* 作为身份/来源证据。
    from urllib.parse import urlsplit
    host = request.headers.get("host", "")
    candidates = [v for v in settings.allowed_origins if urlsplit(v).netloc == host]
    origin = next((v for v in candidates if v.startswith(request.url.scheme + ":")), candidates[0] if len(candidates) == 1 else "")
    if origin not in settings.allowed_origins or request.headers.get("sec-fetch-site") == "cross-site":
        raise BusinessError("LOCAL_ONLY", "此验证入口仅允许本机页面访问。", 403)
    sent = request.headers.get("origin")
    if (mutation or sent is not None) and sent != origin:
        raise BusinessError("ORIGIN_REJECTED", "页面来源不符，请从本机验证入口重新打开。", 403)
    return origin


async def bounded_body(request, limit=4096, timeout=30):
    import asyncio
    chunks, size = [], 0
    try:
        async with asyncio.timeout(timeout):
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise BusinessError("BODY_TOO_LARGE", "请求内容过大。", 413)
                chunks.append(chunk)
    except TimeoutError:
        raise BusinessError("INVALID_REQUEST", "请求内容无法读取。") from None
    return b"".join(chunks)


async def read_json(request, content_type=False):
    if content_type and request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise BusinessError("INVALID_REQUEST", "请使用JSON请求。", 415)
    try:
        value = json.loads((await bounded_body(request)).decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise BusinessError("INVALID_REQUEST", "请求内容无法读取。") from None


def session_hash(request):
    # 与原 Node Cookie 解析保持一致：首个匹配项，不进行 URL 解码。
    for item in request.headers.get("cookie", "").split(";"):
        if item.strip().startswith(COOKIE + "="):
            token = item.strip()[len(COOKIE) + 1:]
            return digest(token) if HEX64.fullmatch(token) else ""
    return ""


def check_access(supplied, expected, prompt=False):
    if not HEX64.fullmatch(supplied or "") or not hmac.compare_digest(supplied, expected):
        raise BusinessError("PROMPT_UNAUTHORIZED" if prompt else "UNAUTHORIZED", "编辑访问凭据无效，请刷新页面。" if prompt else "本地验证凭据无效，请刷新验证页面。", 401)
