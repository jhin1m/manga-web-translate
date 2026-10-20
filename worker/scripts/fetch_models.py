"""Tải weights theo models.lock.json (đúng revision), kiểm sha256; file sai bị xoá."""

from __future__ import annotations

import sys

import httpx

from mtl_pipeline.models import load_lock, models_dir, sha256_file


def main() -> int:
    root = models_dir()
    root.mkdir(parents=True, exist_ok=True)
    for m in load_lock().models:
        dest = root / m.file
        if dest.is_file() and sha256_file(dest) == m.sha256:
            print(f"ok    {m.name}")
            continue
        print(f"fetch {m.name} <- {m.url}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        with httpx.stream("GET", m.url, follow_redirects=True, timeout=600) as r, tmp.open("wb") as f:
            r.raise_for_status()
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
        if sha256_file(tmp) != m.sha256:
            tmp.unlink()
            print(f"FAIL  {m.name}: sha256 lệch", file=sys.stderr)
            return 1
        tmp.rename(dest)
        print(f"ok    {m.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
