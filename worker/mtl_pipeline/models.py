"""Đọc models.lock.json, kiểm sha256 trước khi nạp, từ chối định dạng có thể chứa pickle.

Model `optional` (chỉ dùng khi cài đặt pipeline của người dùng chọn: LaMa manga, OCR local) không bắt buộc lúc khởi
động; `ensure_model` tải lazy đúng URL/revision trong lock (kiểm sha256) lần đầu job cần."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from pathlib import Path

from pydantic import BaseModel

WORKER_DIR = Path(__file__).resolve().parent.parent
DEFAULT_LOCK = WORKER_DIR / "models.lock.json"
DEFAULT_MODELS_DIR = WORKER_DIR / "models"
# .txt/.json: tokenizer/vocab dạng văn bản (đọc như dữ liệu, không bao giờ unpickle).
SAFE_SUFFIXES = (".onnx", ".safetensors", ".txt", ".json")


class ModelIntegrityError(RuntimeError):
    pass


class ModelEntry(BaseModel):
    name: str
    file: str
    url: str
    revision: str
    sha256: str
    #: True → không kiểm lúc khởi động; tải lazy khi job cần (ensure_model).
    optional: bool = False


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
            raise ModelIntegrityError(f"{m.name}: chỉ chấp nhận {'/'.join(SAFE_SUFFIXES)}, gặp {m.file}")
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
    """Kiểm sha256 mọi model bắt buộc trong lock → {name: path}. Gọi một lần khi khởi động."""
    root = root or models_dir()
    out: dict[str, Path] = {}
    for m in load_lock(lock_path).models:
        if m.optional:
            continue
        p = root / m.file
        if not p.is_file():
            raise ModelIntegrityError(f"{m.name}: thiếu file {p} (tải theo worker/models/README.md)")
        digest = sha256_file(p)
        if digest != m.sha256:
            raise ModelIntegrityError(f"{m.name}: sha256 lệch ({digest} != {m.sha256})")
        out[m.name] = p
    return out


def download(m: ModelEntry, dest: Path) -> None:
    """Tải đúng URL (pin revision) vào file tạm cạnh dest, kiểm sha256 rồi mới đổi tên; sai → xoá, ném lỗi."""
    import tempfile

    import httpx

    dest.parent.mkdir(parents=True, exist_ok=True)
    # Tên tạm riêng mỗi lần: nhiều process chung thư mục model (Modal volume, 2 worker Mac) không ghi đè nhau.
    fd, name = tempfile.mkstemp(prefix=dest.name + ".", suffix=".part", dir=dest.parent)
    tmp = Path(name)
    try:
        with httpx.stream("GET", m.url, follow_redirects=True, timeout=600) as r, os.fdopen(fd, "wb") as f:
            r.raise_for_status()
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
        digest = sha256_file(tmp)
        if digest != m.sha256:
            raise ModelIntegrityError(f"{m.name}: sha256 lệch sau khi tải ({digest} != {m.sha256})")
        tmp.replace(dest)  # nguyên tử; process khác tải xong trước thì file giống hệt
    finally:
        tmp.unlink(missing_ok=True)


_ensure_lock = threading.Lock()
_verified: set[Path] = set()


def ensure_model(name: str, lock_path: Path = DEFAULT_LOCK, root: Path | None = None) -> Path:
    """Đường dẫn model `name` đã kiểm sha256; thiếu file → tải theo lock (log). Mỗi file chỉ kiểm 1 lần/process."""
    root = root or models_dir()
    entry = next((m for m in load_lock(lock_path).models if m.name == name), None)
    if entry is None:
        raise ModelIntegrityError(f"model {name} không có trong {lock_path.name}")
    p = root / entry.file
    with _ensure_lock:
        if p in _verified:
            return p
        if not p.is_file():
            logging.getLogger("mtl_pipeline").info("tải model %s <- %s", name, entry.url)
            download(entry, p)
        digest = sha256_file(p)
        if digest != entry.sha256:
            raise ModelIntegrityError(f"{name}: sha256 lệch ({digest} != {entry.sha256})")
        _verified.add(p)
    return p
