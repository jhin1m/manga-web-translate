"""Phase 7 ở worker: mode drain (Modal) + sessions/end, dừng khi server báo paused_budget, xác thực HMAC /drain,
guardrail token ra mỗi call, token từ Modal secret, chọn execution provider onnxruntime."""

from __future__ import annotations

import json
import threading
from types import SimpleNamespace
from typing import Any

import httpx
import numpy as np
import pytest

from mtl_pipeline.models import ort_providers
from mtl_pipeline.ocr import ocr_page
from mtl_pipeline.providers.anthropic import AnthropicProvider
from mtl_pipeline.providers.base import OutputTokensExceeded, guard_output_tokens
from mtl_pipeline.schema import BBox, OcrCrop, OcrRequest, Region, TokenUsage
from mtl_worker import dispatch_auth
from mtl_worker.client import WorkerClient
from mtl_worker.main import work_loop
from mtl_worker.runner import JobContext, run_job
from mtl_worker.token import load_token

from .test_worker_runner import Deps, FakeClient, prepare_job

SECRET = "k" * 32
DISPATCH = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6d"

# ---------- HMAC /drain ----------


def test_signature_matches_api_vector():
    # Cùng vector với apps/api/test/dispatcher.test.ts (signDrainBody) → hai phía ký giống nhau.
    assert dispatch_auth.sign(b'{"dispatch_id":"d","ts":1}', SECRET) == (
        "sha256=4dd07b0b40061fb0bc562c83812fc4484d4e9e9f1b9ce66f2c7d1c4ed4520a20"
    )


def test_verify_accepts_fresh_signed_body_and_rejects_tampering():
    body = json.dumps({"dispatch_id": DISPATCH, "ts": 1000}).encode()
    sig = dispatch_auth.sign(body, SECRET)
    assert dispatch_auth.verify(body, sig, SECRET, now=1100) == DISPATCH
    with pytest.raises(dispatch_auth.DrainAuthError):
        dispatch_auth.verify(body, sig, SECRET, now=1000 + dispatch_auth.MAX_SKEW_S + 1)  # phát lại cũ
    with pytest.raises(dispatch_auth.DrainAuthError):
        dispatch_auth.verify(body.replace(b"1000", b"1001"), sig, SECRET, now=1000)  # body bị sửa
    with pytest.raises(dispatch_auth.DrainAuthError):
        dispatch_auth.verify(body, None, SECRET, now=1000)
    with pytest.raises(dispatch_auth.DrainAuthError):
        dispatch_auth.verify(body, dispatch_auth.sign(body, "short"), "short", now=1000)
    bad = json.dumps({"dispatch_id": "not-a-uuid", "ts": 1000}).encode()
    with pytest.raises(dispatch_auth.DrainAuthError):
        dispatch_auth.verify(bad, dispatch_auth.sign(bad, SECRET), SECRET, now=1000)


# ---------- paused_budget ----------


def test_paused_budget_stop_aborts_without_complete_or_fail():
    c = FakeClient(stop="paused_budget")
    ctx = JobContext(c, prepare_job())
    ctx.heartbeat_once()
    assert ctx.cancelled.is_set() and ctx.stop_reason == "paused_budget"

    # Heartbeat đầu tiên đã báo dừng → handler kiểm ctx.check() ở mốc kế tiếp và bỏ job.
    def handler(ctx: JobContext, deps: Any) -> dict[str, Any]:
        ctx.heartbeat_once()
        ctx.report("detect", 0.1)
        raise AssertionError("không được chạy tới đây")

    assert run_job(c, prepare_job(), {"page.prepare": handler}, Deps(), heartbeat_s=60) == "aborted"
    assert "complete" not in c.names() and "fail" not in c.names()


# ---------- drain loop ----------


class LoopClient:
    def __init__(self, batches: list[list[dict[str, Any]]]):
        self.batches = batches
        self.claims = 0

    def claim(self, caps: list[str], max_jobs: int = 1) -> list[dict[str, Any]]:
        self.claims += 1
        return self.batches.pop(0) if self.batches else []


def _loop(client: Any, handlers: dict[str, Any], **kw: Any) -> tuple[int, float]:
    busy = [0.0]
    code = work_loop(
        client,
        ["page.prepare"],
        handlers,
        Deps(),
        stopping=threading.Event(),
        past_deadline=lambda: False,
        busy=busy,
        drain_poll_s=0.01,
        **kw,
    )
    return code, busy[0]


def test_drain_exits_after_idle_window_and_counts_busy_time(monkeypatch):
    ran: list[str] = []
    monkeypatch.setattr(
        "mtl_worker.main.run_job", lambda client, job, handlers, deps, deadline: ran.append(job["id"]) or "ok"
    )
    client = LoopClient([[{"id": "a", "type": "page.prepare"}], [], [{"id": "b", "type": "page.prepare"}]])
    code, busy = _loop(client, {}, mode="drain", once=False, drain_idle_s=0.1)
    assert code == 0 and ran == ["a", "b"]
    assert busy >= 0
    assert client.claims > 3  # còn poll tiếp sau job b tới khi rỗng đủ lâu


def test_drain_with_empty_queue_exits_after_idle_window():
    client = LoopClient([])
    code, busy = _loop(client, {}, mode="drain", once=False, drain_idle_s=0.05)
    assert code == 0 and busy == 0 and client.claims >= 2


def test_loop_mode_once_returns_on_empty_queue():
    client = LoopClient([])
    assert _loop(client, {}, mode="loop", once=True, drain_idle_s=0)[0] == 0
    assert client.claims == 1


# ---------- HTTP: dispatch_id + sessions/end ----------


def test_client_sends_dispatch_id_on_claim_and_sessions_end():
    seen: list[tuple[str, dict[str, Any]]] = []

    def handle(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        seen.append((req.url.path, body))
        if req.url.path.endswith("/claim"):
            return httpx.Response(200, json={"jobs": []})
        return httpx.Response(200, json={"ok": True, "duplicate": False})

    c = WorkerClient("http://api", "tok", "modal-1", dispatch_id=DISPATCH)
    c.http = httpx.Client(base_url="http://api/worker/v1", transport=httpx.MockTransport(handle))
    assert c.claim(["page.prepare"]) == []
    c.sessions_end(95.12345, 70.5)
    assert seen[0] == ("/worker/v1/claim", {**seen[0][1], "dispatch_id": DISPATCH})
    assert seen[1] == (
        "/worker/v1/sessions/end",
        {"dispatch_id": DISPATCH, "lifetime_s": 95.123, "busy_s": 70.5},
    )
    c.close()


def test_sessions_end_requires_dispatch_id():
    c = WorkerClient("http://api", "tok", "mac-1")
    with pytest.raises(RuntimeError):
        c.sessions_end(1, 1)
    c.close()


# ---------- guardrail token ----------


def _usage(out: int) -> TokenUsage:
    return TokenUsage(provider="anthropic", model="claude-haiku-5-5", input_tokens=100, output_tokens=out)


def test_guard_output_tokens_limit():
    guard_output_tokens(_usage(2000))
    with pytest.raises(OutputTokensExceeded) as ei:
        guard_output_tokens(_usage(2001))
    assert ei.value.error_class == "schema" and not ei.value.retry_in_job
    assert ei.value.usage[0].output_tokens == 2001  # token đã trả tiền vẫn vào ledger


def test_provider_over_guard_raises_and_ocr_does_not_retry():
    class Fake:
        def __init__(self) -> None:
            self.calls = 0
            self.messages = self

        def create(self, **kw: Any) -> Any:
            self.calls += 1
            return SimpleNamespace(
                content=[SimpleNamespace(type="text", text='{"items": []}')],
                usage=SimpleNamespace(input_tokens=500, output_tokens=3000),
                stop_reason="end_turn",
            )

    fake = Fake()
    provider = AnthropicProvider("claude-haiku-5-5", client=fake)
    with pytest.raises(OutputTokensExceeded):
        provider.ocr_page(OcrRequest(page_ord=0, crops=[OcrCrop(id="r1", png=b"\x89PNG")]))

    img = np.full((64, 64, 3), 255, np.uint8)
    img[10:30:2, 8:56] = 0
    regions = [Region(id="t0", kind="text_free", bbox=BBox(x=4, y=6, w=56, h=30), score=0.9)]
    fake.calls = 0
    with pytest.raises(OutputTokensExceeded) as ei:
        ocr_page(provider, img, regions, 0)
    assert fake.calls == 1
    assert sum(u.output_tokens for u in ei.value.usage) == 3000


# ---------- token + onnxruntime providers ----------


def test_token_from_modal_secret_env(monkeypatch):
    monkeypatch.setenv("MTL_TOKEN", "  platform-token  ")
    monkeypatch.setenv("MTL_TOKEN_FILE", "/nonexistent")
    assert load_token() == "platform-token"


def test_ort_providers_default_cpu_and_ignores_unavailable(monkeypatch):
    monkeypatch.delenv("MTL_ORT_PROVIDERS", raising=False)
    assert ort_providers() == ["CPUExecutionProvider"]
    monkeypatch.setenv("MTL_ORT_PROVIDERS", "NoSuchExecutionProvider,CPUExecutionProvider")
    assert ort_providers() == ["CPUExecutionProvider"]
    monkeypatch.setenv("MTL_ORT_STRICT", "1")
    with pytest.raises(RuntimeError):
        ort_providers()
