from dataclasses import replace
from pathlib import Path
from uuid import uuid4
from contextlib import closing
import base64
import json
import os
import sqlite3
import subprocess
import sys

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func, text

from app.accounts import Accounts
from app.core import iso, now_ms, digest, password_hash
from app.db import Database
from app.legacy import import_snapshot, source_manifest
from app.main import create_app
from app.media import inspect_video, validate_image
from app.models import users, grants, reservations, imports, attempts, orders
from scripts.ops import backup, integrity
from conftest import initialize, signup

VIDEO = Path(__file__).resolve().parents[2] / "frontend/public/assets/try-on-demo.mp4"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")


@pytest.fixture
def source(tmp_path):
    root = tmp_path / "legacy"
    for scene in ("accounts", "studio", "prompt", "video-jobs"):
        (root / scene).mkdir(parents=True)
    uid, aid, pid, oid = (str(uuid4()) for _ in range(4))
    salt = "00112233445566778899aabbccddeeff"
    token = "a" * 64
    data = {"version": 1, "users": [{"id": uid, "username": "legacy_user", "salt": salt, "passwordHash": password_hash("test-password-only", salt), "createdAt": iso(1000)}],
        "sessions": [{"hash": digest(token), "userId": uid, "expiresAt": now_ms() + 60_000}], "attempts": [{"id": aid, "userId": uid, "createdAt": iso(2000), "state": "used", "outcome": "ended"}], "limits": {"auth:legacy_user": {"count": 2, "until": now_ms() + 100_000}}, "quotas": {uid: 4}, "durationQuotas": {uid: {"60": 2}},
        "paymentOrders": [{"id": oid, "userId": uid, "requestId": str(uuid4()), "sku": "tryon-v1-15-5", "seconds": 15, "count": 5, "amount": 2990, "currency": "cny", "createdAt": iso(3000), "state": "paid", "sessionId": "cs_fixture", "fulfilledAt": iso(4000)}], "paymentEvents": ["evt_legacy"], "sandboxGrants": {uid: {"15": 5}}}
    def write(path, data):
        (root / path).write_text(json.dumps(data), encoding="utf-8")
    write("accounts/store.json", data)
    write(f"studio/{aid}.json", {"attemptId": aid, "userId": uid, "state": "finished", "createdAt": iso(2000), "model": "lucy-vton-3.6", "connectionCapSec": 15, "observation": {"outcome": "ended", "firstFrameMs": None, "providerReportedSeconds": None, "localTracksEnded": True}})
    write("prompt/limits.json", {"version": 1, "attempts": [{"id": pid, "userId": uid, "state": "issued", "createdAt": iso(5000), "leaseUntil": now_ms() + 30000, "estimateUsd": 0.3}]})
    write("video-jobs/jobs.json", {"version": 1, "jobs": []})
    (root / "studio/access").write_text("b" * 64, encoding="utf-8")
    return root, data, token


def test_import_exact_balances_credentials_sessions_budget_and_repeat(settings, source):
    root, data, token = source
    fingerprint = source_manifest(root)[0]
    initialize(settings)
    db = Database(settings.database)
    result = import_snapshot(db, root, settings.public_origin)
    view = Accounts(db).me(digest(token))
    assert view["user"]["id"] == data["users"][0]["id"]
    assert view["trialLimit"] == 4  # 总量，不叠加默认赠送。
    assert view["trialRemaining"] == 3
    assert view["durations"][2]["remaining"] == 2
    assert view["history"][0]["durationSec"] == 15
    before = db_rows(db)
    assert import_snapshot(db, root, settings.public_origin)["alreadyImported"]
    assert db_rows(db) == before
    assert source_manifest(root)[0] == fingerprint
    account, _ = Accounts(db).authenticate({"username": "legacy_user", "password": "test-password-only"}, False)
    assert account["trialRemaining"] == 3
    with db.transaction() as session:
        assert session.execute(select(reservations.c.micro_usd)).scalar_one() == 300_000
    db.close()


def db_rows(db):
    with db.transaction() as session:
        return {table.name: [dict(row) for row in session.execute(select(table)).mappings()] for table in (users, grants, attempts, reservations, orders, imports)}


@pytest.mark.parametrize("fault", ["extra_field", "overuse", "sandbox", "duplicate_user", "orphan", "broken_json", "missing_scene", "left_lock", "unknown_checkout"])
def test_import_rejects_loss_or_inflation_rolls_back(settings, source, fault):
    root, data, _ = source
    if fault == "extra_field":
        data["futureField"] = True
    elif fault == "overuse":
        data["quotas"][data["users"][0]["id"]] = 1
        data["attempts"] *= 2
    elif fault == "sandbox":
        data["sandboxGrants"] = {}
    elif fault == "duplicate_user":
        data["users"] *= 2
    elif fault == "orphan":
        data["attempts"][0]["userId"] = str(uuid4())
    elif fault == "unknown_checkout":
        data["paymentOrders"][0].update(state="creating", sessionId=None, fulfilledAt=None)
    elif fault == "missing_scene":
        (root / "prompt/limits.json").unlink()
    elif fault == "left_lock":
        (root / "accounts/store.lock").write_text("locked")
    (root / "accounts/store.json").write_text("invalid" if fault == "broken_json" else json.dumps(data), encoding="utf-8")
    initialize(settings)
    db = Database(settings.database)
    with pytest.raises(Exception):
        import_snapshot(db, root, settings.public_origin)
    with db.transaction() as session:
        assert session.execute(select(func.count()).select_from(users)).scalar_one() == 0
        assert session.execute(select(func.count()).select_from(imports)).scalar_one() == 0
    db.close()


def test_backup_restore_and_abrupt_process_exit(settings, source, tmp_path):
    root, _, _ = source
    initialize(settings)
    db = Database(settings.database)
    import_snapshot(db, root, settings.public_origin)
    before = db_rows(db)
    script = "from pathlib import Path; import os,sys; from app.db import Database; from app.models import users; from sqlalchemy import insert; db=Database(Path(sys.argv[1])); ctx=db.transaction(True); s=ctx.__enter__(); s.execute(insert(users).values(id='crashed',username='crashed',salt='x',password_hash='x',created_at=0)); os._exit(19)"
    result = subprocess.run([sys.executable, "-c", script, str(settings.database)], cwd=Path(__file__).resolve().parents[1], capture_output=True)
    assert result.returncode == 19
    assert db_rows(db) == before
    target, restored = tmp_path / "backup.sqlite3", tmp_path / "restored.sqlite3"
    backup(settings.database, target)
    backup(target, restored)
    integrity(restored)
    recovered = Database(restored)
    assert db_rows(recovered) == before
    with pytest.raises(ValueError):
        backup(target, restored)
    recovered.close()
    db.close()


def test_two_processes_compete_for_last_trial(settings):
    initialize(settings)
    db = Database(settings.database)
    Accounts(db).authenticate({"username": "process_fixture", "password": "test-password-only"}, True)
    script = "from pathlib import Path; import sys; from uuid import uuid4; from sqlalchemy import select; from app.db import Database; from app.accounts import Accounts; from app.models import sessions; from app.core import BusinessError; db=Database(Path(sys.argv[1])); a=Accounts(db)\ntry:\n with db.transaction(True) as s:\n  hashed=s.execute(select(sessions.c.hash)).scalar_one(); a.reserve(s,hashed,str(uuid4()),15)\n print('reserved')\nexcept BusinessError as e: print(e.code)\nfinally: db.close()"
    cwd = Path(__file__).resolve().parents[1]
    procs = [subprocess.Popen([sys.executable, "-c", script, str(settings.database)], cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(2)]
    outputs = [proc.communicate(timeout=20)[0].strip() for proc in procs]
    assert all(proc.returncode == 0 for proc in procs)
    assert sorted(outputs) == ["TRIAL_USED", "reserved"]
    db.close()


def test_mp4_cross_language_fixture_and_malformed_boundaries():
    data = VIDEO.read_bytes()
    assert inspect_video(data) == {"seconds": 9, "width": 1280, "height": 720}
    audio = data.replace(b"vide", b"soun", 1)
    with pytest.raises(ValueError, match="音轨"):
        inspect_video(audio)
    for n in range(40):
        with pytest.raises(ValueError):
            inspect_video(data[:n * 53])
    validate_image(PNG, "image/png")
    with pytest.raises(ValueError):
        validate_image(PNG, "image/jpeg")


def test_video_memory_upload_unknown_idempotency_and_isolation(settings, tmp_path, monkeypatch):
    calls = []
    def upstream(request):
        calls.append(request)
        raise httpx.ReadTimeout("合成超时")
    env = {"DECART_API_KEY": "fixture_key", "YINGXIANG_VIDEO_ENABLED": "true", "YINGXIANG_VIDEO_BUDGET_USD": "1", "YINGXIANG_VIDEO_MAX_JOBS": "2"}
    settings = replace(settings, env=env)
    initialize(settings)
    app = create_app(settings, transport=httpx.MockTransport(upstream))
    # 任何 tempfile 路径都不应出现在上传链路；拦截创建会直接让测试失败。
    import tempfile
    def forbidden(*args, **kwargs):
        raise AssertionError("媒体尝试落盘")
    with TestClient(app, base_url=settings.public_origin) as client:
        client.headers["origin"] = settings.public_origin
        signup(client)
        monkeypatch.setattr(tempfile, "TemporaryFile", forbidden)
        monkeypatch.setattr(tempfile, "NamedTemporaryFile", forbidden)
        monkeypatch.setattr(tempfile, "SpooledTemporaryFile", forbidden)
        ident = str(uuid4())
        files = {"data": ("private-name.mp4", VIDEO.read_bytes(), "video/mp4"), "reference_image": ("private-name.png", PNG, "image/png")}
        response = client.post("/api/video/jobs", files=files, data={"consentVersion": "2026-10-23-video-v1"}, headers={"x-video-attempt": ident})
        assert response.status_code == 200, response.text
        assert response.json()["state"] == "unknown"
        assert response.json()["estimateUsd"] == 0.36
        assert len(calls) == 1
        assert b"private-name" not in calls[0].content
        assert client.post("/api/video/jobs", headers={"x-video-attempt": ident}).json()["id"] == ident
        assert len(calls) == 1
        assert not client.get("/api/video/jobs").json()["available"]
        client.post("/api/account/logout")
        signup(client, "other_fixture")
        assert client.get(f"/api/video/jobs/{ident}").status_code == 404
        assert client.get("/api/video/jobs").json()["jobs"] == []
        assert client.post("/api/video/jobs", headers={"x-video-attempt": ident}).status_code == 404
    assert not list(tmp_path.glob("*.mp4")) and not list(tmp_path.glob("*.png"))
