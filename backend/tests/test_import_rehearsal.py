"""M21-a 源校验与媒体计划单元测试；不连接 PostgreSQL、不读取正式数据。"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3

import pytest

from ops.errors import SourceError, TargetError
from ops.source import Source
from ops.synthetic import (
    GRANT_15, USER_A, USER_B, WORK_DELETED, WORK_EDIT, WORK_VIDEO, build,
)
from ops.target import Target


@pytest.fixture()
def source_root(tmp_path: Path) -> Path:
    return build(tmp_path / "source")


def mutate(root: Path, statement: str, params: tuple[object, ...] = ()) -> None:
    with sqlite3.connect(root / "yingxiang.sqlite3") as db:
        db.execute(statement, params)
        db.commit()


def test_inventory_counts_media_and_fingerprint(source_root: Path) -> None:
    source = Source.load(source_root)
    assert len(source.rows["users"]) == 2
    assert len(source.rows["orders"]) == 4
    assert len(source.rows["works"]) == 6
    assert len(source.rows["usage_attempts"]) == 4
    assert len(source.media) == 8
    roles = {item.role for item in source.media}
    assert roles == {"result", "reference", "chunk", "prompts"}
    assert source.summary()["unknownAttempts"] == 1
    assert source.summary()["unknownVideoJobs"] == 1
    assert source.summary()["deletedWorks"] == 1
    assert source.fingerprint == Source.load(source_root).fingerprint
    assert source.table_hashes["works"] == Source.load(source_root).table_hashes["works"]


def test_unknown_table_rejected(source_root: Path) -> None:
    mutate(source_root, "CREATE TABLE surprise (x TEXT)")
    with pytest.raises(SourceError) as error:
        Source.load(source_root)
    assert error.value.code == "SOURCE_TABLE_SET_MISMATCH"


def test_wrong_revision_rejected(source_root: Path) -> None:
    mutate(source_root, "UPDATE alembic_version SET version_num='0005'")
    with pytest.raises(SourceError) as error:
        Source.load(source_root)
    assert error.value.code == "SOURCE_REVISION_INVALID"


def test_dynamic_type_rejected(source_root: Path) -> None:
    mutate(source_root, "UPDATE users SET created_at='not-an-int' WHERE id=?", (USER_A,))
    with pytest.raises(SourceError) as error:
        Source.load(source_root)
    assert error.value.code == "SOURCE_TYPE_INVALID:users.created_at"


def test_ledger_mismatch_rejected(source_root: Path) -> None:
    mutate(source_root, "UPDATE entitlement_grants SET reserved=2, used=1 WHERE id=?", (GRANT_15,))
    with pytest.raises(SourceError) as error:
        Source.load(source_root)
    assert error.value.code == "GRANT_LEDGER_INVALID"


def test_deleted_tombstone_with_media_rejected(source_root: Path) -> None:
    directory = source_root / "users" / USER_A / "works" / WORK_DELETED
    directory.mkdir(parents=True)
    (directory / "result.mp4").write_bytes(b"resurrected")
    with pytest.raises(SourceError) as error:
        Source.load(source_root)
    assert error.value.code == "SOURCE_DELETED_MEDIA_PRESENT"


def test_orphan_media_rejected(source_root: Path) -> None:
    (source_root / "users" / USER_A / "works" / WORK_VIDEO / "orphan.bin").write_bytes(b"orphan")
    with pytest.raises(SourceError) as error:
        Source.load(source_root)
    assert error.value.code == "SOURCE_MEDIA_ORPHAN_FILE"


def test_prompts_invalid_rejected(source_root: Path) -> None:
    (source_root / "users" / USER_B / "works" / WORK_EDIT / "prompts.json").write_text(
        json.dumps([{"atMs": 5, "instructions": []}]), encoding="utf-8"
    )
    with pytest.raises(SourceError) as error:
        Source.load(source_root)
    assert error.value.code == "SOURCE_PROMPTS_INVALID"


def test_formal_target_schema_rejected_before_connect(source_root: Path, tmp_path: Path) -> None:
    source = Source.load(source_root)
    with pytest.raises(TargetError) as error:
        Target(source, "postgresql://127.0.0.1:1/none", "yingxiang_migration",
               tmp_path / "volume", "batch-1")
    assert error.value.code == "TARGET_SCHEMA_NOT_ISOLATED"


def test_cli_inventory_and_dry_run(source_root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from ops.__main__ import main

    assert main(["inventory", "--source", str(source_root)]) == 0
    inventory = json.loads(capsys.readouterr().out)
    assert inventory["ok"] is True and inventory["writes"] is False
    assert inventory["files"] == 8
    assert main(["dry-run", "--source", str(source_root)]) == 0
    dry_run = json.loads(capsys.readouterr().out)
    assert dry_run["mode"] == "dry-run" and dry_run["writes"] is False
