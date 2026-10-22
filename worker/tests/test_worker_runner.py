"""Vòng đời 1 job ở worker: phân loại lỗi, 409 → bỏ job, partial khi lỗi provider, huỷ, token file."""

from __future__ import annotations

import os
from typing import Any

import numpy as np
import pytest

from mtl_pipeline.images import encode_png
from mtl_pipeline.providers.base import ProviderError
from mtl_pipeline.schema import BBox, OcrItem, OcrResult, Region, TokenUsage
from mtl_worker.client import LeaseLost
from mtl_worker.handlers import HANDLERS
from mtl_worker.runner import JobContext, run_job
from mtl_worker.token import TokenError, read_token_file

PAGE = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b"


def _page() -> np.ndarray:
    img = np.full((64, 48, 3), 255, np.uint8)
    img[6:18:2, 6:40] = 0  # "nét chữ" trong vùng t0 → OCR thật sự gọi provider
    return img


PNG = encode_png(_page())


class FakeClient:
    """Ghi lại mọi lệnh; `complete_error` giả lập 409 khi complete."""

    def __init__(self, complete_error: Exception | None = None, stop: str | None = None):
        self.calls: list[tuple[str, Any]] = []
        self.uploads: dict[str, bytes] = {}
        self.complete_error = complete_error
        self.stop = stop

    def heartbeat(
        self, job: dict[str, Any], progress: float, stage: str | None, usage: dict | None
    ) -> dict[str, Any]:
        self.calls.append(("heartbeat", usage))
        return {"lease_expires_at": "x", "stop": self.stop}

    def presign_outputs(self, job: dict[str, Any], names: list[str]) -> dict[str, dict[str, Any]]:
        return {n: {"key": n, "rev": 7, "put": f"put://{n}", "expires_at": "x"} for n in names}

    def complete(self, job: dict[str, Any], result: dict[str, Any], usage: dict | None) -> dict[str, Any]:
        self.calls.append(("complete", (result, usage)))
        if self.complete_error:
            raise self.complete_error
        return {"ok": True}

    def fail(
        self,
        job: dict[str, Any],
        error_class: str,
        message: str,
        retry_after_s: float | None = None,
        usage: dict | None = None,
        partial: dict | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "fail",
                {
                    "error_class": error_class,
                    "retry_after_s": retry_after_s,
                    "usage": usage,
                    "partial": partial,
                },
            )
        )
        return {"ok": True}

    def download(self, url: str) -> bytes:
        return PNG

    def upload_png(self, url: str, data: bytes) -> bool:
        self.uploads[url] = data
        return True

    def upload_file(self, url: str, path: str, headers: dict[str, str]) -> bool:
        with open(path, "rb") as f:
            self.uploads[url] = f.read()
        return True

    def names(self):
        return [c[0] for c in self.calls]


class FakePipeline:
    rtl: bool | None = None

    def prepare_image(self, img, rtl=False):
        self.rtl = rtl
        regs = [Region(id="t0", kind="text_free", bbox=BBox(x=2, y=2, w=40, h=20), score=0.9)]
        mask = np.zeros(img.shape[:2], np.uint8)
        return regs, mask, img.copy(), None


class FakeProvider:
    name, model = "fake", "gemini-2.5-flash"

    def __init__(self, error: ProviderError | None = None):
        self.error = error

    source_lang: str | None = None

    def ocr_page(self, req):
        self.source_lang = req.source_lang
        if self.error:
            raise self.error
        items = [OcrItem(id=c.id, source="안녕", confidence=0.9) for c in req.crops]
        return OcrResult(
            items=items,
            usage=[TokenUsage(provider="fake", model=self.model, input_tokens=10, output_tokens=5)],
        )

    def translate_batch(self, req):  # pragma: no cover - không dùng ở đây
        raise NotImplementedError


class Deps:
    def __init__(self, provider=None):
        self.pipeline = FakePipeline()
        self.provider = provider or FakeProvider()


def prepare_job() -> dict[str, Any]:
    return {
        "id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6c",
        "type": "page.prepare",
        "attempt": 1,
        "lease_token": "t" * 48,
        "lease_expires_at": "x",
        "payload": {"type": "page.prepare", "page_id": PAGE, "source_lang": "ko"},
        "inputs": {"original": "http://files/original.png", "partial": None},
        "outputs": {
            "clean": {"key": "c", "rev": 7, "put": "http://files/clean", "expires_at": "x"},
            "mask": {"key": "m", "rev": 7, "put": "http://files/mask", "expires_at": "x"},
        },
    }


def test_prepare_success_uploads_then_completes_with_usage():
    c = FakeClient()
    assert run_job(c, prepare_job(), HANDLERS, Deps()) == "succeeded"
    assert set(c.uploads) == {"http://files/clean", "http://files/mask"}
    result, usage = c.calls[-1][1]
    assert result["clean_rev"] == 7 and result["mask_rev"] == 7
    assert usage["llm_in"] == 10 and usage["calls"] == 1 and usage["seq"] == 1


def test_prepare_uses_payload_language_and_reading_order():
    # Payload cũ (không reading_order) → ltr; payload mới → truyền rtl + ngôn ngữ nguồn xuống detect/OCR.
    deps = Deps()
    run_job(FakeClient(), prepare_job(), HANDLERS, deps)
    assert deps.pipeline.rtl is False and deps.provider.source_lang == "ko"
    job = prepare_job()
    job["payload"] |= {"source_lang": "ja", "reading_order": "rtl"}
    deps = Deps()
    assert run_job(FakeClient(), job, HANDLERS, deps) == "succeeded"
    assert deps.pipeline.rtl is True and deps.provider.source_lang == "ja"


def test_rate_limit_is_reported_as_rate_limited_with_partial_and_usage():
    err = ProviderError(
        "rate_limit", "429", retry_after=42, usage=[TokenUsage(provider="f", model="m", input_tokens=3)]
    )
    c = FakeClient()
    assert run_job(c, prepare_job(), HANDLERS, Deps(FakeProvider(err))) == "failed"
    name, body = c.calls[-1]
    assert name == "fail"
    assert body["error_class"] == "rate_limited" and body["retry_after_s"] == 42
    assert body["partial"]["clean_rev"] == 7 and body["partial"]["regions"][0]["id"] == "t0"
    assert body["usage"]["llm_in"] == 3
    # Artifact trước LLM đã lên storage trước khi fail.
    assert set(c.uploads) == {"http://files/clean", "http://files/mask"}


def test_permanent_provider_error_counts_as_internal():
    c = FakeClient()
    run_job(c, prepare_job(), HANDLERS, Deps(FakeProvider(ProviderError("provider", "401", retryable=False))))
    assert c.calls[-1][1]["error_class"] == "internal"


def test_invalid_image_is_invalid_input():
    c = FakeClient()
    c.download = lambda url: b"not an image"  # type: ignore[method-assign]
    run_job(c, prepare_job(), HANDLERS, Deps())
    assert c.calls[-1][1]["error_class"] == "invalid_input"


def test_lease_lost_on_complete_drops_job_without_fail():
    c = FakeClient(complete_error=LeaseLost("409"))
    assert run_job(c, prepare_job(), HANDLERS, Deps()) == "aborted"
    assert "fail" not in c.names()


def test_cancel_from_heartbeat_stops_cleanly():
    c = FakeClient(stop="cancel")
    ctx = JobContext(c, prepare_job())
    ctx.heartbeat_once()
    assert ctx.cancelled.is_set()


def test_usage_delta_has_increasing_seq_and_is_restored_on_failure():
    ctx = JobContext(FakeClient(), prepare_job())
    ctx.add_usage([TokenUsage(provider="f", model="m", input_tokens=5, output_tokens=1)])
    u1 = ctx.take_usage()
    assert u1 and u1["seq"] == 1 and u1["llm_in"] == 5
    ctx.restore_usage(u1)
    u2 = ctx.take_usage()
    assert u2 and u2["seq"] == 2 and u2["llm_in"] == 5


def test_token_file_must_be_private(tmp_path):
    p = tmp_path / "worker.token"
    p.write_text("mtlw_secret\n")
    os.chmod(p, 0o644)
    with pytest.raises(TokenError):
        read_token_file(p)
    os.chmod(p, 0o600)
    assert read_token_file(p) == "mtlw_secret"
