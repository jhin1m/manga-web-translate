"""Mọi JobType dùng chung phải có handler ở worker (hoặc được hoãn tường minh) — red team #3."""

from __future__ import annotations

import json

from mtl_pipeline.schema import schema_dir
from mtl_worker.handlers import HANDLERS, LLM_TYPES
from mtl_worker.runner import DEFERRED_TYPES, inputs_schema


def job_types() -> set[str]:
    schema = json.loads((schema_dir() / "job-type.schema.json").read_text())
    return set(schema["enum"])


def test_every_job_type_has_handler_or_is_deferred():
    assert set(HANDLERS) | set(DEFERRED_TYPES) == job_types()
    assert not set(HANDLERS) & set(DEFERRED_TYPES)


def test_llm_types_are_known_job_types():
    assert job_types() >= LLM_TYPES


def test_every_handled_job_type_has_an_inputs_schema():
    # `page.ocr_region` từng tra `inputs-page-ocr_region` (file thật: `inputs-page-ocr-region`) → OCR vùng / dịch lại
    # khối hỏng "thiếu JSON Schema" trên worker thật.
    missing = [t for t in HANDLERS if not (schema_dir() / f"{inputs_schema(t)}.schema.json").exists()]
    assert missing == []
