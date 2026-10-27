"""M02：合成数据库与媒体的联合恢复，不接触正式data目录。"""
import json
from dataclasses import replace
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from app.db import Database
from app.accounts import Accounts
from app.core import digest
from app.models import users
from sqlalchemy import update
from scripts.joint_snapshot import snapshot, verify, restore, database_state
from conftest import initialize


@pytest.fixture
def joint_source(settings):
    settings = replace(settings, data_dir=settings.data_dir / 'source')
    initialize(settings)
    db = Database(settings.database)
    account, token = Accounts(db).authenticate({'username': 'snapshot_owner', 'password': 'test-password-only'}, True)
    with db.transaction(True) as session:
        Accounts(db).reserve(session, digest(token), '10000000-0000-4000-8000-000000000001', 15)
        session.execute(update(users).where(users.c.id == account['user']['id']).values(role='admin'))
    db.close()
    files = settings.data_dir / 'users' / 'synthetic-user' / 'works' / 'synthetic-work'
    files.mkdir(parents=True)
    for name, value in {'result.webm': b'synthetic-video', 'reference-one.png': b'synthetic-reference',
                        'prompts.json': b'[{"atMs":0,"instructions":["synthetic-prompt"]}]', 'chunk-000001': b'partial'}.items():
        (files / name).write_bytes(value)
    (settings.data_dir / '.env').write_text('PRIVATE_TEST_SENTINEL=must-not-copy', encoding='utf-8')
    return settings.data_dir


def test_joint_restore_preserves_database_media_prompts_and_partial_chunks(joint_source, tmp_path):
    bundle, restored = tmp_path / 'bundle', tmp_path / 'restored'
    result = snapshot(joint_source, bundle, offline=True)
    assert result['ok'] and result['files'] == 4 and result['revision'] == '0006'
    assert restore(bundle, restored, offline=True) == result
    assert database_state(restored / 'yingxiang.sqlite3') == database_state(joint_source / 'yingxiang.sqlite3')
    with sqlite3.connect(restored / 'yingxiang.sqlite3') as db:
        assert db.execute('SELECT reserved,used FROM entitlement_grants').fetchall() == [(1, 0)]
        assert db.execute('SELECT state FROM usage_attempts').fetchall() == [('unknown',)]
        assert db.execute('SELECT role FROM users').fetchall() == [('admin',)]
    for original in (joint_source / 'users').rglob('*'):
        if original.is_file():
            assert (restored / original.relative_to(joint_source)).read_bytes() == original.read_bytes()
    assert not (restored / '.env').exists() and not (bundle / '.env').exists()
    assert not (restored / 'INCOMPLETE').exists()


@pytest.mark.parametrize('target', ['existing', 'nested', 'same'])
def test_snapshot_never_overwrites_or_nests_source(joint_source, tmp_path, target):
    destination = {'existing': tmp_path / 'occupied', 'nested': joint_source / 'backup', 'same': joint_source}[target]
    if target == 'existing':
        destination.mkdir(); (destination / 'sentinel').write_text('keep')
    before = (joint_source / 'yingxiang.sqlite3').read_bytes()
    with pytest.raises(ValueError):
        snapshot(joint_source, destination, offline=True)
    assert (joint_source / 'yingxiang.sqlite3').read_bytes() == before
    if target == 'existing':
        assert (destination / 'sentinel').read_text() == 'keep'


def test_offline_confirmation_is_required_before_any_write(joint_source, tmp_path):
    target = tmp_path / 'bundle'
    with pytest.raises(ValueError):
        snapshot(joint_source, target)
    assert not target.exists()
    cli = subprocess.run([sys.executable, '-m', 'scripts.joint_snapshot', 'snapshot', '--source', str(joint_source),
                          '--destination', str(target)], capture_output=True)
    assert cli.returncode == 2 and not target.exists()


@pytest.mark.parametrize('tamper', ['media', 'database', 'manifest_path', 'extra_file'])
def test_tampered_bundle_cannot_create_restore_target(joint_source, tmp_path, tamper):
    bundle, target = tmp_path / 'bundle', tmp_path / 'restored'
    snapshot(joint_source, bundle, offline=True)
    if tamper == 'media':
        next((bundle / 'users').rglob('prompts.json')).write_text('corrupt')
    elif tamper == 'database':
        with sqlite3.connect(bundle / 'database.sqlite3') as db:
            db.execute("UPDATE alembic_version SET version_num='wrong'")
    elif tamper == 'extra_file':
        (bundle / 'users' / 'unexpected').write_bytes(b'not-in-manifest')
    else:
        path = bundle / 'manifest.json'; value = json.loads(path.read_text())
        value['files'][0]['path'] = '../outside'
        path.write_text(json.dumps(value))
    with pytest.raises((ValueError, sqlite3.DatabaseError)):
        restore(bundle, target, offline=True)
    assert not target.exists()


def test_changed_source_leaves_incomplete_snapshot_unusable(joint_source, tmp_path, monkeypatch):
    import scripts.joint_snapshot as module
    original = module.copy_users
    def mutate(source, target, files):
        original(source, target, files)
        next((source / 'users').rglob('prompts.json')).write_text('changed-during-copy')
    monkeypatch.setattr(module, 'copy_users', mutate)
    bundle = tmp_path / 'bundle'
    with pytest.raises(ValueError):
        snapshot(joint_source, bundle, offline=True)
    assert (bundle / 'INCOMPLETE').exists()
    with pytest.raises(ValueError):
        verify(bundle)


def test_unsupported_revision_and_missing_database_are_not_initialized(joint_source, tmp_path):
    with sqlite3.connect(joint_source / 'yingxiang.sqlite3') as db:
        db.execute("UPDATE alembic_version SET version_num='0005'")
    with pytest.raises(ValueError):
        snapshot(joint_source, tmp_path / 'wrong-version', offline=True)
    missing = tmp_path / 'missing'; missing.mkdir()
    with pytest.raises(ValueError):
        snapshot(missing, tmp_path / 'empty', offline=True)
    assert list(missing.iterdir()) == []


def test_cli_round_trip_operates_only_on_explicit_new_paths(joint_source, tmp_path):
    bundle, restored = tmp_path / 'cli-bundle', tmp_path / 'cli-restored'
    commands = [('snapshot', '--source', str(joint_source), '--destination', str(bundle), '--offline'),
                ('verify', '--source', str(bundle)),
                ('restore', '--source', str(bundle), '--destination', str(restored), '--offline')]
    for args in commands:
        result = subprocess.run([sys.executable, '-m', 'scripts.joint_snapshot', *args], capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        summary = json.loads(result.stdout)
        assert summary['ok'] and summary['files'] == 4
        assert 'PRIVATE_TEST_SENTINEL' not in result.stdout
    assert database_state(restored / 'yingxiang.sqlite3') == database_state(joint_source / 'yingxiang.sqlite3')


def test_linked_private_directory_is_rejected_before_copy(joint_source, tmp_path):
    outside = tmp_path / 'outside'; outside.mkdir()
    (outside / 'private.txt').write_text('must-not-read')
    try:
        (joint_source / 'users' / 'link').symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip('Windows未允许创建测试符号链接')
    with pytest.raises(ValueError):
        snapshot(joint_source, tmp_path / 'unsafe-bundle', offline=True)
    assert not (tmp_path / 'unsafe-bundle').exists()
