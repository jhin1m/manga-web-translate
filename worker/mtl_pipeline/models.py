"""Đọc models.lock.json, kiểm sha256 trước khi nạp, từ chối định dạng có thể chứa pickle."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from pydantic import BaseModel

WORKER_DIR = Path(__file__).resolve().parent.parent
DEFAULT_LOCK = WORKER_DIR / "models.lock.json"
DEFAULT_MODELS_DIR = WORKER_DIR / "models"
SAFE_SUFFIXES = (".onnx", ".safetensors")


class ModelIntegrityError(RuntimeError):
    pass


class ModelEntry(BaseModel):
    name: str
    file: str
    url: str
    revision: str
    sha256: str


class ModelsLock(BaseModel):
    models: list[ModelEntry]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_lock(lock_path: Path = DEFAULT_LOCK) -> ModelsLock:
    lock = ModelsLock.model_validate(json.loads(lock_path.read_text()))
    for m in lock.models:
        if not m.file.endswith(SAFE_SUFFIXES):
            raise ModelIntegrityError(f"{m.name}: chỉ chấp nhận .onnx/.safetensors, gặp {m.file}")
    return lock


def models_dir() -> Path:
    return Path(os.environ.get("MTL_MODELS_DIR", DEFAULT_MODELS_DIR))


def verify_all(lock_path: Path = DEFAULT_LOCK, root: Path | None = None) -> dict[str, Path]:
    """Kiểm sha256 mọi model trong lock → {name: path}. Gọi một lần khi khởi động."""
    root = root or models_dir()
    out: dict[str, Path] = {}
    for m in load_lock(lock_path).models:
        p = root / m.file
        if not p.is_file():
            raise ModelIntegrityError(f"{m.name}: thiếu file {p} (tải theo worker/models/README.md)")
        digest = sha256_file(p)
        if digest != m.sha256:
            raise ModelIntegrityError(f"{m.name}: sha256 lệch ({digest} != {m.sha256})")
        out[m.name] = p
    return out
