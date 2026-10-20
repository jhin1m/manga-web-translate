"""Đọc models.lock.json, kiểm sha256 trước khi nạp, từ chối định dạng có thể chứa pickle."""

from __future__ import annotations

import hashlib
import json
import logging
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


def ort_providers() -> list[str]:
    """Execution provider cho onnxruntime: MTL_ORT_PROVIDERS (phân tách dấu phẩy, VD
    `CUDAExecutionProvider,CPUExecutionProvider` trên Modal GPU); mặc định CPU (Mac). Provider không có trong bản
    onnxruntime đang cài bị bỏ qua, luôn còn CPU làm dự phòng."""
    import onnxruntime as ort

    wanted = [p.strip() for p in os.environ.get("MTL_ORT_PROVIDERS", "").split(",") if p.strip()]
    available = set(ort.get_available_providers())
    chosen = [p for p in wanted if p in available]
    missing = [p for p in wanted if p not in available]
    if missing:
        # MTL_ORT_STRICT=1 (Modal GPU): thiếu CUDA = lỗi khởi động, không âm thầm chạy CPU trên máy GPU tính tiền.
        if os.environ.get("MTL_ORT_STRICT") == "1":
            raise RuntimeError(f"onnxruntime thiếu provider {missing} (có: {sorted(available)})")
        logging.getLogger("mtl_pipeline").warning("onnxruntime thiếu provider %s → bỏ qua", missing)
    return [*chosen, "CPUExecutionProvider"] if "CPUExecutionProvider" not in chosen else chosen


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
