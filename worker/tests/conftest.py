from __future__ import annotations

import pytest

from mtl_pipeline.models import DEFAULT_MODELS_DIR, load_lock


def model_file(name: str):
    entry = next(m for m in load_lock().models if m.name == name)
    return DEFAULT_MODELS_DIR / entry.file


def needs_model(name: str):
    """Test dùng weight thật: bỏ qua khi máy chưa tải (CI không có weights)."""
    return pytest.mark.skipif(not model_file(name).is_file(), reason=f"thiếu weight {name}")
