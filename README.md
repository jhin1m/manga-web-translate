# Manga Web Translate

Web app dịch manga / manhwa / manhua. Thả ảnh hoặc ZIP một chương → tự cắt trang, xoá chữ + OCR, dịch bằng LLM, tự chèn
chữ → sửa tay trong editor → xuất ZIP / CBZ.

## Chạy trên máy mình (Docker)

```bash
mkdir mtl && cd mtl
curl -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
docker compose up -d
```

Lần đầu worker tải model AI (~1–2 GB). Mở <http://localhost:8080> → **Cài đặt → Nhà cung cấp** → nhập key AI (mặc định
Anthropic). Không cần `.env`, không cần tài khoản. Phát hiện chữ, OCR, xoá chữ chạy local trên máy; chỉ bước dịch gọi
API AI.

Cập nhật: từ 0.3.0 bấm **Cập nhật ngay** trong menu tài khoản (avatar góc phải trên), hoặc làm tay (tải lại
`docker-compose.yml` rồi `docker compose pull && docker compose up -d`) — xem [docs/self-host.md](./docs/self-host.md#cập-nhật).

> [!WARNING]
> **Không có đăng nhập.** Chỉ dùng trên máy mình, đừng mở cổng ra LAN / Internet.

Cần Docker Compose ≥ 2.17, RAM cho Docker ≥ 10 GB, nên 12 GB (2 worker mặc định; `MTL_WORKERS=1` cần ≥ 6 GB), máy amd64 hoặc arm64 (Linux / macOS). Backup, khôi phục, xử lý sự cố:
[docs/self-host.md](./docs/self-host.md).

## Tính năng

- **Dịch chương một nút**: cắt trang theo detector, xoá chữ (Big LaMa / LaMa manga), OCR local (MangaOCR, PaddleOCR)
  hoặc LLM, dịch theo lô trang giữ ngữ cảnh + tên nhân vật, tự chèn chữ theo màu gốc. Trang đầu sửa được khi các lô sau
  còn chạy.
- **Editor**: sửa box chữ, undo / redo, autosave có version, vẽ mask xoá chữ lại, OCR lại vùng chọn, xem gốc / chia đôi,
  bảng văn bản cả chương.
- **AI hiệu đính**: gợi ý sửa theo khối, nhận / bỏ từng cái, báo trước chi phí.
- **Series**: ngôn ngữ nguồn `ko | ja | zh | en` → đích `vi | en | id | es | pt | fr`, kính ngữ, xưng hô, giọng văn,
  font mặc định; glossary chung + riêng series (CSV), tìm & thay.
- **Lọc rác**: ẩn trang, tự bỏ ảnh credit đã học theo series, cắt dải credit dính ở mép ảnh (cắt tay hoặc tự cắt theo dải đã học), danh sách chữ watermark bỏ qua.
- **Font**: upload TTF / OTF riêng, dùng cả trong editor và bản xuất.
- **Xuất**: ZIP để đăng web hoặc CBZ, 3 mức chất lượng; chương sửa sau lần xuất cuối hiện "Xuất lại".

## Hai cách chạy

| | Tự host (Docker) | Production (VPS) |
|---|---|---|
| Người dùng | 1, không đăng nhập | Nhiều tài khoản, admin, hạn mức chi phí |
| Lưu file | Đĩa (`./data`) | S3 / MinIO, presigned URL |
| Worker AI | Container CPU | Mac local hoặc Modal GPU |
| Hướng dẫn | [self-host.md](./docs/self-host.md) | [deployment-guide.md](./docs/deployment-guide.md) |

## Kiến trúc

| Thư mục | Vai trò |
|---|---|
| `apps/api` | Hono (Node 24), better-auth, API người dùng `/api/*`, admin `/api/admin/*`, worker `/worker/v1/*` |
| `apps/web` | Vite + React SPA, TanStack Router / Query, zustand, react-konva |
| `packages/db` | Drizzle schema + migration (có down viết tay) |
| `packages/shared` | Hợp đồng zod dùng chung web ↔ API ↔ worker |
| `worker` | Python: `mtl_pipeline` (detect, inpaint, OCR, dịch, typeset, export), `mtl_worker` (claim / heartbeat) |
| `infra` | Docker dev + self-host, systemd, Caddy, backup |

## Phát triển

Cần Node 24, pnpm 12, Docker; worker cần Python + `uv`.

```bash
pnpm i && cp .env.example .env
pnpm dev:all     # infra + migrate + API :8787 + web http://localhost:5180 + jobs + worker
```

Kiểm tra trước khi commit:

```bash
pnpm typecheck && pnpm lint && pnpm test     # cần pnpm infra:up
cd worker && uv run pytest
```

Quy ước (schema, migration down, test cô lập dữ liệu theo user): [development-setup.md](./docs/development-setup.md).

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [self-host.md](./docs/self-host.md) | Tự host bằng Docker |
| [deployment-guide.md](./docs/deployment-guide.md) | Production: VPS, Modal, backup, kill-switch |
| [development-setup.md](./docs/development-setup.md) | Cài đặt dev, monorepo, quy ước, test |
| [job-queue-worker.md](./docs/job-queue-worker.md) | Hàng đợi job, giao thức worker, chuỗi lô dịch |
| [editor.md](./docs/editor.md) | Màn chương + editor |
| [export-and-batch-edit.md](./docs/export-and-batch-edit.md) | Xuất, tìm & thay, glossary |
| [typeset-layout-contract.md](./docs/typeset-layout-contract.md) | Hợp đồng layout chữ Konva ↔ render.py |
| [design-guidelines.md](./docs/design-guidelines.md) | Nguyên tắc UI |
| [project-roadmap.md](./docs/project-roadmap.md) | Việc còn lại, giới hạn đã biết |
