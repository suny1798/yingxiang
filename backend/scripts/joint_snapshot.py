"""停写窗口下的 SQLite + 私有用户文件联合快照；不加载 .env、不访问供应商。"""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys

from app.db import REVISION


FORMAT = 'yingxiang-joint-snapshot-v1'


def safe_root(value):
    path = Path(value).absolute()
    for parent in (path, *path.parents):
        if parent.is_symlink() or parent.is_junction():
            raise ValueError('不接受链接目录')
    return path.resolve()


def digest_file(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def private_files(root):
    """只枚举授权的 users 子树；不包含密钥、旧导入目录或其他备份。"""
    result = []
    users = root / 'users'
    if users.is_symlink() or users.is_junction():
        raise ValueError('私有目录不能为链接')
    if users.exists() and not users.is_dir():
        raise ValueError('私有目录格式无效')
    if not users.exists():
        return result
    for path in sorted(users.rglob('*')):
        if path.is_symlink() or path.is_junction():
            raise ValueError('私有目录包含链接')
        if path.is_file():
            result.append({'path': path.relative_to(root).as_posix(),
                           'bytes': path.stat().st_size, 'sha256': digest_file(path)})
        elif not path.is_dir():
            raise ValueError('私有目录包含特殊文件')
    return result


def database_state(path):
    if not path.is_file() or path.is_symlink():
        raise ValueError('数据库不存在或为链接')
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('数据库完整性检查失败')
        if db.execute('SELECT version_num FROM alembic_version').fetchall() != [(REVISION,)]:
            raise ValueError('源数据库版本不符')
        schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
        tables = {}
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            quoted = '"' + name.replace('"', '""') + '"'
            # 不假定行存储顺序；摘要保留每行完整类型和值，不输出原始内容。
            rows = [json.dumps(list(row), ensure_ascii=True, separators=(',', ':'),
                               default=lambda v: {'bytes': v.hex()})
                    for row in db.execute('SELECT * FROM ' + quoted)]
            canonical = '\n'.join(sorted(rows)).encode('utf-8')
            tables[name] = {'rows': len(rows), 'sha256': hashlib.sha256(canonical).hexdigest()}
        return {'revision': REVISION, 'schemaSha256': hashlib.sha256(json.dumps(schema, ensure_ascii=True).encode()).hexdigest(), 'tables': tables}


def copy_database(source, destination):
    with destination.open('xb'):
        pass
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as src:
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)


def check_destination(source, destination):
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('源和目标不能嵌套')
    if destination.exists():
        raise ValueError('目标必须不存在')


def copy_users(source, destination, files):
    for item in files:
        path = PurePosixPath(item['path'])
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'users' or '\\' in item['path'] or ':' in item['path']:
            raise ValueError('文件清单路径无效')
        src = source.joinpath(*path.parts)
        dst = destination.joinpath(*path.parts)
        safe_root(src.parent)
        if src.is_symlink() or not src.is_file():
            raise ValueError('文件无效')
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)


def require_offline(offline):
    if not offline:
        raise ValueError('必须明确确认所有数据库及媒体写入已停止')


def snapshot(source, destination, *, offline=False):
    require_offline(offline)
    source, destination = safe_root(source), safe_root(destination)
    check_destination(source, destination)
    before_db = database_state(source / 'yingxiang.sqlite3')
    before_files = private_files(source)
    destination.mkdir(parents=True, exist_ok=False)
    marker = destination / 'INCOMPLETE'
    marker.write_text('未完成的快照不可恢复。', encoding='utf-8')
    copy_database(source / 'yingxiang.sqlite3', destination / 'database.sqlite3')
    copy_users(source, destination, before_files)
    if database_state(source / 'yingxiang.sqlite3') != before_db or private_files(source) != before_files:
        raise ValueError('快照期间源发生变化')
    if database_state(destination / 'database.sqlite3') != before_db or private_files(destination) != before_files:
        raise ValueError('快照核对失败')
    manifest = {'format': FORMAT, 'database': before_db, 'databaseSha256': digest_file(destination / 'database.sqlite3'), 'files': before_files}
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
    marker.unlink()
    return verify(destination)


def verify(source):
    source = safe_root(source)
    if (source / 'INCOMPLETE').exists():
        raise ValueError('快照未完成')
    manifest_path = source / 'manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('快照清单不存在或无效')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if set(manifest) != {'format', 'database', 'databaseSha256', 'files'} or manifest['format'] != FORMAT:
        raise ValueError('快照格式不支持')
    if database_state(source / 'database.sqlite3') != manifest['database'] or digest_file(source / 'database.sqlite3') != manifest['databaseSha256']:
        raise ValueError('数据库核对失败')
    if private_files(source) != manifest['files']:
        raise ValueError('私有文件核对失败')
    return {'ok': True, 'revision': REVISION, 'tables': len(manifest['database']['tables']),
            'files': len(manifest['files']), 'bytes': sum(item['bytes'] for item in manifest['files'])}


def restore(source, destination, *, offline=False):
    require_offline(offline)
    source, destination = safe_root(source), safe_root(destination)
    check_destination(source, destination)
    result = verify(source)
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    destination.mkdir(parents=True, exist_ok=False)
    marker = destination / 'INCOMPLETE'
    marker.write_text('未完成的恢复不可用于运行。', encoding='utf-8')
    copy_database(source / 'database.sqlite3', destination / 'yingxiang.sqlite3')
    copy_users(source, destination, manifest['files'])
    verify(source)
    if database_state(destination / 'yingxiang.sqlite3') != manifest['database'] or private_files(destination) != manifest['files']:
        raise ValueError('恢复核对失败')
    marker.unlink()
    return result


def main():
    parser = argparse.ArgumentParser(description='仅对已停写目录执行联合快照／恢复；不读取.env或调用供应商')
    parser.add_argument('action', choices=('snapshot', 'verify', 'restore'))
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--offline', action='store_true', help='操作者确认所有API、Worker和媒体写入均已停止；工具不能代替停写')
    args = parser.parse_args()
    if args.action != 'verify' and (args.destination is None or not args.offline):
        parser.error('快照／恢复必须指定不存在的destination及--offline')
    try:
        result = verify(args.source) if args.action == 'verify' else globals()[args.action](args.source, args.destination, offline=args.offline)
    except Exception:
        print(json.dumps({'ok': False, 'error': 'JOINT_SNAPSHOT_FAILED'}), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
