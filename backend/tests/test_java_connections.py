import json
import subprocess
import sys

import pytest

from scripts import java_connections


def report():
    return {'postgresql': {'ok': False, 'code': 'TLS_NOT_SUPPORTED', 'elapsedMs': 1},
            'redis': {'ok': False, 'code': 'CONNECTION_OR_TLS_TIMEOUT', 'elapsedMs': 2},
            'businessDataRead': False, 'businessDataWritten': False, 'namespaceWritePermissionVerified': False}


def test_report_rejects_raw_exception_messages():
    safe = report()
    assert java_connections.validate_report(safe) == safe
    safe['postgresql']['message'] = 'private-sentinel'
    with pytest.raises(ValueError):
        java_connections.validate_report(safe)
    safe['postgresql'].pop('message')
    safe['postgresql']['code'] = 'private-sentinel'
    with pytest.raises(ValueError):
        java_connections.validate_report(safe)


def setup_cli(tmp_path, monkeypatch):
    backend = tmp_path / 'backend'
    scripts = backend / 'scripts'
    scripts.mkdir(parents=True)
    (backend / 'target').mkdir()
    (backend / 'target/yingxiang-backend-0.1.0.jar').touch()
    config = backend / 'private.yml'
    config.write_text('password: private-sentinel', encoding='utf-8')
    monkeypatch.setattr(java_connections, '__file__', str(scripts / 'java_connections.py'))
    monkeypatch.setattr(sys, 'argv', ['java_connections', '--file', str(config)])


def test_cli_does_not_forward_stderr_or_put_password_in_arguments(tmp_path, monkeypatch, capsys):
    setup_cli(tmp_path, monkeypatch)
    def run(command, **kwargs):
        assert 'private-sentinel' not in str(command)
        assert kwargs['timeout'] == 45
        return subprocess.CompletedProcess(command, 1, json.dumps(report()).encode(), b'private-sentinel')
    monkeypatch.setattr(subprocess, 'run', run)
    assert java_connections.main() == 1
    captured = capsys.readouterr()
    assert 'private-sentinel' not in captured.out + captured.err
    assert json.loads(captured.out)['postgresql']['code'] == 'TLS_NOT_SUPPORTED'


@pytest.mark.parametrize('timeout', [True, False])
def test_cli_timeout_or_unexpected_output_is_suppressed(tmp_path, monkeypatch, capsys, timeout):
    setup_cli(tmp_path, monkeypatch)
    def run(command, **kwargs):
        if timeout:
            raise subprocess.TimeoutExpired(command, 45, output=b'private-sentinel')
        return subprocess.CompletedProcess(command, 1, b'private-sentinel', b'private-sentinel')
    monkeypatch.setattr(subprocess, 'run', run)
    assert java_connections.main() == (1 if timeout else 2)
    captured = capsys.readouterr()
    assert 'private-sentinel' not in captured.out + captured.err
    assert 'connectionCheck' in json.loads(captured.out)
