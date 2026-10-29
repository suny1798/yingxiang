"""显式Flyway运维入口；默认只预检，不记录连接参数或原始异常。"""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('preflight', 'migrate', 'validate'), nargs='?', default='preflight')
    parser.add_argument('--file', type=Path, default=Path('config/application-local.yml'))
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    try:
        result = subprocess.run([
            'java', '-Duser.language=en', '-Duser.country=US', '-Dlogback.configurationFile=migration-probe-logback.xml',
            '-Dloader.main=cn.yingxiang.manager.SchemaOperations', '-cp', str(backend / 'target/yingxiang-backend-0.1.0.jar'),
            'org.springframework.boot.loader.launch.PropertiesLauncher', args.action, str(args.file.resolve()),
        ], cwd=backend, capture_output=True, timeout=45)
        report = json.loads(result.stdout.decode('utf-8'))
        allowed = {'action', 'schemaExists', 'databaseCreateSchema', 'objectCount', 'hasHistory', 'publicTableCount',
                   'status', 'code', 'migrationsExecuted', 'pendingMigrations', 'flywayVersion'}
        if not isinstance(report, dict) or set(report) - allowed:
            raise ValueError()
        print(json.dumps(report))
        return result.returncode if result.returncode in (0, 1) else 1
    except Exception:
        print(json.dumps({'status': 'OPERATION_FAILED_OUTPUT_SUPPRESSED'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
