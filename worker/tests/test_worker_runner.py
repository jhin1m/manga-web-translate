"""Vòng đời 1 job ở worker: phân loại lỗi, 409 → bỏ job, partial khi lỗi provider, huỷ, token file."""

from __future__ import annotations

import os
import time
from typing import Any

import numpy as np
import pytest

from mtl_pipeline.images import encode_png
from mtl_pipeline.providers.base import ProviderError
from mtl_pipeline.schema import BBox, OcrItem, OcrResult, Region, TokenUsage
from mtl_worker.client import LeaseLost
from mtl_worker.handlers import HANDLERS
from mtl_worker.runner import Heartbeat, JobContext, run_job
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
        #: (stage, done, total) của từng heartbeat theo thứ tự gửi.
        self.beats: list[tuple[str | None, int | None, int | None]] = []
        self.uploads: dict[str, bytes] = {}
        self.complete_error = complete_error
        self.stop = stop

    def heartbeat(
        self,
        job: dict[str, Any],
        progress: float,
        stage: str | None,
        usage: dict | None,
        done: int | None = None,
        total: int | None = None,
    ) -> dict[str, Any]:
        self.calls.append(("heartbeat", usage))
        self.beats.append((stage, done, total))
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
    opts: Any = None
    inpaint_args: tuple[str, int | None] | None = None

    def prepare_image(self, img, rtl=False, opts=None, on_stage=None):
        self.rtl = rtl
        self.opts = opts
        if on_stage:
            on_stage("inpaint")
        regs = [Region(id="t0", kind="text_free", bbox=BBox(x=2, y=2, w=40, h=20), score=0.9)]
        mask = np.zeros(img.shape[:2], np.uint8)
        return regs, mask, img.copy(), None

    def local_ocr(self, engine, source_lang, vertical=False):
        self.local_args = (engine, source_lang, vertical)

        class _Eng:
            name = engine

            def read(self, crop):
                return "こんにちは", 0.95

        return _Eng()

    def inpainter_for(self, name="big_lama", size=None):
        self.inpaint_args = (name, size)
        pipe = self

        class _Copy:
            def inpaint(self, img, mask):
                pipe.inpainted = True
                return img.copy(), np.zeros_like(mask)

        return _Copy()


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
    run_job(c, prepare_job(), HANDLERS, Deps(FakeProvider(ProviderError("provider", "404", retryable=False))))
    assert c.calls[-1][1]["error_class"] == "internal"


def test_rejected_api_key_is_auth():
    c = FakeClient()
    run_job(c, prepare_job(), HANDLERS, Deps(FakeProvider(ProviderError("auth", "401", retryable=False))))
    assert c.calls[-1][1]["error_class"] == "auth"


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


def test_prepare_passes_pipeline_options_old_payload_gets_defaults():
    from mtl_pipeline.options import PrepareOptions

    deps = Deps()
    run_job(FakeClient(), prepare_job(), HANDLERS, deps)
    assert deps.pipeline.opts == PrepareOptions()
    job = prepare_job()
    job["payload"]["pipeline"] = {
        "detector": "comic_text_detector",
        "detection_threshold": 0.5,
        "ocr_engine": "llm",
        "inpainter": "lama_manga",
        "mask_dilation": 3,
        "inpaint_size": 768,
    }
    deps = Deps()
    assert run_job(FakeClient(), job, HANDLERS, deps) == "succeeded"
    assert deps.pipeline.opts == PrepareOptions("comic_text_detector", 0.5, "llm", "lama_manga", 3, 768)


def test_reinpaint_uses_payload_inpainter():
    mask = np.zeros((64, 48), np.uint8)
    mask[10:20, 10:20] = 255

    class MaskClient(FakeClient):
        def download(self, url: str) -> bytes:
            return encode_png(mask) if "mask" in url else PNG

    job = {
        **prepare_job(),
        "type": "page.reinpaint",
        "payload": {
            "type": "page.reinpaint",
            "page_id": PAGE,
            "base_clean_rev": 1,
            "user_mask_key": "k",
            "offset": {"x": 0, "y": 0},
            "inpaint": {"inpainter": "lama_manga", "inpaint_size": 640},
        },
        "inputs": {"base_clean": "http://files/clean.png", "user_mask": "http://files/mask.png"},
        "outputs": {"clean": {"key": "c", "rev": 8, "put": "http://files/clean", "expires_at": "x"}},
    }
    deps = Deps()
    assert run_job(MaskClient(), job, HANDLERS, deps) == "succeeded"
    assert deps.pipeline.inpaint_args == ("lama_manga", 640)
    del job["payload"]["inpaint"]
    deps = Deps()
    assert run_job(MaskClient(), job, HANDLERS, deps) == "succeeded"
    assert deps.pipeline.inpaint_args == ("big_lama", 512)


class NoLlmProvider(FakeProvider):
    def ocr_page(self, req):  # pragma: no cover - không được gọi
        raise AssertionError("OCR local không được gọi LLM")


def test_prepare_with_local_ocr_skips_llm_and_reports_no_usage():
    job = prepare_job()
    job["payload"] |= {
        "source_lang": "ja",
        "reading_order": "rtl",
        "pipeline": {
            "detector": "rtdetr_v2_comic",
            "detection_threshold": 0.35,
            "ocr_engine": "manga_ocr",
            "inpainter": "big_lama",
            "mask_dilation": None,
            "inpaint_size": 512,
        },
    }
    c = FakeClient()
    deps = Deps(NoLlmProvider())
    assert run_job(c, job, HANDLERS, deps) == "succeeded"
    assert deps.pipeline.local_args == ("manga_ocr", "ja", True)
    result, usage = c.calls[-1][1]
    assert result["ocr_result"]["items"][0]["source"] == "こんにちは"
    assert usage is None or (usage["llm_in"] == 0 and usage["calls"] == 0)


def test_invalid_result_fails_with_usage_kept():
    # Kết quả sai hợp đồng (bắt ở worker trước khi complete) → fail internal, token đã trả tiền vẫn báo.
    def bad(ctx, deps):
        ctx.add_usage(
            [TokenUsage(provider="fake", model="gemini-2.5-flash", input_tokens=7, output_tokens=3)]
        )
        return {"type": "page.prepare", "clean_rev": "x"}

    c = FakeClient()
    assert run_job(c, prepare_job(), {"page.prepare": bad}, Deps()) == "failed"
    kind, info = c.calls[-1]
    assert kind == "fail" and info["error_class"] == "internal" and info["usage"]["llm_in"] == 7


# ---- heartbeat theo bước + đếm ----


def _run_handler(handler, heartbeat_s: float = 60, heartbeat_gap_s: float = 0.05) -> FakeClient:
    c = FakeClient()

    def wrapped(ctx, deps):
        handler(ctx)
        return {
            "type": "page.prepare",
            "clean_rev": 7,
            "mask_rev": 7,
            "ocr_result": {"regions": [], "items": []},
        }

    run_job(
        c,
        prepare_job(),
        {"page.prepare": wrapped},
        Deps(),
        heartbeat_s=heartbeat_s,
        heartbeat_gap_s=heartbeat_gap_s,
    )
    return c


def test_stage_change_sends_heartbeat_without_waiting_for_interval():
    def handler(ctx):
        ctx.report("detect", 0.05)
        time.sleep(0.3)

    c = _run_handler(handler)
    assert any(stage == "detect" for stage, _, _ in c.beats)


def test_rapid_stage_changes_are_throttled():
    def handler(ctx):
        for i in range(10):
            ctx.report(f"s{i}", i / 10)
            time.sleep(0.005)
        time.sleep(0.25)

    c = _run_handler(handler, heartbeat_gap_s=0.2)
    assert 1 <= len(c.beats) <= 2
    assert c.beats[-1][0] == "s9"


def test_progress_only_change_waits_for_interval():
    # Lần report đầu đổi stage (None → ocr) → 1 heartbeat; đổi progress cùng stage không đánh thức nữa.
    def handler(ctx):
        ctx.report("ocr", 0.1)
        time.sleep(0.1)
        for i in range(5):
            ctx.report("ocr", 0.2 + i / 10)
            time.sleep(0.02)
        time.sleep(0.1)

    c = _run_handler(handler)
    assert c.beats == [("ocr", None, None)]


def test_heartbeat_carries_done_and_total():
    def handler(ctx):
        ctx.report("upload", 0.8, done=3, total=12)
        time.sleep(0.2)

    c = _run_handler(handler)
    assert ("upload", 3, 12) in c.beats


def test_prepare_reports_inpaint_between_detect_and_ocr(monkeypatch):
    stages: list[str] = []
    real = JobContext.report

    def spy(self, stage, progress, done=None, total=None):
        stages.append(stage)
        real(self, stage, progress, done, total)

    monkeypatch.setattr(JobContext, "report", spy)
    assert run_job(FakeClient(), prepare_job(), HANDLERS, Deps()) == "succeeded"
    assert stages == ["detect", "inpaint", "ocr", "upload"]


class IngestCtx:
    """Ctx tối thiểu cho handle_ingest: ghi mọi lệnh report kèm đếm."""

    def __init__(self, n: int):
        self.inputs = {"sources": [{"source_file_id": f"f{i}", "url": f"http://src/{i}"} for i in range(n)]}
        self.payload = {"mode": "pages"}
        self.job = {"id": "j"}
        self.outputs: dict[str, Any] = {}
        self.client = FakeClient()
        self.reports: list[tuple[str, int | None, int | None]] = []

    def report(self, stage, progress, done=None, total=None):
        self.reports.append((stage, done, total))

    def download(self, url):
        return PNG

    def upload(self, name, data):
        pass


def test_ingest_counts_images_and_pages():
    from mtl_worker.ingest import handle_ingest

    ctx = IngestCtx(3)

    class _Det:
        def detect(self, img):  # pragma: no cover - mode pages không detect
            return []

    deps = Deps()
    deps.pipeline.detector = _Det()  # type: ignore[attr-defined]
    result = handle_ingest(ctx, deps)  # type: ignore[arg-type]
    n = len(result["pages"])
    downloads = [(d, t) for s, d, t in ctx.reports if s == "download"]
    assert {(k, 3) for k in (1, 2, 3)} <= set(downloads)
    uploads = [(d, t) for s, d, t in ctx.reports if s == "upload"]
    assert uploads and all(t == n for _, t in uploads)
    assert {d for d, _ in uploads} >= set(range(n))
    assert all(t is not None for s, _, t in ctx.reports if s == "cut")
    assert not any(s == "detect" for s, _, _ in ctx.reports)


def test_early_heartbeat_leaves_usage_for_complete():
    # Heartbeat sớm vì đổi bước chỉ mang tiến độ; usage vẫn đi theo nhịp thường / complete như trước.
    def handler(ctx):
        ctx.add_usage([TokenUsage(provider="f", model="m", input_tokens=5, output_tokens=1)])
        ctx.report("translate", 0.1)
        time.sleep(0.2)

    c = _run_handler(handler)
    assert c.beats and all(u is None for name, u in c.calls if name == "heartbeat")
    _, usage = c.calls[-1][1]
    assert usage["llm_in"] == 5


def test_full_beat_still_carries_usage_under_constant_stage_changes():
    # Đổi bước liên tục nhanh hơn min_gap: nhịp đầy đủ (gia hạn lease + usage) vẫn phải chạy đúng hạn.
    def handler(ctx):
        ctx.add_usage([TokenUsage(provider="f", model="m", input_tokens=5, output_tokens=1)])
        for i in range(40):
            ctx.report(f"s{i % 2}", 0.5)
            time.sleep(0.01)

    c = _run_handler(handler, heartbeat_s=0.15, heartbeat_gap_s=0.02)
    assert any(u for name, u in c.calls if name == "heartbeat")


def test_stop_arriving_just_before_wake_clear_is_not_lost():
    # __exit__ (set stop rồi wake) chen đúng lúc thread vừa thức dậy và sắp xoá cờ wake → thread vẫn phải thoát.
    ctx = JobContext(FakeClient(), prepare_job())
    hb = Heartbeat(ctx, interval=60, min_gap=0)
    real_clear = ctx.wake.clear

    def racing_clear():
        hb._stop.set()
        ctx.wake.set()
        real_clear()

    ctx.wake.clear = racing_clear  # type: ignore[method-assign]
    hb._t.start()
    ctx.report("detect", 0.05)
    hb._t.join(timeout=1)
    assert not hb._t.is_alive()
