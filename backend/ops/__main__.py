"""M21-a 离线导入／核对 CLI。

示例（backend/ 下，DSN 只从环境读取，不进入命令行或日志）：
  python -m ops inventory --source <冻结源目录>
  python -m ops dry-run --source <冻结源目录>
  python -m ops import --source <冻结源目录> --schema yingxiang_migration_it_<12hex> \
      --storage <临时私有卷> --batch <批次ID> --rehearsal
  python -m ops verify --source <冻结源目录> --schema ... --storage ... --batch ...
  python -m ops seal --source ... --schema ... --storage ... --batch ...
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from .contract import IMPORTER_VERSION
from .errors import OpsError, UsageError
from .source import Source
from .target import Target


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m ops", description="M21-a 全量导入与核对工具")
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("inventory", "dry-run"):
        item = sub.add_parser(action)
        item.add_argument("--source", required=True)
        item.add_argument("--details", type=Path)
    for action in ("import", "verify", "seal"):
        item = sub.add_parser(action)
        item.add_argument("--source", required=True)
        item.add_argument("--schema", required=True)
        item.add_argument("--storage", required=True)
        item.add_argument("--batch", required=True)
        item.add_argument("--dsn-env", default="YINGXIANG_IMPORT_DSN")
        item.add_argument("--details", type=Path)
        if action == "import":
            item.add_argument("--rehearsal", action="store_true",
                              help="仅演练：允许 YINGXIANG_M21A_FAULT 故障注入，不用于最终导入")
    return parser


def _write_details(path: Path | None, value: object) -> None:
    if path is None:
        return
    path = path.absolute()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        source = Source.load(args.source)
        if args.action in ("inventory", "dry-run"):
            report = source.summary()
            report["ok"] = True
            report["mode"] = args.action
            report["writes"] = False
            _write_details(args.details, {"source": source.manifest, "report": report})
            print(json.dumps(report, ensure_ascii=True, sort_keys=True))
            return 0

        fault = os.environ.get("YINGXIANG_M21A_FAULT")
        if fault and not getattr(args, "rehearsal", False):
            raise UsageError("FAULT_INJECTION_REQUIRES_REHEARSAL")
        dsn = os.environ.get(args.dsn_env, "")
        if not dsn:
            raise UsageError("TARGET_DSN_MISSING")
        target = Target(source, dsn, args.schema, args.storage, args.batch,
                        rehearsal=bool(getattr(args, "rehearsal", False)))
        try:
            if args.action == "import":
                report = target.import_source()
            elif args.action == "verify":
                report = target.verify()
                report["mode"] = "verify"
            else:
                report = target.seal()
            report.setdefault("importerVersion", IMPORTER_VERSION)
            _write_details(args.details, {"source": source.manifest, "report": report})
            print(json.dumps(report, ensure_ascii=True, sort_keys=True))
            return 0 if report.get("ok") else 5
        finally:
            target.close()
    except OpsError as error:
        print(json.dumps({"ok": False, "code": error.code}, ensure_ascii=True, sort_keys=True),
              file=sys.stderr)
        return error.exit_code
    except KeyboardInterrupt:
        print(json.dumps({"ok": False, "code": "INTERRUPTED"}), file=sys.stderr)
        return 130
    except Exception:
        print(json.dumps({"ok": False, "code": "OPS_FAILED"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
