"""M10-a 可执行 Jar 本机 HTTP 验收；不读取 dotenv、不连接数据库。"""
from __future__ import annotations

import http.client
import argparse
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time


def main() -> None:
    parser = argparse.ArgumentParser(description="Java关闭边界本机验收")
    parser.add_argument("--profile", choices=("offline", "local"), default="offline")
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    jar = backend / "target/yingxiang-backend-0.1.0.jar"
    if not jar.is_file():
        raise SystemExit("先在 backend 执行 .\\mvnw.cmd verify")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    # 随机回环端口避免占用开发服务；日志只留本机临时文件，不打印环境配置。
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(
            ["java", "-jar", str(jar), f"--server.port={port}", f"--spring.profiles.active={args.profile}"],
            cwd=backend, stdout=log, stderr=log,
        )
        try:
            def request(method: str, path: str, **headers: str):
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                try:
                    connection.request(method, path, headers={"Host": "127.0.0.1:8791", **headers})
                    response = connection.getresponse()
                    return response.status, dict(response.getheaders()), response.read()
                finally:
                    connection.close()

            deadline = time.monotonic() + 45
            while True:
                if process.poll() is not None:
                    raise AssertionError("Java进程提前退出；请单独运行Jar检查本机启动条件")
                try:
                    assert request("GET", "/api/internal/live")[0] == 200
                    break
                except (OSError, AssertionError):
                    if time.monotonic() > deadline:
                        raise AssertionError("Java启动超过45秒")
                    time.sleep(0.2)
            checks = 1
            if args.profile == "local":
                direct = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                try:
                    direct.request("GET", "/api/internal/live")
                    assert direct.getresponse().status == 200
                    checks += 1
                finally:
                    direct.close()
            for method, path, expected, headers in [
                ("GET", "/api/internal/ready", 503, {}),
                ("GET", "/api/admin/overview", 503, {}),
                ("GET", "/api/not-real", 404, {}),
                ("GET", "/api/internal/live", 403, {"Origin": "https://evil.example"}),
                ("GET", "/api/internal/live", 403, {"Host": "evil.example", "X-Forwarded-Host": "127.0.0.1:8791"}),
                ("POST", "/api/internal/live", 403, {}),
                ("POST", "/api/internal/live", 405, {"Origin": "http://127.0.0.1:8791"}),
                ("HEAD", "/api/internal/live", 200, {}),
                ("OPTIONS", "/api/internal/live", 204, {}),
            ]:
                status, result_headers, body = request(method, path, **headers)
                assert status == expected, (method, path, status, expected)
                assert result_headers.get("Cache-Control") == "no-store"
                assert result_headers.get("X-Content-Type-Options") == "nosniff"
                assert not {"set-cookie", "www-authenticate", "location"}.intersection(k.lower() for k in result_headers)
                if method == "HEAD" or expected == 204:
                    assert body == b""
                else:
                    json.loads(body)
                checks += 1
            print(f"Java Jar真实HTTP检查通过：{checks}项；仅本机回环，无数据库/Redis认证。")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for option in [
            "--spring.profiles.active=production",
            "--server.address=0.0.0.0",
            "--migration.maintenance=false",
            "--server.forward-headers-strategy=framework",
        ]:
            result = subprocess.run(
                ["java", "-jar", str(jar), f"--server.port={port}", option],
                cwd=backend, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20,
            )
            assert result.returncode != 0 and b"M10-a requires" in result.stdout, "隔离配置未按预期拒绝启动"
        print("Java Jar不安全启动配置拒绝检查通过：4项。")


if __name__ == "__main__":
    main()
