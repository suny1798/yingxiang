"""Vue账号联调专用旧FastAPI；临时SQLite、回环、禁止外联，不读取dotenv。"""
import argparse
import asyncio
from contextlib import ExitStack
from pathlib import Path
import socket
import tempfile
from unittest.mock import patch
from urllib.parse import urlsplit

import uvicorn
from fastapi import Request

from app.core import Settings, local_origin, private_json
from app.main import create_app
from scripts.ops import initialize


def forbidden(*_args, **_kwargs):
    raise RuntimeError('Fixture forbids production configuration or outbound network')


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--origin', default='http://127.0.0.1:8791')
    parser.add_argument('--lifetime-seconds', type=int, default=900)
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
        initialize(settings)
        app = create_app(settings)
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=args.port,
                                              access_log=False, log_level='error', proxy_headers=False))

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
                print('VUE_AUTH_FIXTURE_LOOPBACK_ONLY; TEMP_SQLITE; PROVIDERS_DISABLED', flush=True)
                await server.serve()
            finally:
                timer.cancel()
                await asyncio.gather(timer, return_exceptions=True)

        asyncio.run(bounded_server())
    print('VUE_AUTH_FIXTURE_TEMP_REMOVED', flush=True)


if __name__ == '__main__':
    run()
