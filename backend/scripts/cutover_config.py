"""一次性本机配置迁移；不输出真实值，不通过命令行传递密钥。"""
from pathlib import Path
import argparse
import os
from dotenv import dotenv_values
from app.core import ROOT


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, required=True)
    args = parser.parse_args()
    snapshot = args.snapshot.resolve()
    if not (snapshot / "manifest.json").is_file():
        raise ValueError("必须先完成停写快照")
    source = ROOT.parent / "frontend/.env.local"
    target = ROOT / ".env"
    if target.exists():
        raise ValueError("后端配置已存在；禁止覆盖")
    backup = snapshot / "frontend.env.local"
    with backup.open("xb") as stream:
        stream.write(source.read_bytes())
    os.chmod(backup, 0o600)
    defaults = dotenv_values(ROOT / ".env.example")
    old = dotenv_values(source)
    names = {key for key in defaults if key.startswith(("YINGXIANG_", "DECART_", "STRIPE_"))}
    env = {**defaults, **{k: v for k, v in old.items() if k in names}}
    env["MAINTENANCE"], env["SQLITE_JOURNAL_MODE"] = "true", "DELETE"
    def encode(values):
        import json
        return "".join(f"{key}={json.dumps(value or '', ensure_ascii=False)}\n" for key, value in values.items())
    with target.open("x", encoding="utf-8") as stream:
        stream.write(encode(env))
    os.chmod(target, 0o600)
    front = {k: v for k, v in old.items() if k not in names}
    front["YINGXIANG_API_ORIGIN"] = "http://127.0.0.1:8788"
    source.write_text(encode(front), encoding="utf-8")
    print("配置已迁入后端；旧配置保存在私有快照中；维护模式开启。")


if __name__ == "__main__":
    main()
