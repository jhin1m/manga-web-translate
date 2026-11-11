# syntax=docker/dockerfile:1.7
# Image self-host cho `app` (API + SPA) và `jobs` (runner nền). Context = gốc repo:
#   docker build -f infra/docker/app.Dockerfile -t ghcr.io/jhin1m/mtl:smoke .
# Lọc file bằng infra/docker/app.Dockerfile.dockerignore (BuildKit đọc ignore cạnh Dockerfile).

FROM node:24-bookworm-slim AS base
# Cài pnpm qua npm (không dựa corepack — Node mới bỏ corepack). --force: ghi đè shim corepack có sẵn.
RUN npm i -g --force pnpm@12.14.0 && npm cache clean --force
ENV CI=1
WORKDIR /app
# Toolchain cho re2 khi không có bản prebuilt (nhất là arm64).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Chỉ manifest → layer install chạy lại khi lockfile/package.json đổi, không phải mỗi lần sửa source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

# Build SPA: cần dev deps của web (vite…).
FROM base AS build
RUN --mount=type=cache,id=mtl-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@mtl/web..."
COPY . .
RUN pnpm --filter @mtl/web build && test -f apps/web/dist/index.html

# Runtime chỉ cần dependencies (không dev) của cây API — gồm tsx (API chạy bằng tsx như systemd VPS),
# mọi bản ghim theo lockfile. Không có vite/vitest/biome/typescript.
FROM base AS prod-deps
RUN --mount=type=cache,id=mtl-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@mtl/api..."

# Runtime không cần pnpm → đi thẳng từ image node.
FROM node:24-bookworm-slim AS runtime
# pg_dump phải cùng major với server (postgres:17) → client 17 từ repo PGDG (bookworm chỉ có 15).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/* \
  && pg_dump --version \
  && command -v setpriv
WORKDIR /app
# node_modules (pnpm: gốc + symlink từng package) → source (dockerignore đã loại node_modules/dist) → SPA build.
COPY --from=prod-deps /app /app
COPY . .
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY --chmod=755 infra/docker/app-entrypoint.sh /usr/local/bin/app-entrypoint.sh
# Standalone compose binary for the updater and its detached runner (no full docker CLI: the Engine API is called
# over the socket). Pinned by index digest (multi-arch) because tags can move. Pinned: docker 29.9.3-cli, which ships
# Compose v5.7.0. To upgrade: `docker buildx imagetools inspect docker:<ver>-cli`, copy the top-level Digest, and
# check the plugin path with `docker run --rm --entrypoint sh docker:<ver>-cli -c 'ls /usr/local/libexec/docker/cli-plugins'`.
COPY --from=docker:29.9.3-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
ENV NODE_ENV=production \
  MTL_LOCAL_MODE=1 \
  API_PORT=8080 \
  MTL_DATA_DIR=/data \
  SPA_DIR=/app/apps/web/dist
WORKDIR /app/apps/api
RUN test -x node_modules/.bin/tsx && test -f /app/worker/fonts/manifest.json \
  && docker-compose version
EXPOSE 8080
# Last in the stage so a version bump does not invalidate the layers above. `dev` when built outside a release.
ARG MTL_VERSION=dev
ENV MTL_VERSION=$MTL_VERSION
ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]
CMD ["app"]
