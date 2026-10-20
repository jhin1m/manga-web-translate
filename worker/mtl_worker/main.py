"""CLI worker: `uv run mtl-worker --api https://… [--no-llm] [--once]`. Token đọc từ MTL_TOKEN_FILE hoặc Keychain.

Vòng lặp: claim → chạy job (model nạp 1 lần) → complete/fail → claim tiếp; không có job thì chờ tăng dần tới 30s.
SIGTERM/SIGINT lần 1: ngừng claim, chờ job đang chạy tối đa MTL_SHUTDOWN_GRACE_S (mặc định 90s) rồi fail(internal);
lần 2: thoát ngay (lease tự hết hạn, reaper đưa job về hàng đợi)."""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import sys
import threading
import time
from functools import cached_property
from typing import Any

from . import PIPELINE_VERSION
from .client import AuthError, PipelineTooOld, WorkerClient
from .handlers import HANDLERS, LLM_TYPES
from .runner import run_job
from .token import TokenError, load_token

log = logging.getLogger("mtl_worker")

IDLE_MIN_S, IDLE_MAX_S = 2.0, 30.0


class RuntimeDeps:
    """Pipeline (ONNX) và provider LLM nạp lười, 1 lần cho cả vòng đời process."""

    def __init__(self, provider_name: str | None, threads: int):
        self.provider_name = provider_name
        self.threads = threads

    @cached_property
    def pipeline(self) -> Any:
        from mtl_pipeline.pipeline import Pipeline

        return Pipeline(threads=self.threads)  # kiểm raqm + sha256 models.lock.json

    @cached_property
    def provider(self) -> Any:
        if not self.provider_name:
            raise RuntimeError("worker chạy --no-llm nhưng nhận job cần LLM")
        from mtl_pipeline.providers import make_provider

        return make_provider(self.provider_name)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="mtl-worker")
    ap.add_argument("--api", default=os.environ.get("MTL_API_URL"), help="URL API (hoặc MTL_API_URL)")
    ap.add_argument("--worker-id", default=os.environ.get("MTL_WORKER_ID", socket.gethostname()[:64]))
    ap.add_argument(
        "--provider", default=os.environ.get("MTL_PROVIDER", "gemini"), choices=["gemini", "anthropic"]
    )
    ap.add_argument("--no-llm", action="store_true", help="chỉ nhận job không cần LLM (ingest, reinpaint)")
    ap.add_argument("--capabilities", help="giới hạn loại job, phân tách bằng dấu phẩy")
    ap.add_argument("--threads", type=int, default=0, help="số luồng onnxruntime (0 = mặc định)")
    ap.add_argument("--once", action="store_true", help="xử lý tối đa 1 job rồi thoát")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def capabilities(args: argparse.Namespace) -> list[str]:
    caps = list(HANDLERS)
    if args.capabilities:
        wanted = [c.strip() for c in args.capabilities.split(",") if c.strip()]
        unknown = [c for c in wanted if c not in HANDLERS]
        if unknown:
            raise SystemExit(f"capability không có handler: {', '.join(unknown)}")
        caps = wanted
    if args.no_llm:
        caps = [c for c in caps if c not in LLM_TYPES]
    if not caps:
        raise SystemExit("không còn capability nào để nhận job")
    return caps


def main(argv: list[str] | None = None) -> int:
    # Không bao giờ tải model ngầm từ HF khi chạy; weights đi theo models.lock.json (red team #15).
    os.environ["HF_HUB_OFFLINE"] = "1"
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if not args.api:
        print("thiếu --api hoặc MTL_API_URL", file=sys.stderr)
        return 2
    try:
        token = load_token()
    except (TokenError, OSError) as e:
        print(f"token: {e}", file=sys.stderr)
        return 2

    caps = capabilities(args)
    deps = RuntimeDeps(None if args.no_llm else args.provider, args.threads)
    if any(c in caps for c in ("chapter.ingest", "page.prepare", "page.reinpaint", "chapter.translate")):
        deps.pipeline  # noqa: B018 — nạp + kiểm model ngay lúc khởi động, lỗi thì dừng sớm
    if not args.no_llm and any(c in LLM_TYPES for c in caps):
        deps.provider  # noqa: B018

    stopping = threading.Event()
    grace_s = float(os.environ.get("MTL_SHUTDOWN_GRACE_S", "90"))
    stop_at: list[float] = []

    def on_signal(signum: int, _frame: object) -> None:
        if stopping.is_set():
            log.warning("tín hiệu lần 2 → thoát ngay")
            os._exit(130)
        log.info("nhận tín hiệu %s: ngừng claim, chờ job hiện tại tối đa %.0fs", signum, grace_s)
        stop_at.append(time.monotonic() + grace_s)
        stopping.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    def past_deadline() -> bool:
        return bool(stop_at) and time.monotonic() > stop_at[0]

    client = WorkerClient(args.api, token, args.worker_id)
    log.info("mtl-worker %s id=%s caps=%s", PIPELINE_VERSION, args.worker_id, ",".join(caps))
    idle = IDLE_MIN_S
    try:
        while not stopping.is_set():
            try:
                jobs = client.claim(caps, 1)
            except PipelineTooOld as e:
                log.error("API từ chối pipeline_version %s: %s — cập nhật worker", PIPELINE_VERSION, e)
                return 3
            except AuthError as e:
                log.error("%s", e)
                return 2
            except Exception as e:  # API tạm không tới được → chờ rồi thử lại
                log.warning("claim lỗi: %s", e)
                stopping.wait(idle)
                idle = min(IDLE_MAX_S, idle * 2)
                continue
            if not jobs:
                if args.once:
                    return 0
                stopping.wait(idle)
                idle = min(IDLE_MAX_S, idle * 1.5)
                continue
            idle = IDLE_MIN_S
            for job in jobs:
                t0 = time.monotonic()
                outcome = run_job(client, job, HANDLERS, deps, past_deadline)
                log.info("job %s %s → %s (%.1fs)", job["type"], job["id"], outcome, time.monotonic() - t0)
            if args.once:
                return 0
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
