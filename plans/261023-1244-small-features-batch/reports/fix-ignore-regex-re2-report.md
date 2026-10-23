# Báo cáo: chữ bỏ qua dạng regex chạy bằng RE2 (chống ReDoS)

## Kết quả
- `re2@1.27.0` cài được ở `apps/api`; binary dựng sẵn tải về (darwin-arm64, ABI 137 = Node 24). Release `uhop/node-re2` 1.27.0 có
  `linux-x64-137`, `linux-arm64-137`, `darwin-arm64-137` (HTTP 200). `engines`: Node ^24.15. Không có Dockerfile; deploy là
  `pnpm install --frozen-lockfile` trên VPS (`infra/deploy.sh`).
- pnpm chặn script cài đặt → thêm `re2: true` vào `allowBuilds` (`pnpm-workspace.yaml`). Lockfile đã cập nhật.
- Mẫu của reviewer `/\w*\w*\w*\w*\w*\w*\w*\w*!/` trên chuỗi ~100 ký tự: ~1ms bằng RE2 (test khẳng định < 100ms).
- RE2 hỗ trợ cờ `iu`, khớp Unicode + không phân biệt hoa/thường (Nhóm/NHÓM, Ǆ/ǆ, `\p{L}`) như RegExp gốc.

## Thiết kế
- `packages/shared/src/ignore-text.ts` (vẫn browser-safe): thêm `IgnoreRegex`, `MakeIgnoreRegex`, `IgnoreOptions`;
  `parseIgnoreEntry` / `ignoreEntryError` / `isValidIgnoreEntry` / `compileIgnoreList` nhận `{ makeRegex }` (mặc định `RegExp`).
  Chuẩn hoá giữ nguyên, dùng chung.
- Kiểm cú pháp không thuộc RE2 (browser-safe, bỏ qua `\\` và lớp `[...]`): `\1`..`\9`, `\k<`, `(?=`, `(?!`, `(?<=`, `(?<!`.
- `apps/api/src/lib/ignore-text.ts` (mới): `compileIgnoreListRe2`, `ignoreEntryErrorRe2` (dựng thật bằng RE2).
- Dùng RE2 ở: `jobs/claim-inputs.ts`, `routes/series-ignore-apply.ts`, `routes/series.ts` (lưu cài đặt, lỗi theo dòng như cũ).
- Heuristic lượng từ lồng nhau: GIỮ cho phía trình duyệt. Lý do: web vẫn chạy `RegExp` gốc ở form + bảng văn bản, RE2 không bảo vệ
  được ở đó. Thêm chốt rẻ: tối đa 5 lượng từ không giới hạn (`*`, `+`, `{n,}`) / mẫu, chặn dạng `\w*\w*…!` (đa thức bậc cao).
  Hai chốt này CHỈ áp khi dùng `RegExp` mặc định (không truyền `makeRegex`), nên API (RE2) vẫn nhận `(a+)+` và mẫu 8 `\w*`
  (an toàn). Hệ quả: form web chặt hơn API; mục đã lưu vượt ngưỡng thì web bỏ qua khi ẩn dòng ở bảng văn bản (box vẫn bị
  ẩn phía server). Nếu muốn web/API chặt như nhau thì cần quyết định của bạn (xem dưới).

## Kiểm tra apply (chương/trang không có trong preview)
Xác nhận từ code + test mới: apply KHÔNG bao giờ ghi chương không có trang trong `versions` (nhánh `!previewed` chỉ đọc để báo
`locked`/`busy`). Trong chương đã preview, trang có khớp mới mà không có trong `versions` → `applyBatch` ném 409 → cả chương
bỏ qua, báo `changed`, không ghi gì. Không có bug; thêm test `never writes a chapter or page that was not part of the preview…`.

## Test
- shared: lỗi cú pháp RE2, chốt lượng từ (chỉ native), factory tiêm vào. 32 pass.
- api: `test/ignore-text-re2.test.ts` (cả hai factory: khoảng trắng, `/discord\s*\.\s*gg/`, hoa/thường, NFD tiếng Việt; mẫu
  catastrophic < 100ms; backref/lookaround bị từ chối), PATCH series 400 cho `\1` và `(?=`, test apply mới. 245 pass.
- web 191 pass; `pnpm typecheck`, `pnpm lint` sạch; e2e `series-manage` 6/6 pass.

## Docs
`docs/job-queue-worker.md` (dialect RE2, tính năng không hỗ trợ, chốt phía web), `docs/deployment-guide.md` (addon native,
binary dựng sẵn, fallback node-gyp, `allowBuilds`).

## Còn lại / câu hỏi
- Web vẫn dùng RegExp gốc: mục đã lưu qua API vượt chốt web bị bỏ qua ở bảng văn bản. Chấp nhận được hay muốn web cũng cắt
  đúng như API (khi đó bỏ chốt 5 lượng từ phía web)?
- Mục đã lưu từ trước mà RE2 không hỗ trợ (backref/lookaround) → bị bỏ qua lúc so khớp như mục không hợp lệ khác.
- Biome đã tự format lại một vài chỗ trong các file đụng tới (chỉ định dạng).
