"""Modal GPU worker (red team #9, #14). Cùng giao thức pull như worker Mac, chạy `mtl-worker --mode drain`.

  modal volume create mtl-models
  modal volume put mtl-models models/ /            # weights đã kiểm sha256 theo models.lock.json
  modal secret create mtl-worker MTL_TOKEN=<token nền tảng> MTL_API_URL=https://<app-domain> \
      MODAL_DRAIN_SECRET=<≥32 ký tự, trùng .env của API> GEMINI_API_KEY=<…>
  modal deploy modal_app.py                        # in URL endpoint `drain` → MODAL_DRAIN_URL ở API

Dispatcher POST /drain (HMAC) → endpoint kiểm chữ ký → `drain.spawn(dispatch_id)` trả 202 ngay. Container chạy
vòng claim tới khi hàng đợi rỗng 20s rồi thoát và báo sessions/end. Giới hạn chi phí: max_containers,
scaledown_window 60s, timeout (max lifetime) — khớp MODAL_MAX_CONTAINERS / MODAL_SCALEDOWN_S / MODAL_MAX_LIFETIME_S
ở API (reaper dùng để ước lượng GPU rỗi khi container bị kill).
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

WORKER_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = WORKER_DIR.parent / "packages" / "shared" / "json-schema"
MODELS_MOUNT = "/models"
MAX_CONTAINERS = int(os.environ.get("MODAL_MAX_CONTAINERS", "2"))
SCALEDOWN_S = int(os.environ.get("MODAL_SCALEDOWN_S", "60"))
MAX_LIFETIME_S = int(os.environ.get("MODAL_MAX_LIFETIME_S", "3600"))
GPU = os.environ.get("MODAL_GPU", "L4")  # T4 rẻ hơn nếu đủ nhanh (đo ở runbook)

image = (
    modal.Image.debian_slim(python_version="3.12")
    # libraqm: layout chữ phức tạp (Pillow + raqm), bắt buộc như trên Mac (require_raqm).
    .apt_install("libraqm0", "libfribidi0", "libharfbuzz0b")
    .pip_install_from_pyproject(str(WORKER_DIR / "pyproject.toml"))
    .pip_install("fastapi[standard]>=0.115")
    # onnxruntime CPU từ pyproject được thay bằng bản CUDA; extra [cuda,cudnn] kéo thư viện CUDA 12/cuDNN 9 qua pip
    # (debian_slim không có sẵn). MTL_ORT_STRICT=1 → thiếu CUDA thì worker dừng thay vì âm thầm chạy CPU.
    .run_commands("pip uninstall -y onnxruntime", "pip install 'onnxruntime-gpu[cuda,cudnn]>=1.20,<2'")
    .env(
        {
            "HF_HUB_OFFLINE": "1",
            "MTL_MODELS_DIR": MODELS_MOUNT,
            "MTL_ORT_PROVIDERS": "CUDAExecutionProvider,CPUExecutionProvider",
            "MTL_ORT_STRICT": "1",
            "PYTHONPATH": "/app",
            "MTL_MODE": "drain",
            "MTL_SCHEMA_DIR": "/app/json-schema",
        }
    )
    .add_local_dir(WORKER_DIR / "mtl_pipeline", "/app/mtl_pipeline", copy=True)
    .add_local_dir(WORKER_DIR / "mtl_worker", "/app/mtl_worker", copy=True)
    .add_local_dir(WORKER_DIR / "fonts", "/app/fonts", copy=True)
    .add_local_file(WORKER_DIR / "models.lock.json", "/app/models.lock.json", copy=True)
    # Hợp đồng worker ↔ API (pnpm schema:emit) — ngoài monorepo nên trỏ MTL_SCHEMA_DIR.
    .add_local_dir(SCHEMA_DIR, "/app/json-schema", copy=True)
    .workdir("/app")
)

app = modal.App("mtl-worker", image=image)
models = modal.Volume.from_name("mtl-models")
secret = modal.Secret.from_name("mtl-worker")


@app.function(
    gpu=GPU,
    volumes={MODELS_MOUNT: models},
    secrets=[secret],
    max_containers=MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_S,
    timeout=MAX_LIFETIME_S,
)
def drain(dispatch_id: str) -> int:
    from mtl_worker.main import main

    return main(["--mode", "drain", "--dispatch-id", dispatch_id, "--worker-id", f"modal-{dispatch_id[:8]}"])


@app.function(secrets=[secret], max_containers=1)
@modal.asgi_app(label="mtl-drain")
def drain_web():
    from fastapi import FastAPI, Request, Response

    from mtl_worker.dispatch_auth import DrainAuthError, verify

    web = FastAPI()

    @web.post("/drain")
    async def post_drain(req: Request) -> Response:
        body = await req.body()
        try:
            dispatch_id = verify(body, req.headers.get("x-mtl-signature"), os.environ["MODAL_DRAIN_SECRET"])
        except DrainAuthError:
            return Response(status_code=401)
        drain.spawn(dispatch_id)
        return Response(status_code=202)

    return web
