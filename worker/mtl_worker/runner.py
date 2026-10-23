"""Chạy 1 job đã claim: heartbeat thread riêng (stage + usage delta mỗi 20s), handler theo JobType, upload output
qua presigned PUT, complete/fail. 409 ở bất kỳ bước nào → bỏ job ngay, không retry (fencing, red team #2)."""

from __future__ import annotations

import hashlib
import io
import logging
import threading
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
from PIL import Image

from mtl_pipeline.images import ImageRejected, check_header, encode_png
from mtl_pipeline.providers.base import LLMProvider, ProviderError
from mtl_pipeline.schema import BBox, ContractError, Region, TokenUsage, validate_contract

from .client import LeaseLost, WorkerApi
from .job_fonts import job_fonts

log = logging.getLogger("mtl_worker")

HEARTBEAT_S = 20.0

# Loại job chưa có handler ở worker (phase sau) — không khai trong capabilities.
DEFERRED_TYPES: dict[str, str] = {}


class JobAborted(RuntimeError):
    """Dừng sạch: lease mất (409), người dùng huỷ, hoặc worker đang tắt quá hạn chờ."""


@dataclass
class JobFailure(Exception):
    """Lỗi đã phân loại gửi lên `fail`."""

    error_class: str  # provider | rate_limited | schema | invalid_input | internal
    message: str
    retry_after_s: float | None = None
    partial: dict[str, Any] | None = None
    usage: list[TokenUsage] = field(default_factory=list)

    def __str__(self) -> str:
        return f"{self.error_class}: {self.message}"


def classify_provider_error(e: ProviderError) -> JobFailure:
    """Map lớp lỗi pipeline → ErrorClass dùng chung. Lỗi 4xx vĩnh viễn (sai key, model không có) → internal:
    tính attempt và dừng sau max_attempts thay vì thử lại 20 lần như lỗi tạm thời."""
    if not e.retryable:
        cls = "internal"
    else:
        cls = {"rate_limit": "rate_limited", "provider": "provider", "schema": "schema"}[e.error_class]
    return JobFailure(cls, str(e), retry_after_s=e.retry_after, usage=list(e.usage))


class Deps(Protocol):
    """Tài nguyên nạp 1 lần cho cả vòng đời worker."""

    @property
    def pipeline(self) -> Any: ...

    @property
    def provider(self) -> LLMProvider: ...

    def provider_for(self, tier: str) -> Any:
        """Provider theo tier model (AI hiệu đính: standard | premium)."""
        ...


class JobContext:
    def __init__(self, client: WorkerApi, job: dict[str, Any], deadline: Callable[[], bool] | None = None):
        self.client = client
        self.job = job
        self.payload: dict[str, Any] = job["payload"]
        self.inputs: dict[str, Any] = job["inputs"]
        self.outputs: dict[str, dict[str, Any]] = dict(job["outputs"])
        self._deadline = deadline or (lambda: False)
        self._lock = threading.Lock()
        self._progress = 0.0
        self._stage: str | None = None
        self._seq = 0
        self._pending: dict[str, Any] = {"model": None, "llm_in": 0, "llm_out": 0, "calls": 0}
        self._gpu_started = time.monotonic()
        self._gpu_reported = 0.0
        self.lost = threading.Event()
        self.cancelled = threading.Event()
        #: Lý do server bảo dừng: "cancel" (người dùng huỷ) hoặc "paused_budget" (kill-switch ngân sách).
        self.stop_reason: str | None = None

    # ---- tiến độ / huỷ ----

    def report(self, stage: str, progress: float) -> None:
        with self._lock:
            self._stage, self._progress = stage, max(0.0, min(1.0, progress))
        self.check()

    def check(self) -> None:
        if self.lost.is_set():
            raise JobAborted("lease lost")
        if self.cancelled.is_set():
            raise JobAborted(self.stop_reason or "cancelled")
        if self._deadline():
            raise JobFailure("internal", "worker shutting down")

    # ---- usage (số đếm thô; server clamp + tính tiền) ----

    def add_usage(self, usages: list[TokenUsage]) -> None:
        with self._lock:
            for u in usages:
                self._pending["model"] = u.model
                self._pending["llm_in"] += u.input_tokens
                self._pending["llm_out"] += u.output_tokens
                self._pending["calls"] += 1

    def take_usage(self) -> dict[str, Any] | None:
        """Delta từ lần báo trước, gắn seq tăng dần; None khi không có gì mới."""
        with self._lock:
            gpu = time.monotonic() - self._gpu_started - self._gpu_reported
            p = self._pending
            if not (p["llm_in"] or p["llm_out"] or p["calls"] or gpu >= 1.0):
                return None
            self._seq += 1
            out = {**p, "seq": self._seq, "gpu_s": round(max(gpu, 0.0), 3)}
            self._gpu_reported += max(gpu, 0.0)
            self._pending = {"model": p["model"], "llm_in": 0, "llm_out": 0, "calls": 0}
            return out

    def restore_usage(self, u: dict[str, Any] | None) -> None:
        """Gửi usage thất bại (mạng) → cộng lại để lần sau gửi, seq mới."""
        if not u:
            return
        with self._lock:
            for k in ("llm_in", "llm_out", "calls"):
                self._pending[k] += u[k]
            self._pending["model"] = self._pending["model"] or u["model"]
            self._gpu_reported -= u["gpu_s"]

    # ---- heartbeat ----

    def heartbeat_once(self) -> None:
        with self._lock:
            progress, stage = self._progress, self._stage
        usage = self.take_usage()
        try:
            res = self.client.heartbeat(self.job, progress, stage, usage)
        except LeaseLost:
            self.lost.set()
            return
        except Exception as e:  # mạng chập chờn: lease còn ~100s, thử lại ở nhịp sau
            self.restore_usage(usage)
            log.warning("heartbeat %s lỗi: %s", self.job["id"], e)
            return
        # Cả hai: server đã kết thúc lease → dừng sạch, không gọi complete/fail (job về paused_budget không mất
        # attempt; server giữ artifact đã ghi của attempt trước).
        if res.get("stop") in ("cancel", "paused_budget"):
            self.stop_reason = res["stop"]
            self.cancelled.set()

    # ---- I/O ----

    def download(self, url: str) -> bytes:
        return self.client.download(url)

    def upload(self, name: str, data: bytes) -> None:
        """PUT output; URL hết hạn → xin lại qua presign-outputs (fenced, cùng rev) rồi thử 1 lần nữa."""
        out = self.outputs.get(name)
        if out is None or not self.client.upload_png(out["put"], data):
            self.outputs.update(self.client.presign_outputs(self.job, [name]))
            if not self.client.upload_png(self.outputs[name]["put"], data):
                raise JobFailure("internal", f"upload {name}: presigned URL bị từ chối")


class Heartbeat:
    def __init__(self, ctx: JobContext, interval: float = HEARTBEAT_S):
        self.ctx, self.interval = ctx, interval
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, name=f"hb-{ctx.job['id'][:8]}", daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            self.ctx.heartbeat_once()
            if self.ctx.lost.is_set():
                return

    def __enter__(self) -> Heartbeat:
        self._t.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        self._t.join(timeout=5)


# ---- tiện ích ảnh / chuyển đổi kiểu ----


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def open_gray(data: bytes) -> np.ndarray:
    check_header(data)
    with Image.open(io.BytesIO(data), formats=["PNG"]) as im:
        return np.asarray(im.convert("L")).copy()


def png_bytes(arr: np.ndarray) -> tuple[bytes, str]:
    data = encode_png(arr)
    return data, hashlib.sha256(data).hexdigest()


def region_to_shared(r: Region) -> dict[str, Any]:
    """Region pipeline → OcrRegion dùng chung (bbox [x, y, w, h])."""
    return {
        "id": r.id,
        "kind": r.kind,
        "bbox": [r.bbox.x, r.bbox.y, r.bbox.w, r.bbox.h],
        "polarity": r.polarity,
        "bubble_id": r.bubble_id,
        "text_color": r.text_color,
        "outline_color": r.outline_color,
    }


def region_from_shared(d: dict[str, Any], is_sfx: bool = False) -> Region:
    x, y, w, h = (int(round(v)) for v in d["bbox"])
    return Region(
        id=d["id"],
        kind=d["kind"],
        bbox=BBox(x=x, y=y, w=w, h=h),
        score=1.0,
        bubble_id=d.get("bubble_id"),
        polarity=d["polarity"],
        text_color=d.get("text_color"),
        outline_color=d.get("outline_color"),
        is_sfx=is_sfx,
    )


Handler = Callable[[JobContext, Deps], dict[str, Any]]


def run_job(
    client: WorkerApi,
    job: dict[str, Any],
    handlers: dict[str, Handler],
    deps: Deps,
    deadline: Callable[[], bool] | None = None,
    heartbeat_s: float = HEARTBEAT_S,
) -> str:
    """→ "succeeded" | "failed" | "aborted". Không ném lỗi ra ngoài (vòng lặp worker đi tiếp job sau)."""
    ctx = JobContext(client, job, deadline)
    try:
        with Heartbeat(ctx, heartbeat_s):
            try:
                validate_contract("job-payload", job["payload"])
                validate_contract(f"inputs-{job['type'].replace('.', '-')}", job["inputs"])
                handler = handlers.get(job["type"])
                if handler is None:
                    raise JobFailure("internal", f"worker không có handler cho {job['type']}")
                with job_fonts(job["inputs"].get("fonts"), ctx.download):
                    result = handler(ctx, deps)
                ctx.check()
            except ImageRejected as e:
                raise JobFailure("invalid_input", str(e)) from e
            except ProviderError as e:
                raise classify_provider_error(e) from e
            except ContractError as e:
                raise JobFailure("internal", f"hợp đồng: {e}") from e
        client.complete(job, result, ctx.take_usage())
        return "succeeded"
    except (JobAborted, LeaseLost) as e:
        log.info("bỏ job %s: %s", job["id"], e)
        return "aborted"
    except JobFailure as f:
        ctx.add_usage(f.usage)
        return _report_failure(client, job, ctx, f)
    except Exception as e:  # lỗi không lường trước → internal (tính attempt)
        log.exception("job %s lỗi", job["id"])
        return _report_failure(client, job, ctx, JobFailure("internal", f"{type(e).__name__}: {e}"))


def _report_failure(client: WorkerApi, job: dict[str, Any], ctx: JobContext, f: JobFailure) -> str:
    log.warning("job %s %s fail: %s", job["type"], job["id"], f)
    try:
        client.fail(job, f.error_class, f.message, f.retry_after_s, ctx.take_usage(), f.partial)
    except LeaseLost:
        return "aborted"
    return "failed"
