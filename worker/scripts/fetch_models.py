"""Tải weights theo models.lock.json (đúng revision), kiểm sha256; file sai bị xoá.

Mặc định tải cả model optional (LaMa manga, OCR local) để worker không phải tải lazy giữa job; `--required` chỉ
tải model bắt buộc."""

from __future__ import annotations

import sys

from mtl_pipeline.models import ModelIntegrityError, download, load_lock, models_dir, sha256_file


def main() -> int:
    required_only = "--required" in sys.argv[1:]
    root = models_dir()
    root.mkdir(parents=True, exist_ok=True)
    for m in load_lock().models:
        if required_only and m.optional:
            continue
        dest = root / m.file
        if dest.is_file() and sha256_file(dest) == m.sha256:
            print(f"ok    {m.name}")
            continue
        print(f"fetch {m.name} <- {m.url}")
        try:
            download(m, dest)
        except ModelIntegrityError as e:
            print(f"FAIL  {e}", file=sys.stderr)
            return 1
        print(f"ok    {m.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
