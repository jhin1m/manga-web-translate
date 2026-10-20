from __future__ import annotations

import hashlib
import json

import pytest

from mtl_pipeline.models import DEFAULT_LOCK, ModelIntegrityError, load_lock, verify_all


def _lock(tmp_path, entries):
    p = tmp_path / "models.lock.json"
    p.write_text(json.dumps({"models": entries}))
    return p


def _entry(name, file, sha):
    return {"name": name, "file": file, "url": "https://example/x", "revision": "abc", "sha256": sha}


def test_repo_lock_is_valid_and_safe_formats_only():
    lock = load_lock(DEFAULT_LOCK)
    names = {m.name for m in lock.models}
    assert names == {"rtdetr_v2_comic", "comic_text_detector", "big_lama"}
    for m in lock.models:
        assert m.file.endswith((".onnx", ".safetensors")) and len(m.sha256) == 64 and m.revision


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
