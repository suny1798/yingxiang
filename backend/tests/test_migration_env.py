import json
from pathlib import Path
import subprocess
import sys

import pytest

from scripts.migration_env import check


EXAMPLE = Path(__file__).resolve().parents[1] / '.env.migration.example'


def configured(tmp_path, updates=None):
    source = EXAMPLE.read_text(encoding='utf-8')
    replacements = {'MIGRATION_DB_HOST': 'db.test.invalid', 'MIGRATION_DB_USERNAME': 'migration_test',
                    'MIGRATION_DB_PASSWORD': 'private-db-test-sentinel', 'MIGRATION_REDIS_HOST': 'redis.test.invalid',
                    'MIGRATION_REDIS_PASSWORD': 'private-redis-test-sentinel', **(updates or {})}
    lines = []
    for line in source.splitlines():
        key = line.split('=', 1)[0]
        lines.append(f'{key}={replacements[key]}' if key in replacements else line)
    target = tmp_path / '.env.migration.local'
    target.write_text('\n'.join(lines), encoding='utf-8')
    return target


def test_example_reports_missing_fields_without_secret_values():
    result = check(EXAMPLE)
    assert result['ok'] is False and result['invalid'] == []
    assert result['missing'] == ['MIGRATION_DB_HOST', 'MIGRATION_DB_PASSWORD', 'MIGRATION_DB_USERNAME', 'MIGRATION_REDIS_HOST', 'MIGRATION_REDIS_PASSWORD']
    assert result['externalConnectionsAttempted'] is False


def test_completed_configuration_is_offline_and_redacted(tmp_path, monkeypatch):
    import socket
    monkeypatch.setattr(socket, 'create_connection', lambda *a, **k: pytest.fail('网络调用'))
    path = configured(tmp_path)
    result = check(path)
    assert result['ok'] and result['missing'] == [] and result['invalid'] == []
    encoded = json.dumps(result)
    assert 'private-db-test-sentinel' not in encoded and 'db.test.invalid' not in encoded
    cli = subprocess.run([sys.executable, '-m', 'scripts.migration_env', '--file', str(path)], capture_output=True, text=True)
    assert cli.returncode == 0 and json.loads(cli.stdout)['ok']
    assert 'private-redis-test-sentinel' not in cli.stdout + cli.stderr


@pytest.mark.parametrize('updates,field', [
    ({'MIGRATION_ALLOW_EXTERNAL_PROVIDERS': 'true'}, 'MIGRATION_ALLOW_EXTERNAL_PROVIDERS'),
    ({'MIGRATION_DB_SSLMODE': 'disable'}, 'MIGRATION_DB_SSLMODE'),
    ({'MIGRATION_REDIS_TLS': 'false'}, 'MIGRATION_REDIS_TLS'),
    ({'MIGRATION_STORAGE_ROOT': 'data/users'}, 'MIGRATION_STORAGE_ROOT'),
    ({'MIGRATION_REDIS_NAMESPACE': 'production:*'}, 'MIGRATION_REDIS_NAMESPACE'),
    ({'MIGRATION_DB_NAME': 'production'}, 'MIGRATION_DB_NAME'),
    ({'MIGRATION_DB_PORT': '99999'}, 'MIGRATION_DB_PORT'),
])
def test_unsafe_configuration_fails_closed(tmp_path, updates, field):
    result = check(configured(tmp_path, updates))
    assert not result['ok'] and field in result['invalid']


def test_existing_process_environment_cannot_fill_missing_configuration(tmp_path, monkeypatch):
    for key in ('MIGRATION_DB_PASSWORD', 'MIGRATION_DB_HOST', 'MIGRATION_REDIS_PASSWORD'):
        monkeypatch.setenv(key, 'must-not-inherit')
    assert 'MIGRATION_DB_PASSWORD' in check(EXAMPLE)['missing']
    result = check(tmp_path / 'missing-file')
    assert result['missing'] == ['MIGRATION_CONFIGURATION_FILE']


def test_explicit_loopback_test_services_may_disable_tls(tmp_path):
    result = check(configured(tmp_path, {'MIGRATION_DB_HOST': '127.0.0.1', 'MIGRATION_DB_SSLMODE': 'disable',
                                        'MIGRATION_REDIS_HOST': 'localhost', 'MIGRATION_REDIS_TLS': 'false'}))
    assert result['ok']
