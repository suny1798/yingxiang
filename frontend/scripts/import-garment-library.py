"""从用户提供的衣装集生成本站素材（Python 3.12 / Pillow 12.2.0）。不改写源文件。"""
import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
target = root / "public/assets/garments"
target.mkdir(parents=True, exist_ok=True)
mapping = json.loads((args.source / "标签映射.json").read_text(encoding="utf-8-sig"))
manifest = json.loads((args.source / "manifest.json").read_text(encoding="utf-8-sig"))

def convert(row):
    source = args.source / row["文件"].replace("\\", "/")
    tags = mapping["映射"][source.name]
    item = {"id": row["id"], "season": tags["季节中文"], "tags": tags["标签英文"]}
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        for name, size, quality in [("thumb", (384, 576), 80), ("full", (1024, 1536), 86)]:
            folder = target / name
            folder.mkdir(exist_ok=True)
            output = folder / f'{row["id"]}.webp'
            copy = image.copy()
            copy.thumbnail(size, Image.Resampling.LANCZOS)
            copy.save(output, "WEBP", quality=quality, method=4)
    return item, {"id": row["id"], "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest()}

with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(convert, manifest))
catalog = {"labels": mapping["标签词典"], "items": [item for item, _ in results]}
(root / "src/lib/garment-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
# Java仅保留公开ID白名单，随同一素材导入同步，防止接受不存在的服装。
(root.parent / "backend/src/main/resources/garment-library-ids.txt").write_text("\n".join(item["id"] for item in catalog["items"]) + "\n", encoding="utf-8")
provenance = {"source": mapping["来源"], "importDate": "2026-10-29", "count": len(results), "note": "用户指定本机衣装集；沿用源标签，不代表本站生成效果。仅供本机受控展示；公开发布前另核查素材使用许可。", "files": [entry for _, entry in results]}
(target / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"count": len(results), "webpBytes": sum(p.stat().st_size for p in target.rglob("*.webp"))}))
