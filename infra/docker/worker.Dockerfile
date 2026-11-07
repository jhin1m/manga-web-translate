# syntax=docker/dockerfile:1.7
# Image self-host cho worker Python (detect/OCR/inpaint local + gọi LLM). Context = gốc repo:
#   docker build -f infra/docker/worker.Dockerfile -t ghcr.io/jhin1m/mtl-worker:smoke .
# Không chứa model: entrypoint tải theo worker/models.lock.json vào /data/models (kiểm sha256) lúc khởi động.
# Bố cục giữ như repo (/app/worker + /app/packages/shared/json-schema) để đường dẫn mặc định trong code dùng được.

# uv chỉ dùng lúc build (bind mount), không nằm trong image. Ghim bản = máy dev.
FROM ghcr.io/astral-sh/uv:0.13.7 AS uv

FROM python:3.12-slim
# raqm/fribidi/harfbuzz: Pillow layout phức tạp khi typeset (giống image Modal).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libraqm0 libfribidi0 libharfbuzz0b \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -u 1000 -m mtl \
  && command -v setpriv
ENV UV_COMPILE_BYTECODE=1 \
  UV_LINK_MODE=copy \
  UV_PYTHON_DOWNLOADS=never \
  UV_PYTHON=/usr/local/bin/python3.12
WORKDIR /app/worker
COPY worker/pyproject.toml worker/uv.lock ./
RUN --mount=type=cache,id=mtl-uv-cache,target=/root/.cache/uv \
  --mount=from=uv,source=/uv,target=/usr/local/bin/uv \
  uv sync --frozen --no-dev --no-install-project
COPY worker/ ./
COPY packages/shared/json-schema /app/packages/shared/json-schema
RUN --mount=type=cache,id=mtl-uv-cache,target=/root/.cache/uv \
  --mount=from=uv,source=/uv,target=/usr/local/bin/uv \
  uv sync --frozen --no-dev
ENV PATH=/app/worker/.venv/bin:$PATH \
  MTL_MODELS_DIR=/data/models \
  MTL_FONT_CACHE_DIR=/tmp/mtl-fonts \
  PYTHONUNBUFFERED=1
RUN python -c "import cv2, onnxruntime, PIL.features as f, mtl_worker, mtl_pipeline; assert f.check('raqm'), 'Pillow thiếu raqm'"
COPY --chmod=755 infra/docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/worker-entrypoint.sh"]
