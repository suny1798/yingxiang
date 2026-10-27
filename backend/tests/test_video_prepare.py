from pathlib import Path
import struct
import pytest
from app.media import inspect_video
from app.video_prepare import prepare_video

SOURCE = Path(__file__).resolve().parents[2] / "frontend/public/assets/try-on-demo.mp4"
MARKER = b"AUDIO_PRIVATE_BYTES_MUST_NEVER_REACH_MODEL" * 20


def atom(kind, value):
    return struct.pack(">I4s", len(value) + 8, kind) + value


def boxes(data):
    pos = 0
    while pos < len(data):
        size, kind = struct.unpack(">I4s", data[pos:pos + 8])
        yield kind, pos, data[pos + 8:pos + size]
        pos += size


def with_audio(data):
    """添加有独立数据的合成音轨容器；不涉及录音或人物素材。"""
    top = list(boxes(data))
    old_movie = next((pos, payload) for kind, pos, payload in top if kind == b"moov")
    first_mdat = next((pos, payload) for kind, pos, payload in top if kind == b"mdat")
    audio = atom(b"trak", atom(b"mdia", atom(b"hdlr", b"\0" * 8 + b"soun" + b"\0" * 12)))
    movie_end = old_movie[0] + len(old_movie[1]) + 8
    mdat_end = first_mdat[0] + len(first_mdat[1]) + 8
    def adjust(value):
        return value + (len(audio) if value >= movie_end else 0) + (len(MARKER) if value >= mdat_end else 0)
    def patch(payload):
        result = []
        for kind, _, value in boxes(payload):
            if kind in (b"trak", b"mdia", b"minf", b"stbl"):
                value = patch(value)
            elif kind in (b"stco", b"co64"):
                width, fmt = (8, ">Q") if kind == b"co64" else (4, ">I")
                count = struct.unpack(">I", value[4:8])[0]
                value = value[:8] + b"".join(struct.pack(fmt, adjust(int.from_bytes(value[8 + i * width:8 + (i + 1) * width], "big"))) for i in range(count))
            result.append(atom(kind, value))
        return b"".join(result)
    return b"".join(atom(kind, patch(payload) + audio if kind == b"moov" else payload + MARKER if kind == b"mdat" and pos == first_mdat[0] else payload) for kind, pos, payload in top)


def video_data(data):
    return b"".join(payload for kind, _, payload in boxes(data) if kind == b"mdat")


def test_audio_removed_physically_and_picture_bytes_preserved(tmp_path):
    original = SOURCE.read_bytes()
    audio = with_audio(original)
    assert inspect_video(audio, allow_audio=True)["hasAudio"] is True
    with pytest.raises(ValueError, match="音轨"):
        inspect_video(audio)
    prepared, info, removed = prepare_video(audio)
    assert removed is True
    assert MARKER not in prepared
    assert b"soun" not in prepared
    assert video_data(prepared) == video_data(original)
    assert info == inspect_video(original)
    assert inspect_video(prepared, allow_audio=True)["hasAudio"] is False
    (tmp_path / "prepared.mp4").write_bytes(prepared)  # 仅合成测试文件。


def test_no_audio_is_passthrough_and_corruption_rejected():
    original = SOURCE.read_bytes()
    assert prepare_video(original) == (original, inspect_video(original), False)
    audio = bytearray(with_audio(original))
    position = audio.index(b"stco") + 12
    audio[position:position + 4] = b"\xff" * 4
    with pytest.raises(ValueError):
        prepare_video(bytes(audio))


def test_prepare_endpoint_is_available_without_model_or_login(client):
    original = SOURCE.read_bytes()
    response = client.post("/api/video/prepare", content=with_audio(original), headers={"content-type": "video/mp4"})
    assert response.status_code == 200
    assert response.headers["x-video-audio-removed"] == "1"
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["cache-control"] == "no-store"
    assert MARKER not in response.content
    assert inspect_video(response.content) == inspect_video(original)
    assert response.headers["content-length"] == str(len(response.content))
    assert client.get("/api/account/me").json()["user"] is None


def test_prepare_rejects_wrong_origin_bad_type_and_invalid_file(client):
    assert client.post("/api/video/prepare", content=b"invalid", headers={"origin": "https://other.invalid", "content-type": "video/mp4"}).status_code == 403
    assert client.post("/api/video/prepare", content=b"invalid", headers={"content-type": "text/plain"}).status_code == 415
    assert client.post("/api/video/prepare", content=b"invalid", headers={"content-type": "video/mp4"}).status_code == 400


def test_prepare_busy_and_size_limit_release_slot(client):
    client.app.state.upload_busy = True
    assert client.post("/api/video/prepare", content=b"invalid", headers={"content-type": "video/mp4"}).status_code == 503
    client.app.state.upload_busy = False
    assert client.post("/api/video/prepare", content=b"x" * (25 * 1024 * 1024 + 1), headers={"content-type": "video/mp4"}).status_code == 413
    assert client.app.state.upload_busy is False

def test_audio_movie_tail_does_not_extend_video_duration():
    data = bytearray(with_audio(SOURCE.read_bytes()))
    p = data.index(b"mvhd") + 4
    scale = int.from_bytes(data[p + 12:p + 16], "big")
    data[p + 16:p + 20] = (20 * scale).to_bytes(4, "big")
    prepared, info, removed = prepare_video(bytes(data))
    assert removed and info["seconds"] == 9
    assert inspect_video(prepared)["seconds"] == 9


def test_generation_removes_audio_even_when_client_skips_prepare(settings):
    from dataclasses import replace
    from uuid import uuid4
    import httpx
    from fastapi.testclient import TestClient
    from app.main import create_app
    from conftest import initialize, signup
    from test_migration_media import PNG
    calls = []
    def upstream(request):
        calls.append(request)
        assert MARKER not in request.content
        assert b"soun" not in request.content
        raise httpx.ReadTimeout("合成超时")
    settings = replace(settings, env={"DECART_API_KEY": "fixture_key", "YINGXIANG_VIDEO_ENABLED": "true", "YINGXIANG_VIDEO_BUDGET_USD": "1", "YINGXIANG_VIDEO_MAX_JOBS": "2"})
    initialize(settings)
    with TestClient(create_app(settings, transport=httpx.MockTransport(upstream)), base_url=settings.public_origin) as client:
        client.headers["origin"] = settings.public_origin
        signup(client)
        result = client.post("/api/video/jobs", files={"data": ("synthetic.mp4", with_audio(SOURCE.read_bytes()), "video/mp4"), "reference_image": ("synthetic.png", PNG, "image/png")}, data={"consentVersion": "2026-10-26-video-save-v1"}, headers={"x-video-attempt": str(uuid4())})
        assert result.status_code == 200, result.text
        assert result.json()["state"] == "unknown"
        assert len(calls) == 1
