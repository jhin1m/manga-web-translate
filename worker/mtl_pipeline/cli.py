"""CLI: mtl check | mtl prepare <dir> | mtl translate <dir> | mtl run <dir> | mtl bench <golden>."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .fonts import DEFAULT_FONT
from .translate import SeriesSettings


def _settings(path: str | None) -> SeriesSettings:
    if not path:
        return SeriesSettings()
    data = json.loads(Path(path).read_text())
    return SeriesSettings(
        glossary=data.get("glossary", {}),
        pronoun_rules=data.get("pronoun_rules", ""),
        honorific_policy=data.get("honorific_policy", SeriesSettings().honorific_policy),
    )


def _out(args: argparse.Namespace) -> Path:
    return Path(args.out) if args.out else Path(args.dir) / "_mtl"


def main(argv: list[str] | None = None) -> int:
    # Không bao giờ tải model ngầm từ HF khi chạy; weights đi theo models.lock.json.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

    ap = argparse.ArgumentParser(prog="mtl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="kiểm raqm + sha256 model")

    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("dir")
        p.add_argument("--out", help="thư mục artifact (mặc định <dir>/_mtl)")
        p.add_argument("--provider", default="gemini", choices=["gemini", "anthropic"])

    p_prep = sub.add_parser("prepare", help="giai đoạn 1: detect, mask, inpaint, OCR LLM")
    add_common(p_prep)
    p_prep.add_argument("--workers", type=int, default=2)
    p_prep.add_argument("--no-ocr", action="store_true", help="bỏ OCR (không cần API key)")

    p_tr = sub.add_parser("translate", help="giai đoạn 2: dịch theo lô + typeset + render")
    add_common(p_tr)
    p_tr.add_argument("--context", default="rolling", choices=["rolling", "none"])
    p_tr.add_argument("--series", help="JSON {glossary, pronoun_rules, honorific_policy}")
    p_tr.add_argument("--font", default=DEFAULT_FONT)
    p_tr.add_argument("--narration-font", help="font chữ ngoài bóng (mặc định = --font)")

    p_run = sub.add_parser("run", help="cả 2 giai đoạn")
    add_common(p_run)
    p_run.add_argument("--workers", type=int, default=2)
    p_run.add_argument("--context", default="rolling", choices=["rolling", "none"])
    p_run.add_argument("--series")
    p_run.add_argument("--font", default=DEFAULT_FONT)
    p_run.add_argument("--narration-font", help="font chữ ngoài bóng (mặc định = --font)")

    p_bench = sub.add_parser("bench", help="đo golden set → bench.csv + blind.html")
    p_bench.add_argument("golden")
    p_bench.add_argument("--out", default=None)
    p_bench.add_argument("--providers", default="gemini,anthropic")

    args = ap.parse_args(argv)

    if args.cmd == "check":
        from .models import verify_all
        from .render import require_raqm

        require_raqm()
        for name, path in verify_all().items():
            print(f"ok {name} {path}")
        return 0

    if args.cmd == "bench":
        from .bench import run_bench

        out = Path(args.out) if args.out else Path(args.golden) / "_bench"
        run_bench(Path(args.golden), out, args.providers.split(","))
        return 0

    from .pipeline import Pipeline, translate_dir
    from .providers import make_provider

    out = _out(args)
    if args.cmd in ("prepare", "run"):
        provider = None if getattr(args, "no_ocr", False) else make_provider(args.provider)
        timings, failures = Pipeline().prepare_dir(Path(args.dir), out, provider, workers=args.workers)
        print(f"prepare xong {len(timings)} trang → {out}")
        for stem, err in failures.items():
            print(f"LỖI {stem}: {err}", file=sys.stderr)
        if failures:
            return 1
    if args.cmd in ("translate", "run"):
        states = translate_dir(
            out,
            make_provider(args.provider),
            _settings(args.series),
            args.context,
            args.font,
            narration_font_id=args.narration_font,
        )
        print(f"translate xong {len(states)} trang → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
