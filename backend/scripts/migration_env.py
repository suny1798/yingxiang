"""隔离迁移配置的离线检查；只读显式文件，不回退业务.env或系统环境。"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values


DEFAULT = Path(__file__).resolve().parents[1] / '.env.migration.local'
KNOWN = {
    'MIGRATION_PROFILE', 'MIGRATION_PUBLIC_ORIGIN', 'MIGRATION_API_PORT', 'MIGRATION_STORAGE_ROOT',
    'MIGRATION_DB_HOST', 'MIGRATION_DB_PORT', 'MIGRATION_DB_NAME', 'MIGRATION_DB_SCHEMA',
    'MIGRATION_DB_USERNAME', 'MIGRATION_DB_PASSWORD', 'MIGRATION_DB_SSLMODE', 'MIGRATION_DB_SSLROOTCERT',
    'MIGRATION_REDIS_HOST', 'MIGRATION_REDIS_PORT', 'MIGRATION_REDIS_USERNAME', 'MIGRATION_REDIS_PASSWORD',
    'MIGRATION_REDIS_TLS', 'MIGRATION_REDIS_DATABASE', 'MIGRATION_REDIS_NAMESPACE',
    'MIGRATION_MAINTENANCE', 'MIGRATION_ALLOW_EXTERNAL_PROVIDERS', 'MIGRATION_SCENES_ENABLED', 'MIGRATION_STRIPE_LIVE_ENABLED',
}
OPTIONAL = {'MIGRATION_DB_SSLROOTCERT', 'MIGRATION_REDIS_USERNAME'}
SAFETY = {'MIGRATION_MAINTENANCE': 'true', 'MIGRATION_ALLOW_EXTERNAL_PROVIDERS': 'false',
          'MIGRATION_SCENES_ENABLED': 'false', 'MIGRATION_STRIPE_LIVE_ENABLED': 'false'}
LOCAL = {'localhost', '127.0.0.1', '::1'}


def check(path=DEFAULT):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        return {'ok': False, 'missing': ['MIGRATION_CONFIGURATION_FILE'], 'invalid': [], 'externalConnectionsAttempted': False}
    values = dict(dotenv_values(path, interpolate=False))
    missing = sorted(key for key in KNOWN - OPTIONAL if not values.get(key))
    invalid = []
    if values.keys() - KNOWN:
        invalid.append('UNRECOGNIZED_VARIABLES')
    for key, expected in SAFETY.items():
        if values.get(key) and values[key] != expected:
            invalid.append(key)
    for key in ('MIGRATION_API_PORT', 'MIGRATION_DB_PORT', 'MIGRATION_REDIS_PORT'):
        value = values.get(key)
        if value and (not value.isdecimal() or not 1 <= int(value) <= 65535):
            invalid.append(key)
    for key in ('MIGRATION_DB_HOST', 'MIGRATION_REDIS_HOST'):
        value = values.get(key)
        if value and (any(c.isspace() for c in value) or any(c in value for c in '/@?#')):
            invalid.append(key)
    if values.get('MIGRATION_PROFILE') not in (None, '', 'isolated'):
        invalid.append('MIGRATION_PROFILE')
    if values.get('MIGRATION_PUBLIC_ORIGIN'):
        try:
            origin = urlsplit(values['MIGRATION_PUBLIC_ORIGIN'])
            if origin.scheme not in {'http', 'https'} or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment:
                invalid.append('MIGRATION_PUBLIC_ORIGIN')
        except ValueError:
            invalid.append('MIGRATION_PUBLIC_ORIGIN')
    mode = values.get('MIGRATION_DB_SSLMODE')
    if mode and mode != 'verify-full' and not (mode == 'disable' and values.get('MIGRATION_DB_HOST') in LOCAL):
        invalid.append('MIGRATION_DB_SSLMODE')
    tls = values.get('MIGRATION_REDIS_TLS')
    if tls and tls != 'true' and not (tls == 'false' and values.get('MIGRATION_REDIS_HOST') in LOCAL):
        invalid.append('MIGRATION_REDIS_TLS')
    namespace = values.get('MIGRATION_REDIS_NAMESPACE')
    if namespace and (not namespace.startswith('yingxiang:migration:') or any(c in namespace for c in '*?[] \t\r\n')):
        invalid.append('MIGRATION_REDIS_NAMESPACE')
    database = values.get('MIGRATION_REDIS_DATABASE')
    if database and database != '0':
        invalid.append('MIGRATION_REDIS_DATABASE')
    storage = values.get('MIGRATION_STORAGE_ROOT')
    if storage:
        # 固定隔离私有目录，避免误复用当前业务data/users或静态public路径。
        if storage.replace('\\', '/').rstrip('/') != 'data/migration-test':
            invalid.append('MIGRATION_STORAGE_ROOT')
    for key in ('MIGRATION_DB_NAME', 'MIGRATION_DB_SCHEMA'):
        value = values.get(key)
        if value and ('migration' not in value.lower() or any(c in value for c in '/\\;\r\n')):
            invalid.append(key)
    certificate = values.get('MIGRATION_DB_SSLROOTCERT')
    if certificate and not Path(certificate).is_file():
        invalid.append('MIGRATION_DB_SSLROOTCERT')
    return {'ok': not missing and not invalid, 'missing': missing, 'invalid': sorted(set(invalid)),
            'externalConnectionsAttempted': False}


def main():
    parser = argparse.ArgumentParser(description='只离线检查迁移配置，不连接数据库／Redis，不显示值')
    parser.add_argument('--file', type=Path, default=DEFAULT)
    args = parser.parse_args()
    try:
        result = check(args.file)
    except Exception:
        result = {'ok': False, 'missing': [], 'invalid': ['MIGRATION_CONFIGURATION_FILE'], 'externalConnectionsAttempted': False}
    print(json.dumps(result))
    return 0 if result['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
