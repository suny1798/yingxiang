from pathlib import Path
import shutil
import os

from app.core import ROOT


def main():
    source = ROOT.parent / "frontend"
    target = ROOT / "data/integration-frontend"
    target.mkdir(parents=True, exist_ok=False)
    for name in ("src", "public"):
        shutil.copytree(source / name, target / name)
    for name in ("package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "next-env.d.ts"):
        shutil.copyfile(source / name, target / name)
    # 仅隔离副本移除旧 API，运行源暂不动。
    for path in (target / "src/app/api").rglob("route.ts"):
        if path.parent.name != "[...path]":
            path.unlink()
    (target / ".env.local").write_text("NEXT_TELEMETRY_DISABLED=1\nYINGXIANG_API_ORIGIN=http://127.0.0.1:8790\n", encoding="utf-8")
    print("隔离前端已准备；依赖目录需用本机 junction 连接现有 node_modules。")


if __name__ == "__main__":
    main()
