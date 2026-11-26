# Manga Web Translate

**English** · [Tiếng Việt](./README.vi.md)

A web app for translating manga, manhwa and manhua. Drop in the images or a ZIP of a chapter and it slices the pages,
cleans the original text, runs OCR, translates with an LLM and typesets the result. You then fix things by hand in the
editor and export a ZIP or CBZ.

## Run it on your own machine (Docker)

```bash
mkdir mtl && cd mtl
curl -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
docker compose up -d
```

Windows (PowerShell, not officially tested yet): type `curl.exe` exactly as shown and run one line at a time.

```powershell
mkdir mtl; cd mtl
curl.exe -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
docker compose up -d
```

On first start the worker downloads its AI models (~1–2 GB). Open <http://localhost:8080>, go to **Settings →
Providers** and add an AI key (Anthropic is the default). No `.env` file and no account are needed. Text detection,
OCR and text cleaning run locally on your machine; only the translation step calls an AI API.

The interface is available in English and Vietnamese. It follows your browser language; to switch, open **Settings**
and pick a language under **Interface language** in the left column. New series default to translating into the
interface language, and AI notes are written in it too.

Updating: from 0.3.0 on, click **Update now** in the account menu (the avatar at the top right), or do it by hand
(download `docker-compose.yml` again, then `docker compose pull && docker compose up -d`). See
[docs/self-host.md](./docs/self-host.md#cập-nhật).

> [!WARNING]
> **There is no login.** Use it on your own machine only; do not expose the port to your LAN or the Internet.

Requirements: Docker Compose ≥ 2.17, at least 10 GB of RAM for Docker (12 GB recommended) with the default 2 workers
(`MTL_WORKERS=1` needs ≥ 6 GB), and an amd64 or arm64 machine (Linux / macOS). Backup, restore and troubleshooting:
[docs/self-host.md](./docs/self-host.md).

## Features

- **One-click chapter translation**: detector-based page slicing, text cleaning (Big LaMa / LaMa manga), local OCR
  (MangaOCR, PaddleOCR) or LLM OCR, translation in page batches that keeps context and character names, and automatic
  typesetting in the original text colour. You can edit the first pages while later batches are still running.
- **Folder drop, cover grid**: drop files or use **choose a folder**; each folder of images becomes one chapter (the
  chapter name comes from the folder / ZIP name and can be edited in the chapter popover). Home and the series page are
  cover-card grids (switchable to a plain list, sortable by name / date / chapter number in either direction; the
  browser remembers your choice). The series cover is taken from the first image, or you can upload your own in the
  series settings.
- **Editor**: edit text boxes, undo / redo, versioned autosave, paint a mask to clean text again, re-run OCR on a
  selected area, original / split view, and a script table for the whole chapter.
- **AI proofreading**: per-block suggestions you accept or reject one by one, with a cost estimate up front.
- **Series**: source language `ko | ja | zh | en` → target `vi | en | id | es | pt | fr`, honorifics, forms of address,
  writing style and default fonts; a glossary per series (CSV) and find & replace.
- **Junk filtering**: hide pages, auto-skip credit images the series has learned, trim credit bands stuck to the image
  edges (by hand or automatically from learned bands), and a list of watermark text to ignore.
- **Fonts**: upload your own TTF / OTF, used both in the editor and in exports.
- **Export**: ZIP for web publishing or CBZ, 3 quality levels; chapters edited after their last export show
  "Re-export".

## Two ways to run it

| | Self-hosted (Docker) | Production (VPS) |
|---|---|---|
| Users | 1, no login | Multiple accounts, admin, cost limits |
| File storage | Disk (`./data/files`) | VPS disk (`FILES_DIR`) |
| AI worker | CPU container | Local Mac or Modal GPU |
| Guide | [self-host.md](./docs/self-host.md) | [deployment-guide.md](./docs/deployment-guide.md) |

## Architecture

| Directory | Role |
|---|---|
| `apps/api` | Hono (Node 24), better-auth, user API `/api/*`, admin `/api/admin/*`, worker `/worker/v1/*` |
| `apps/web` | Vite + React SPA, TanStack Router / Query, zustand, react-konva; UI strings in `src/i18n/messages/` |
| `packages/db` | Drizzle schema + migrations (with hand-written down migrations) |
| `packages/shared` | Shared zod contracts for web ↔ API ↔ worker |
| `worker` | Python: `mtl_pipeline` (detect, inpaint, OCR, translate, typeset, export), `mtl_worker` (claim / heartbeat) |
| `infra` | Docker for dev + self-host, systemd, Caddy, backups |

## Development

You need Node 24, pnpm 12 and Docker; the worker also needs Python + `uv`.

```bash
pnpm i && cp .env.example .env
pnpm dev:all     # infra + migrate + API :8787 + web http://localhost:5180 + jobs + worker
```

Checks before committing:

```bash
pnpm typecheck && pnpm lint && pnpm test     # needs pnpm infra:up
cd worker && uv run pytest
```

Conventions (schema, down migrations, per-user data isolation in tests):
[development-setup.md](./docs/development-setup.md). Adding UI strings or a new interface language:
[design-guidelines.md](./docs/design-guidelines.md#i18n-chữ-giao-diện-theo-ngôn-ngữ).

## Documentation

The documents below are written in Vietnamese.

| Document | Contents |
|---|---|
| [self-host.md](./docs/self-host.md) | Self-hosting with Docker |
| [deployment-guide.md](./docs/deployment-guide.md) | Production: VPS, Modal, backups, kill switch |
| [development-setup.md](./docs/development-setup.md) | Dev setup, monorepo, conventions, tests |
| [job-queue-worker.md](./docs/job-queue-worker.md) | Job queue, worker protocol, translation batch chain |
| [editor.md](./docs/editor.md) | Chapter screen + editor |
| [export-and-batch-edit.md](./docs/export-and-batch-edit.md) | Export, find & replace, glossary |
| [typeset-layout-contract.md](./docs/typeset-layout-contract.md) | Konva ↔ render.py text layout contract |
| [design-guidelines.md](./docs/design-guidelines.md) | UI principles and i18n |
| [project-roadmap.md](./docs/project-roadmap.md) | Remaining work, known limitations |
