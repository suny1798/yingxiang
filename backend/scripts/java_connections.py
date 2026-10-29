"""显式执行Java JDBC/Lettuce一次只读检查；凭据不进入进程参数或输出。"""
import argparse
import json
from pathlib import Path
import subprocess


def validate_report(report):
    if not isinstance(report, dict):
        raise ValueError()
    if set(report) == {'configuration'} and report['configuration'] == 'INVALID_OR_UNREADABLE':
        return report
    expected = {'postgresql', 'redis', 'businessDataRead', 'businessDataWritten', 'namespaceWritePermissionVerified'}
    if set(report) != expected or any(report[key] is not False for key in expected - {'postgresql', 'redis'}):
        raise ValueError()
    codes = {'READ_ONLY_CONNECTED', 'SCHEMA_MISSING', 'READ_ONLY_NOT_CONFIRMED', 'AUTHENTICATED_PING',
             'TLS_NOT_SUPPORTED', 'AUTHENTICATION_FAILED', 'DATABASE_MISSING', 'PERMISSION_DENIED',
             'NAME_RESOLUTION_FAILED', 'CONNECTION_OR_TLS_TIMEOUT', 'TLS_HANDSHAKE_FAILED', 'CONNECTION_FAILED'}
    for key in ('postgresql', 'redis'):
        value = report[key]
        if not isinstance(value, dict) or not {'ok', 'code', 'elapsedMs'} <= set(value):
            raise ValueError()
        if set(value) - {'ok', 'code', 'elapsedMs', 'serverVersionNumber', 'schemaExists', 'readOnlyTransaction'}:
            raise ValueError()
        if type(value['ok']) is not bool or value['code'] not in codes or type(value['elapsedMs']) is not int or value['elapsedMs'] < 0:
            raise ValueError()
        for field in ('schemaExists', 'readOnlyTransaction'):
            if field in value and type(value[field]) is not bool:
                raise ValueError()
        if 'serverVersionNumber' in value and type(value['serverVersionNumber']) is not int:
            raise ValueError()
    return report


def main():
    parser = argparse.ArgumentParser(description='Java迁移只读连接检查，不写业务数据')
    parser.add_argument('--file', type=Path, default=Path('config/application-local.yml'))
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    config = args.file.resolve()
    jar = backend / 'target/yingxiang-backend-0.1.0.jar'
    if not config.is_file() or config.is_symlink() or not jar.is_file():
        print(json.dumps({'configuration': 'CONFIG_OR_JAR_MISSING'}))
        return 2
    try:
        result = subprocess.run([
            'java', '-Duser.language=en', '-Duser.country=US',
            '-Dlogback.configurationFile=migration-probe-logback.xml',
            '-Dloader.main=cn.yingxiang.manager.ConnectionProbe', '-cp', str(jar),
            'org.springframework.boot.loader.launch.PropertiesLauncher', str(config),
        ], cwd=backend, capture_output=True, timeout=45)
        # 固定分类及字段白名单；不转发原始异常、stderr或未知诊断属性。
        report = validate_report(json.loads(result.stdout.decode('utf-8')))
        print(json.dumps(report, ensure_ascii=True))
        return result.returncode if result.returncode in (0, 1, 2) else 2
    except subprocess.TimeoutExpired:
        print(json.dumps({'connectionCheck': 'DEADLINE_EXCEEDED', 'deadlineSeconds': 45}))
        return 1
    except Exception:
        print(json.dumps({'connectionCheck': 'PROBE_FAILED_OUTPUT_SUPPRESSED'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
