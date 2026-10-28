"""Vue账号联调专用旧FastAPI；临时SQLite、回环、禁止外联，不读取dotenv。"""
import argparse
import asyncio
from contextlib import ExitStack
from pathlib import Path
import socket
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

import uvicorn
from fastapi import Request

from app.core import Settings, local_origin, private_json, read_json, BusinessError, UUID
from app.main import create_app
from scripts.ops import initialize


def forbidden(*_args, **_kwargs):
    raise RuntimeError('Fixture forbids production configuration or outbound network')


class SandboxStripe:
    """仅临时fixture使用的Stripe收银台替身：不联网、不读密钥、不产生真实付款。"""

    def __init__(self):
        self.sessions = {}
        self.account_id = 'acct_synthetic_sandbox'
        self.v1 = SimpleNamespace(
            accounts=SimpleNamespace(retrieve_current=lambda: SimpleNamespace(id=self.account_id)),
            checkout=SimpleNamespace(sessions=SimpleNamespace(create=self.create, retrieve=self.retrieve)),
        )

    def create(self, params, options):
        ident = 'cs_test_' + params['client_reference_id'].replace('-', '')
        line = params['line_items'][0]['price_data']
        value = {'id': ident, 'livemode': False, 'mode': 'payment', 'client_reference_id': params['client_reference_id'],
                 'metadata': dict(params['metadata']), 'currency': line['currency'], 'amount_total': line['unit_amount'],
                 'status': 'open', 'payment_status': 'unpaid', 'expires_at': int(time.time()) + 3600,
                 'url': f'https://checkout.stripe.com/c/pay/{ident}'}
        self.sessions[ident] = value
        return dict(value)

    def retrieve(self, ident):
        return dict(self.sessions[ident])

    def settle(self, order_id, status):
        for value in self.sessions.values():
            if value['client_reference_id'] != order_id:
                continue
            if status == 'paid':
                value.update(status='complete', payment_status='paid')
            elif status == 'expired':
                value.update(status='expired', payment_status='unpaid')
            else:
                value.update(status='open', payment_status='unpaid')
            return True
        return False


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--origin', default='http://127.0.0.1:8791')
    parser.add_argument('--lifetime-seconds', type=int, default=900)
    parser.add_argument('--allow-identity-controls', action='store_true', help='仅临时库角色／停用测试控制，默认不注册')
    parser.add_argument('--sandbox-payments', action='store_true', help='仅临时库Stripe收银台替身与合成沙盒状态控制，默认不注册')
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if not (1024 <= args.port <= 65535 and 30 <= args.lifetime_seconds <= 3600
            and origin.scheme == 'http' and origin.hostname == '127.0.0.1' and origin.port
            and not (origin.username or origin.password or origin.path or origin.query or origin.fragment)):
        parser.error('Only an explicit numeric loopback origin/port and bounded lifetime are supported')
    connect = socket.socket.connect

    def local_connect(sock, address):
        if isinstance(address, tuple) and address[0] not in ('127.0.0.1', '::1'):
            forbidden()
        return connect(sock, address)

    with tempfile.TemporaryDirectory(prefix='yingxiang-vue-auth-') as directory, ExitStack() as guard:
        guard.enter_context(patch.object(Settings, 'load', forbidden))
        guard.enter_context(patch('socket.socket.connect', local_connect))
        settings = Settings(data_dir=Path(directory), public_origin=args.origin,
                            allowed_origins=(args.origin,), maintenance=False, env={})
        payments_double = None
        if args.sandbox_payments:
            # 合成沙盒开关与收银台替身：只在本临时进程内有效，不读取长期密钥。
            settings.env.update({'YINGXIANG_PAYMENTS_TEST_ENABLED': 'true',
                                 'STRIPE_SECRET_KEY': 'rk_test_synthetic_double_only',
                                 'STRIPE_WEBHOOK_SECRET': 'whsec_synthetic_double_only',
                                 'STRIPE_EXPECTED_ACCOUNT_ID': 'acct_synthetic_sandbox',
                                 # 合成视频服务配置仅用于观察管理暂停对创作入口的影响；不提交任务、不调用供应商。
                                 'YINGXIANG_VIDEO_ENABLED': 'true',
                                 'YINGXIANG_VIDEO_BUDGET_USD': '1',
                                 'YINGXIANG_VIDEO_MAX_JOBS': '1'})
            payments_double = SandboxStripe()
        initialize(settings)
        app = create_app(settings, stripe_client=payments_double)
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=args.port,
                                              access_log=False, log_level='error', proxy_headers=False))

        if args.allow_identity_controls:
            from sqlalchemy import select, update
            from app.models import users

            @app.post('/api/__migration/identity')
            async def identity(request: Request):
                local_origin(request, settings, True)
                body = await read_json(request, True)
                name, role, disabled = body.get('username'), body.get('role'), body.get('disabled', False)
                if not isinstance(name, str) or not name.startswith('scope_') or role not in ('user', 'admin') or not isinstance(disabled, bool):
                    raise BusinessError('BAD_REQUEST', 'Invalid synthetic identity control', 400)
                # 仅作用于本函数创建的临时库；不是产品授权API，不载入正式设置。
                with app.state.db.transaction(True) as session:
                    row = session.execute(select(users).where(users.c.username == name)).mappings().first()
                    if not row:
                        raise BusinessError('NOT_FOUND', 'Synthetic user missing', 404)
                    session.execute(update(users).where(users.c.id == row['id']).values(role=role, disabled=disabled))
                return private_json({'accepted': True})

        if args.sandbox_payments:
            @app.post('/api/__migration/sandbox-payment')
            async def sandbox_payment(request: Request):
                local_origin(request, settings, True)
                body = await read_json(request, True)
                order_id, status = body.get('orderId'), body.get('status')
                if not isinstance(order_id, str) or not UUID.fullmatch(order_id) or status not in ('open', 'paid', 'expired'):
                    raise BusinessError('BAD_REQUEST', 'Invalid synthetic sandbox payment control', 400)
                # 只改变本进程内收银台替身的状态，不产生真实扣款或履约通知。
                if not payments_double.settle(order_id, status):
                    raise BusinessError('NOT_FOUND', 'Synthetic sandbox session missing', 404)
                return private_json({'accepted': True, 'status': status})

        @app.post('/api/__migration/finish')
        async def finish(request: Request):
            local_origin(request, settings, True)
            server.should_exit = True
            return private_json({'accepted': True})

        async def bounded_server():
            async def deadline():
                await asyncio.sleep(args.lifetime_seconds)
                server.should_exit = True
            timer = asyncio.create_task(deadline())
            try:
                print('VUE_AUTH_FIXTURE_LOOPBACK_ONLY; TEMP_SQLITE; PROVIDERS_DISABLED' + ('; STRIPE_DOUBLE' if args.sandbox_payments else ''), flush=True)
                await server.serve()
            finally:
                timer.cancel()
                await asyncio.gather(timer, return_exceptions=True)

        asyncio.run(bounded_server())
    print('VUE_AUTH_FIXTURE_TEMP_REMOVED', flush=True)


if __name__ == '__main__':
    run()
