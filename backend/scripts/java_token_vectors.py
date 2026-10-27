"""仅使用合成令牌，生成/核验旧Python实现的校验向量；不加载本机配置、不请求网络。"""
import argparse
from copy import deepcopy
import json
from pathlib import Path

from app.generation import TokenValidationError, validate_client_token

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'src/test/resources/legacy-token-vectors.json'
NOW = 1_800_000_000_000
MODEL, ORIGIN, PERMANENT = 'synthetic-model', 'http://127.0.0.1:8791', 'synthetic-permanent-key'


def vectors():
    from datetime import datetime, timezone

    def date(delta):
        return datetime.fromtimestamp((NOW + delta) / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

    base = {'apiKey': 'synthetic-client-key', 'expiresAt': date(10_000),
            'permissions': {'models': [MODEL], 'origins': [ORIGIN]},
            'constraints': {'realtime': {'maxSessionDuration': 15}}}
    rows = []

    def add(name, path=None, value=None, missing=False, seconds=15):
        token = deepcopy(base)
        if path:
            target = token
            for key in path[:-1]:
                target = target[key]
            if missing:
                target.pop(path[-1])
            else:
                target[path[-1]] = value
        expected = 'OK'
        try:
            validate_client_token(token, MODEL, ORIGIN, seconds, PERMANENT, NOW)
        except TokenValidationError as error:
            expected = error.code
        rows.append({'name': name, 'token': token, 'seconds': seconds, 'expected': expected})

    add('valid-15')
    for seconds in (30, 60):
        add(f'valid-{seconds}', ['constraints', 'realtime', 'maxSessionDuration'], seconds, seconds=seconds)
    add('missing-key', ['apiKey'], missing=True)
    for name, value in [('null', None), ('number', 1234567890), ('short', 'x' * 9), ('permanent', PERMANENT),
                        ('five-emoji', '😀' * 5), ('ten-emoji', '😀' * 10), ('ten-ascii', 'x' * 10)]:
        add('key-' + name, ['apiKey'], value)
    add('missing-expiry', ['expiresAt'], missing=True)
    for name, value in [('null', None), ('number', NOW), ('broken', 'not-a-time'), ('impossible', '2026-02-30T00:00:00Z'),
                        ('zero', date(0)), ('past', date(-1)), ('one-ms', date(1)), ('ttl-edge', date(15_000)),
                        ('ttl-long', date(15_001)), ('far-future', '9999-12-31T23:59:59Z'),
                        ('offset', date(10_000).replace('Z', '+00:00')), ('precision', date(10_000).replace('.000Z', '.000999Z'))]:
        add('expiry-' + name, ['expiresAt'], value)
    for field, mismatch in [('models', 'TOKEN_MODEL_MISMATCH'), ('origins', 'TOKEN_ORIGIN_MISMATCH')]:
        add(field + '-missing', ['permissions', field], missing=True)
        for name, value in [('null', None), ('empty', []), ('string', MODEL if field == 'models' else ORIGIN),
                            ('wrong', ['wrong']), ('extra', [MODEL if field == 'models' else ORIGIN, 'extra'])]:
            add(field + '-' + name, ['permissions', field], value)
    for name, value in [('null', None), ('array', []), ('string', 'invalid')]:
        add('permissions-' + name, ['permissions'], value)
    add('constraints-missing', ['constraints'], missing=True)
    add('constraints-null', ['constraints'], None)
    add('realtime-missing', ['constraints', 'realtime'], missing=True)
    add('realtime-null', ['constraints', 'realtime'], None)
    add('duration-missing', ['constraints', 'realtime', 'maxSessionDuration'], missing=True)
    for name, value in [('null', None), ('string', '15'), ('boolean', True), ('fraction', 15.1), ('wrong', 30), ('float', 15.0)]:
        add('duration-' + name, ['constraints', 'realtime', 'maxSessionDuration'], value)
    return {'receivedAt': NOW, 'model': MODEL, 'origin': ORIGIN, 'permanentKey': PERMANENT, 'vectors': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='更新合成向量；默认只核验已提交向量')
    args = parser.parse_args()
    actual = vectors()
    if args.write:
        DEST.write_text(json.dumps(actual, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
    elif json.loads(DEST.read_text(encoding='utf-8')) != actual:
        raise SystemExit('TOKEN_VECTOR_MISMATCH')
    print(json.dumps({'result': 'OK', 'vectors': len(actual['vectors']), 'providerCalls': 0}))


if __name__ == '__main__':
    main()
