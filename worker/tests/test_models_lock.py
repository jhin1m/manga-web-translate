from __future__ import annotations

import hashlib
import json

import pytest

from mtl_pipeline import models
from mtl_pipeline.models import DEFAULT_LOCK, ModelIntegrityError, ensure_model, load_lock, verify_all


def _lock(tmp_path, entries):
    p = tmp_path / "models.lock.json"
    p.write_text(json.dumps({"models": entries}))
    return p


def _entry(name, file, sha):
    return {"name": name, "file": file, "url": "https://example/x", "revision": "abc", "sha256": sha}


def test_repo_lock_is_valid_and_safe_formats_only():
    lock = load_lock(DEFAULT_LOCK)
    names = {m.name for m in lock.models}
    assert {"rtdetr_v2_comic", "comic_text_detector", "big_lama", "lama_manga"} <= names
    required = {m.name for m in lock.models if not m.optional}
    assert required == {"rtdetr_v2_comic", "comic_text_detector", "big_lama"}
    for m in lock.models:
        assert m.file.endswith((".onnx", ".safetensors", ".txt")) and len(m.sha256) == 64 and m.revision
        # URL pin đúng revision (không trỏ nhánh động như main).
        assert m.revision in m.url


def test_verify_ok(tmp_path):
    f = tmp_path / "m.onnx"
    f.write_bytes(b"weights")
    lock = _lock(tmp_path, [_entry("m", "m.onnx", hashlib.sha256(b"weights").hexdigest())])
    assert verify_all(lock, tmp_path) == {"m": f}


def test_sha_mismatch_rejected(tmp_path):
    (tmp_path / "m.onnx").write_bytes(b"tampered")
    lock = _lock(tmp_path, [_entry("m", "m.onnx", hashlib.sha256(b"weights").hexdigest())])
    with pytest.raises(ModelIntegrityError, match="sha256"):
        verify_all(lock, tmp_path)


@pytest.mark.parametrize("fname", ["m.pt", "m.ckpt", "m.pkl", "m.bin"])
def test_pickle_formats_rejected(tmp_path, fname):
    lock = _lock(tmp_path, [_entry("m", fname, "0" * 64)])
    with pytest.raises(ModelIntegrityError, match="onnx"):
        load_lock(lock)


def test_missing_file(tmp_path):
    lock = _lock(tmp_path, [_entry("m", "m.onnx", "0" * 64)])
    with pytest.raises(ModelIntegrityError, match="thiếu"):
        verify_all(lock, tmp_path)


def test_optional_model_not_required_at_startup_and_fetched_lazily(tmp_path, monkeypatch):
    sha = hashlib.sha256(b"weights").hexdigest()
    lock = _lock(tmp_path, [{**_entry("opt", "opt.onnx", sha), "optional": True}])
    assert verify_all(lock, tmp_path) == {}
    fetched = []

    def fake_download(m, dest):
        fetched.append(m.name)
        dest.write_bytes(b"weights")

    monkeypatch.setattr(models, "download", fake_download)
    assert ensure_model("opt", lock, tmp_path) == tmp_path / "opt.onnx"
    assert ensure_model("opt", lock, tmp_path) == tmp_path / "opt.onnx"
    assert fetched == ["opt"]


def test_ensure_model_rejects_tampered_file(tmp_path):
    (tmp_path / "opt.onnx").write_bytes(b"tampered")
    lock = _lock(
        tmp_path, [{**_entry("opt", "opt.onnx", hashlib.sha256(b"x").hexdigest()), "optional": True}]
    )
    with pytest.raises(ModelIntegrityError, match="sha256"):
        ensure_model("opt", lock, tmp_path)


def test_session_options_flush_denormals_to_zero_and_set_threads():
    # x86 CPU xử lý số denormal rất chậm (CTD chậm ~13× so với Apple Silicon vốn tự flush) → mọi session phải bật.
    so = models.session_options(threads=3)
    assert so.get_session_config_entry("session.set_denormal_as_zero") == "1"
    assert so.intra_op_num_threads == 3
    assert models.session_options().intra_op_num_threads == 0


def test_every_onnx_loader_goes_through_ort_session():
    # Không còn module nào tự tạo SessionOptions (dễ quên cờ denormal khi thêm model mới).
    from pathlib import Path

    src = Path(models.__file__).resolve().parent
    offenders = [
        str(p.relative_to(src))
        for p in src.rglob("*.py")
        if "vendor" not in p.parts and p.name != "models.py" and "SessionOptions(" in p.read_text()
    ]
    assert offenders == []
