---
phase: 1
title: "Driver lưu đĩa + route /files + test 2 driver"
status: pending
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 1: Driver lưu đĩa + route `/files`

## Overview
Thêm driver lưu file trên đĩa (`/data/files/<key>`) song song driver S3 hiện có, chọn bằng `STORAGE_DRIVER`. Link presign
của disk driver là `/files/<key>?…` ký HMAC do chính API phục vụ (GET có Range, PUT cho worker, POST multipart theo
policy như MinIO). API công khai của `apps/api/src/storage.ts` giữ nguyên tên/chữ ký → mọi caller không đổi.

## Context
- Plan: [plan.md](plan.md) — Decisions 1–5, 18.
- Code hiện tại: `apps/api/src/storage.ts` (S3 client tạo ở top-level từ env; hàm `presignPost`, `presignGet`, `presignPut`,
  `objectTags`, `head`, `readPrefix`, `readObject`, `copyObject`, `deleteObject`, `deletePrefix`, `bucketReachable`,
  hằng `MAX_GET_TTL_S`, `EXPORT_GET_TTL_S`, `MAX_POST_TTL_S`, `MAX_PUT_TTL_S`).
- Caller (không sửa): `apps/api/src/jobs/claim-inputs.ts` (presignGet/presignPut cho worker, header `x-amz-tagging`),
  `routes/{uploads,chapters,page-state,fonts,admin-fonts}.ts` (presignPost), `routes/{pages,export,series-skip-images}.ts`,
  `lib/font-upload.ts` (presignGet), `lib/chapter-removal.ts`, `lib/health.ts`.
- Web gửi POST: `apps/web/src/features/upload/upload-queue.ts:71` (`fields` + `file`, chấp nhận 2xx), `features/editor/api.ts:103`,
  `features/fonts/api.ts:44`. Worker tải/đẩy: `worker/mtl_worker/client.py:93,206-228` (`self.files` httpx, PUT 403 = hết hạn).
- Test hiện có: `apps/api/test/storage-presign.test.ts` (MinIO thật), `apps/api/vitest.config.ts` (globalSetup reset Postgres).
- Key format: `packages/shared/src/storage-keys.ts` (`u/{user}/…`).

## Requirements
- Functional
  - `STORAGE_DRIVER=s3|disk`, `FILES_DIR` (mặc định `/data/files`). Driver S3 chỉ khởi tạo khi được chọn (disk mode không có biến `S3_*`).
  - Disk driver hiện thực đủ mọi hàm export của `storage.ts`, cùng trần TTL và cùng `RangeError`.
  - `presignGet(key, ttl, disposition?)` → `/files/<key-encoded>?exp=<unix>&cd=<disposition?>&sig=<hex>`.
  - `presignPut(key, ct, ttl, {tagging?})` → `/files/<key>?m=PUT&exp&ct&tag?&sig`. Server bắt buộc header `content-type` == `ct`
    và `x-amz-tagging` == `tag` khi có (worker đã gửi đúng các header này — `client.py:219`); tag không lưu (lifecycle disk theo đường dẫn).
  - `presignPost(key, ct, max, ttl)` → `{ url: "/files/<key>?m=POST&exp&ct&max&sig", fields: { "Content-Type": ct }, expiresAt }`.
  - Route `apps/api/src/routes/files.ts` mount ở `/files` (ngoài `/api`, không cookie, trước `notFound`):
    - `GET`/`HEAD`: kiểm chữ ký; `Range: bytes=a-b` → 206 + `Content-Range`; không Range → 200 stream (`createReadStream`);
      header `Content-Type` (từ sidecar), `Content-Length`, `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`,
      `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=<exp-now>`, `Content-Disposition` khi có `cd`.
    - `PUT`: kiểm chữ ký + header; stream body vào file tạm rồi rename; 200.
    - `POST`: kiểm chữ ký; `Content-Length` thiếu → 411, > max + 64 KiB → 413; field `Content-Type` ≠ ct → 403; file 0 byte hoặc > max → 400; thành công 204.
    - Sai/thiếu chữ ký, `exp` thiếu/hết hạn → 403 (body JSON ngắn, kèm nosniff). Key không tồn tại → 404.
  - Kiểm key chống path traversal: regex `^[A-Za-z0-9][A-Za-z0-9._\-/]{0,1023}$`, cấm segment rỗng/`.`/`..`, cấm hậu tố `.meta.json`;
    sau `path.resolve(root, key)` phải bắt đầu bằng `root + path.sep`. Lỗi → 400 (route) / `RangeError` (hàm thư viện).
  - Ghi atomic: `<root>/.tmp/<uuid>` → `fs.rename` vào đích (cùng filesystem), `mkdir -p` thư mục cha; sidecar `<file>.meta.json`
    `{ "contentType": "…" }` ghi cùng cách, ghi sidecar TRƯỚC rồi rename file data (đọc thấy data ⇒ đã có meta).
  - `head` → `{ bytes, contentType, etag: "\"<size>-<mtimeMs>\"" }` hoặc `null`. Implementer: `grep -rn "etag" apps/api/src` xác nhận không caller nào cần md5.
  - `copyObject` copy sang tmp rồi rename (kèm sidecar). `deleteObject` không có cũng không lỗi. `deletePrefix(prefix)` (phải kết thúc `/`)
    đếm file data (bỏ sidecar) rồi `fs.rm(dir, {recursive, force})`. `objectTags` → `{}`. `bucketReachable` → `fs.access(root, W_OK)` + `mkdir -p`.
  - Chữ ký: `sig = HMAC-SHA256(k, [method, key, exp, ct ?? "", max ?? "", tag ?? "", cd ?? ""].join("\n"))` hex, so bằng `timingSafeEqual`
    (độ dài khác → false trước). `k = HMAC-SHA256(BETTER_AUTH_SECRET, "mtl-files-v1")`. GET và HEAD dùng chung method `GET` khi ký.
  - Worker: `self.files = httpx.Client(base_url=api.rstrip("/"), timeout=…, follow_redirects=False)` để resolve URL tương đối;
    URL tuyệt đối (S3) giữ nguyên. Bearer token KHÔNG thêm vào client file.
- Non-functional
  - Module disk driver và signer KHÔNG import `env.ts`/`db.ts` (factory nhận `{ root, signingKey, now? }`) → unit test không cần env/DB.
  - Không phụ thuộc mới (dùng `node:fs/promises`, `node:crypto`, Hono có sẵn; `@hono/node-server` đã có).

## Architecture
```
storage.ts (facade, giữ API cũ) ── env.STORAGE_DRIVER ──► storage-drivers/s3-driver.ts   (code S3 hiện tại chuyển vào, lazy)
                                                     └─► storage-drivers/disk-driver.ts (fs + signer)
storage-drivers/file-signing.ts  (signUrl/verify, deriveFilesKey)
storage-drivers/types.ts         (StorageDriver interface = các hàm export hiện tại)
routes/files.ts  createFilesRoutes(driver: DiskDriver) → Hono; app.ts mount khi STORAGE_DRIVER=disk
```
Facade: `const driver = env.STORAGE_DRIVER === "disk" ? createDiskDriver({ root: env.FILES_DIR, signingKey: deriveFilesKey(env.BETTER_AUTH_SECRET) }) : createS3Driver(env)`;
các export cũ = `driver.xxx`. Export thêm `diskDriver(): DiskDriver | null` cho `app.ts` mount route.

## Related Code Files
- Create: `apps/api/src/storage-drivers/types.ts`, `apps/api/src/storage-drivers/s3-driver.ts`, `apps/api/src/storage-drivers/disk-driver.ts`,
  `apps/api/src/storage-drivers/file-signing.ts`, `apps/api/src/routes/files.ts`,
  `apps/api/vitest.unit.config.ts`, `apps/api/test/storage-contract.ts`, `apps/api/test/unit/disk-driver.test.ts`,
  `apps/api/test/unit/files-route.test.ts`, `apps/api/test/unit/file-signing.test.ts`, `apps/api/test/unit/env-storage.test.ts`.
- Modify: `apps/api/src/storage.ts` (thành facade), `apps/api/src/env.ts` (CHỈ khối storage: `STORAGE_DRIVER`, `FILES_DIR`, `S3_*`/`FILES_DOMAIN` optional + superRefine),
  `apps/api/src/app.ts` (CHỈ mount `/files`), `apps/api/src/lib/health.ts` (comment "MinIO" → "storage"; logic không đổi),
  `apps/api/test/storage-presign.test.ts` (giữ case riêng S3 + gọi contract), `apps/api/package.json` (script `"test:unit": "vitest run -c vitest.unit.config.ts"`),
  `worker/mtl_worker/client.py` (base_url client file), `worker/tests/` (1 test: URL tương đối được resolve theo api).
- Delete: none.

## Implementation Steps
1. `types.ts`: `interface StorageDriver` với đúng chữ ký các hàm hiện có trong `storage.ts` (+ type `PresignedPost`, `HeadResult` chuyển sang đây, `storage.ts` re-export).
2. `s3-driver.ts`: chuyển nguyên code S3 hiện tại vào `createS3Driver(cfg)` (giữ comment, giữ `publicSigner` theo `FILES_DOMAIN`). Hằng TTL để ở `storage.ts` hoặc `types.ts` và cả 2 driver dùng chung.
3. `env.ts`: thêm `STORAGE_DRIVER: blank(z.enum(["s3","disk"]).optional())`, `FILES_DIR: z.string().default("/data/files")`; đổi `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/FILES_DOMAIN` thành `blank(...optional())`;
   transform: driver mặc định `"s3"` (phase 2 sẽ đổi mặc định thành `disk` khi local mode); superRefine: driver s3 mà thiếu bất kỳ biến S3/FILES_DOMAIN nào → issue. Giữ `parseEnv` thuần.
   Sửa các chỗ TS báo `string | undefined` (chỉ trong s3-driver, dùng non-null sau khi superRefine đảm bảo — hoặc truyền cfg đã kiểm).
4. `file-signing.ts`: `deriveFilesKey(secret)`, `signFileUrl({method,key,exp,ct,max,tag,cd}, k)`, `verifyFileSig(params, sig, k, nowS)` (exp bắt buộc, `exp <= now` → false, timingSafeEqual).
5. `disk-driver.ts`: `createDiskDriver({ root, signingKey, now = () => Date.now() })` hiện thực mọi hàm + `resolveKey(key)` (kiểm traversal) + `writeAtomic(key, source, contentType)` + `openRead(key, range?)` cho route. Encode key trên URL: `key.split("/").map(encodeURIComponent).join("/")`.
6. `routes/files.ts`: `createFilesRoutes(d)` — `app.on(["GET","HEAD"], "/*", …)`, `put("/*")`, `post("/*")`; key = path sau `/files/` đã decode. POST: kiểm `content-length`, rồi `await c.req.parseBody()` lấy `file` (File) và field `Content-Type`; ghi qua `writeAtomic`. Lỗi trả JSON + nosniff.
7. `app.ts`: sau route worker, `const d = diskDriver(); if (d) app.route("/files", createFilesRoutes(d));` — `secureHeaders()` đã áp toàn cục; route tự đặt CSP sandbox.
8. `storage-contract.ts`: `runStorageContract(name, setup: () => { presign fns, head, readPrefix, fetcher(url, init) })` gồm: upload hợp lệ → head/readPrefix thấy; vượt maxBytes bị từ chối + head null; sai Content-Type → 403 + head null; GET có chữ ký 200 + `content-disposition` đúng + nosniff; GET không chữ ký 403; GET hết hạn 403 (dùng `now` giả với disk, `sleep` với S3); POST hết hạn 403; trần TTL ném RangeError; PUT presign (ct + tagging) ghi được và GET lại đúng byte.
9. `test/unit/disk-driver.test.ts`: `mkdtemp` root; chạy contract với `fetcher = (url, init) => filesApp.request(url, init)` (Hono, không mở cổng); thêm case riêng disk: traversal (`../x`, `a//b`, `/abs`, `%2e%2e`, `x.meta.json`) → 400/RangeError; Range 206 + `Content-Range`; ghi atomic (không còn file trong `.tmp` sau upload); `deletePrefix` đếm đúng & xoá; `copyObject` giữ contentType; PUT sai content-type → 403.
10. `test/unit/file-signing.test.ts`: đổi 1 ký tự sig/key/exp/ct → false; exp quá khứ → false; sig độ dài khác → false không ném.
11. `test/unit/env-storage.test.ts`: `parseEnv` với driver disk không cần S3_*; driver s3 thiếu S3_BUCKET → lỗi; không đặt gì → s3 như cũ (bản VPS không đổi).
12. `vitest.unit.config.ts`: `include: ["test/unit/**/*.test.ts"]`, không globalSetup/setupFiles, `env: { NODE_ENV: "test" }`. File unit KHÔNG import `src/env.ts` gián tiếp (driver/signing/route nhận tham số).
13. `storage-presign.test.ts`: giữ 2 case riêng S3 (ký theo `FILES_DOMAIN`, unsigned GET 403 có nosniff qua proxy); phần chung chuyển sang `runStorageContract("s3", …)` với fetcher = `fetch`.
14. Worker: sửa `client.py` như Requirements; test `worker/tests/` dùng `httpx.MockTransport` xác nhận `download("/files/a?x")` gọi `http://api.test/files/a?x` và URL tuyệt đối giữ nguyên. Chạy `cd worker && uv run pytest -q tests/<file>` + `uv run ruff check`.

## Success Criteria
- [ ] `pnpm --filter @mtl/api test:unit` xanh khi KHÔNG có Postgres/MinIO (kiểm bằng `docker ps` trống).
- [ ] `pnpm infra:up && pnpm --filter @mtl/api test` xanh (S3 contract + toàn bộ test cũ).
- [ ] `pnpm typecheck && pnpm lint` xanh.
- [ ] Không caller nào của `storage.ts` phải sửa (`git diff --stat` chỉ gồm file trong danh sách trên).
- [ ] Worker pytest + ruff xanh.

## Risk Assessment
- **Đổi env S3 thành optional làm VPS khởi động thiếu biến mà không báo** → superRefine bắt buộc khi driver s3; test env-storage phủ.
- **Path traversal qua URL encode** → decode 1 lần rồi kiểm regex + resolve-prefix; test `%2e%2e`, `..%2f`.
- **`parseBody` đọc cả file vào RAM** → precheck `Content-Length` ≤ max+64 KiB; trần upload do route gọi presign quyết.
- **Rename khác filesystem** → `.tmp` nằm trong `root` (cùng mount).
- **Hono `app.request` với URL tương đối** trong test: dùng `http://local` + path.
- Rollback: driver mặc định s3 → revert phase không ảnh hưởng VPS.
