"""冻结当前兼容合同。所有状态位于临时库；供应商仅使用替身。"""
import argparse
import base64
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import re
import socket
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app.core import Settings
from app.generation import POLICIES
from app.main import create_app
from scripts.ops import initialize


TARGET = Path(__file__).resolve().parents[1] / 'contracts/migration-v2/http-fixtures.json'
UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', re.I)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv9kAAAAASUVORK5CYII=')
WEBM = b'\x1aE\xdf\xa3' + b'synthetic-contract-video' * 4
NOW = 1_900_000_000_000


class Canonical:
    def __init__(self):
        self.ids = {}

    def value(self, value, key=''):
        if key in {'requestId'}:
            return '<request-id>'
        if key in {'access', 'apiKey'}:
            return '<redacted-opaque-credential>'
        if key == 'password':
            return '<synthetic-password>'
        if isinstance(value, dict):
            return {k: self.value(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [self.value(v) for v in value]
        if isinstance(value, str):
            if re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', value):
                return '<timestamp-utc-milliseconds>'
            def alias(match):
                return self.ids.setdefault(match.group().lower(), f'<uuid-{len(self.ids) + 1}>')
            return UUID_RE.sub(alias, value)
        return value


def capture(client, settle):
    """HTTP行为驱动与FastAPI装配分离；后续实现可复用请求／响应合同。"""
    norm, cases = Canonical(), []
    response_headers = ('content-type', 'cache-control', 'x-content-type-options', 'allow', 'accept-ranges',
                        'content-range', 'content-disposition', 'etag', 'last-modified')

    def probe(name, method, path, expected=None, **kwargs):
        request = client.build_request(method, path, **kwargs)
        response = client.send(request)
        if expected is not None and response.status_code != expected:
            raise AssertionError(f'{name}: expected HTTP {expected}, got {response.status_code}')
        req = {'method': method, 'path': norm.value(path), 'authenticated': bool(request.headers.get('cookie'))}
        req['headers'] = {k: '<matching-etag>' if k == 'if-range' and v != '"synthetic-stale-etag"' else norm.value(v) for k, v in request.headers.items()
                          if k in {'origin', 'content-type', 'range', 'if-range', 'x-work-owner'}}
        if 'json' in kwargs:
            req['json'] = norm.value(kwargs['json'])
        elif request.content:
            req['bodyBytes'] = len(request.content)
            req['bodySha256'] = hashlib.sha256(request.content).hexdigest()
        res = {'status': response.status_code, 'headers': {}}
        for key in response_headers:
            if key in response.headers:
                value = response.headers[key]
                res['headers'][key] = '<etag>' if key == 'etag' else '<http-date>' if key == 'last-modified' else norm.value(value)
        if response.headers.get('set-cookie'):
            res['cookieFlags'] = [part.strip() for part in response.headers['set-cookie'].split(';')[1:]]
        if response.content and 'application/json' in response.headers.get('content-type', ''):
            res['json'] = norm.value(response.json())
        else:
            res['bodyBytes'] = len(response.content)
            res['bodySha256'] = hashlib.sha256(response.content).hexdigest()
            if 'content-length' in response.headers:
                res['headers']['content-length'] = response.headers['content-length']
        cases.append({'name': name, 'request': req, 'response': res})
        return response

    for label, path in [('legacy_config', '/api/v1/config'), ('legacy_health', '/api/v1/health'),
                        ('anonymous_me', '/api/account/me'), ('payments_status', '/api/payments/status')]:
        probe(label, 'GET', path, 200)
    probe('anonymous_works', 'GET', '/api/works', 401)
    probe('anonymous_admin', 'GET', '/api/admin/overview', 401)
    for index, path in enumerate(('/api/v1/access/redeem', '/api/v1/sessions', '/api/v1/sessions/fixture/token',
                                  '/api/v1/sessions/fixture/heartbeat', '/api/v1/sessions/fixture/end')):
        probe(f'legacy_disabled_{index}', 'POST', path, 503, json={})
    probe('wrong_origin', 'POST', '/api/account/login', 403, json={}, headers={'origin': 'https://other.invalid'})
    probe('bad_json', 'POST', '/api/account/login', 400, content=b'{', headers={'content-type': 'application/json'})
    probe('wrong_content_type', 'POST', '/api/account/login', 415, content=b'{}', headers={'content-type': 'text/plain'})
    first = probe('register_owner', 'POST', '/api/account/register', 200,
                  json={'username': 'contract_owner', 'password': 'test-password-only'})
    owner = first.json()['user']['id']
    probe('owner_me', 'GET', '/api/account/me', 200)
    probe('head_me', 'HEAD', '/api/account/me', 200)
    probe('options_me', 'OPTIONS', '/api/account/me', 204)
    probe('non_admin', 'GET', '/api/admin/overview', 403)
    probe('missing_work', 'GET', '/api/works/10000000-0000-4000-8000-000000000099', 404)
    status = probe('studio_status', 'GET', '/api/studio/status', 200).json()
    attempt = str(uuid4())
    token_body = {'attemptId': attempt, 'consentVersion': POLICIES['studio']['consentVersion'], 'durationSec': 15}
    probe('unknown_issue', 'POST', '/api/studio/token', 503, json=token_body, headers={'x-studio-access': status['access']})
    probe('unknown_issue_not_repeated', 'POST', '/api/studio/token', 409, json=token_body, headers={'x-studio-access': status['access']})
    probe('unknown_preserves_occupancy', 'GET', '/api/account/me', 200)

    checkout = {'sku': 'credits-v1-light', 'requestId': str(uuid4())}
    order = probe('sandbox_checkout', 'POST', '/api/payments/checkout', 200, json=checkout).json()['orderId']
    probe('sandbox_checkout_idempotent', 'POST', '/api/payments/checkout', 200, json=checkout)
    probe('sandbox_reconcile', 'POST', '/api/payments/reconcile', 200, json={'orderId': order})
    probe('sandbox_reconcile_idempotent', 'POST', '/api/payments/reconcile', 200, json={'orderId': order})
    probe('sandbox_orders', 'GET', '/api/payments/orders', 200)
    probe('sandbox_did_not_unlock_real_usage', 'GET', '/api/account/me', 200)
    probe('unsigned_webhook', 'POST', '/api/payments/webhook', 400, json={})

    ident, ref = str(uuid4()), str(uuid4())
    work = f'/api/works/{ident}'
    bound = {'x-work-owner': owner}
    probe('create_edit_work', 'POST', '/api/works', 201, json={'id': ident, 'ownerId': owner, 'kind': 'edit', 'mime': 'video/webm', 'seconds': 15}, headers=bound)
    probe('chunk_order', 'POST', work + '/chunks/1', 409, content=WEBM, headers=bound)
    probe('chunk_first', 'POST', work + '/chunks/0', 200, content=WEBM, headers=bound)
    probe('chunk_repeated', 'POST', work + '/chunks/0', 200, content=WEBM, headers=bound)
    probe('chunk_conflict', 'POST', work + '/chunks/0', 409, content=b'conflict', headers=bound)
    probe('reference', 'POST', work + '/references/' + ref, 200, content=PNG, headers={**bound, 'content-type': 'image/png'})
    prompt = {'atMs': 0, 'instructions': ['合成合同样本，替换服装颜色。']}
    probe('prompt_first', 'POST', work + '/prompts/0', 200, json=prompt, headers=bound)
    probe('prompt_same', 'POST', work + '/prompts/0', 200, json=prompt, headers=bound)
    probe('prompt_conflict', 'POST', work + '/prompts/0', 409, json={'atMs': 0, 'instructions': ['冲突样本']}, headers=bound)
    probe('prompts', 'GET', work + '/prompts', 200)
    probe('content_before_ready', 'GET', work + '/content', 409)
    probe('complete', 'POST', work + '/complete', 202, json={'durationMs': 1500}, headers=bound)
    settle()
    probe('work_ready', 'GET', work, 200)
    content = probe('content', 'GET', work + '/content', 200)
    probe('content_head', 'HEAD', work + '/content', 200)
    probe('content_range', 'GET', work + '/content', 206, headers={'range': 'bytes=4-11'})
    probe('content_matching_if_range', 'GET', work + '/content', 206,
          headers={'range': 'bytes=4-11', 'if-range': content.headers['etag']})
    probe('content_stale_if_range', 'GET', work + '/content', 200,
          headers={'range': 'bytes=4-11', 'if-range': '"synthetic-stale-etag"'})
    probe('content_bad_range', 'GET', work + '/content', 416, headers={'range': 'bytes=99999-100000'})
    probe('content_download', 'GET', work + '/content?download=1', 200)
    probe('reference_content', 'GET', work + '/references/' + ref, 200)
    probe('rename', 'POST', work, 200, json={'title': '100% 合成作品_合同'})
    probe('favorite', 'POST', work, 200, json={'favorite': True})
    probe('literal_search', 'GET', '/api/works?q=%25&favorite=true&sort=title', 200)
    probe('invalid_sort', 'GET', '/api/works?sort=arbitrary', 400)
    probe('logout_owner', 'POST', '/api/account/logout', 200)
    probe('register_other', 'POST', '/api/account/register', 200, json={'username': 'contract_other', 'password': 'test-password-only'})
    probe('other_work_hidden', 'GET', work, 404)
    probe('other_prompts_hidden', 'GET', work + '/prompts', 404)
    probe('other_content_hidden', 'GET', work + '/content', 404)
    probe('other_change_rejected', 'POST', work, 404, json={'favorite': True})
    probe('stale_upload_owner', 'POST', work + '/chunks/1', 409, content=WEBM, headers=bound)
    probe('other_works_empty', 'GET', '/api/works', 200)
    probe('logout_other', 'POST', '/api/account/logout', 200)
    probe('login_owner', 'POST', '/api/account/login', 200, json={'username': 'contract_owner', 'password': 'test-password-only'})
    probe('delete_work', 'POST', work, 200, json={'action': 'delete'})
    settle()
    probe('deleted_work_hidden', 'GET', work, 404)
    probe('deleted_prompts_hidden', 'GET', work + '/prompts', 404)
    probe('owner_works_empty', 'GET', '/api/works', 200)
    return cases


def capture_current():
    async def park(service):
        await service.stopping.wait()
    def forbidden(*args, **kwargs):
        raise AssertionError('Contract runner forbids real network and Settings.load')
    calls = {'model': 0, 'checkout': 0}
    original_connect = socket.socket.connect
    def local_ipc_only(sock, address):
        # Windows asyncio 用回环 socketpair 创建内部唤醒管道；这不是HTTP外联。
        if isinstance(address, tuple) and address[0] in {'127.0.0.1', '::1'}:
            return original_connect(sock, address)
        return forbidden()
    sessions = {}
    def upstream(request):
        calls['model'] += 1
        raise httpx.ReadTimeout('synthetic-timeout-only')
    def create_checkout(params, options):
        calls['checkout'] += 1
        ident = 'cs_test_' + params['client_reference_id']
        item = {'id': ident, 'livemode': False, 'mode': 'payment', 'client_reference_id': params['client_reference_id'],
                'metadata': params['metadata'], 'currency': 'cny', 'amount_total': params['line_items'][0]['price_data']['unit_amount'],
                'status': 'open', 'payment_status': 'unpaid', 'url': 'https://checkout.stripe.com/c/pay/synthetic-contract'}
        sessions[ident] = item
        return dict(item)
    def retrieve_checkout(ident):
        return {**sessions[ident], 'status': 'complete', 'payment_status': 'paid'}
    sdk = SimpleNamespace(v1=SimpleNamespace(accounts=SimpleNamespace(retrieve_current=lambda: SimpleNamespace(id='acct_fixture')),
                         checkout=SimpleNamespace(sessions=SimpleNamespace(create=create_checkout, retrieve=retrieve_checkout))))
    with tempfile.TemporaryDirectory(prefix='yingxiang-contract-v2-') as directory, ExitStack() as guard:
        guard.enter_context(patch('socket.socket.connect', local_ipc_only))
        guard.enter_context(patch('httpx.HTTPTransport.handle_request', forbidden))
        guard.enter_context(patch('httpx.AsyncHTTPTransport.handle_async_request', forbidden))
        guard.enter_context(patch.object(Settings, 'load', forbidden))
        guard.enter_context(patch('app.works.Works.run', park))
        for module in ('core', 'accounts', 'generation', 'payments', 'works', 'admin', 'main'):
            guard.enter_context(patch(f'app.{module}.now_ms', return_value=NOW))
        settings = Settings(data_dir=Path(directory), maintenance=False,
            env={'DECART_API_KEY': 'fixture-key-only', 'YINGXIANG_STUDIO_ENABLED': 'true',
                 'YINGXIANG_PAYMENTS_TEST_ENABLED': 'true', 'STRIPE_SECRET_KEY': 'sk_test_fixture',
                 'STRIPE_WEBHOOK_SECRET': 'whsec_fixture', 'STRIPE_EXPECTED_ACCOUNT_ID': 'acct_fixture'})
        initialize(settings)
        app = create_app(settings, transport=httpx.MockTransport(upstream), stripe_client=sdk)
        with TestClient(app, base_url=settings.public_origin) as client:
            client.headers['origin'] = settings.public_origin
            cases = capture(client, lambda: client.portal.call(app.state.works.tick))
            openapi = app.openapi()
            operations = {f'{method.upper()} {path}' for path, item in openapi['paths'].items()
                          for method in item if method.lower() in {'get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'}}
            # 新FastAPI的include_router项可能不直接暴露path；公开schema负责嵌套路由清单。
            operations.update(f'{method} {route.path}' for route in app.routes
                              if getattr(route, 'path', '').startswith('/api/') for method in route.methods)
            operations = sorted(operations)
            schema = json.dumps(openapi, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()
        return {'format': 'yingxiang-http-contract-v2', 'sampleKind': 'synthetic-asgi-and-provider-substitutes',
                'sourceRevision': '0006', 'openapiSha256': hashlib.sha256(schema).hexdigest(),
                'operations': operations, 'providerCalls': calls, 'cases': cases}


def main():
    parser = argparse.ArgumentParser(description='隔离合成数据的HTTP合同冻结／只读漂移检查')
    parser.add_argument('--write', action='store_true', help='仅在明确复核合同变化后显式重录，常规检查不写fixture')
    args = parser.parse_args()
    current = capture_current()
    if args.write:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        TARGET.write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    else:
        expected = json.loads(TARGET.read_text(encoding='utf-8'))
        if current != expected:
            old = {item['name']: item for item in expected['cases']}
            changed = [item['name'] for item in current['cases'] if old.get(item['name']) != item]
            print(json.dumps({'ok': False, 'error': 'CONTRACT_DRIFT', 'cases': changed or ['metadata-or-operation-set']}))
            return 1
    print(json.dumps({'ok': True, 'cases': len(current['cases']), 'operations': len(current['operations']), 'providerCalls': current['providerCalls']}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
