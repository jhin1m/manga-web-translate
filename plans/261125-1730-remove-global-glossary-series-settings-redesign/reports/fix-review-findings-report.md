# Sửa theo review: bỏ glossary chung + tự lưu Cài đặt series

Thời điểm: 2026-11-25 18:26 (Asia/Saigon). Nguồn: [code-review-report.md](code-review-report.md). Không commit.

## Đã sửa

### 1. Migration 0031 giữ entry chung không chép được (review mục 1, 8)

- Bảng mới `glossary_global_archive` có các cột id (giữ id entry gốc), user_id (FK user, cascade), source_lang,
  target_lang (nullable), source_term, target_term, note, case_sensitive, origin, created_at, updated_at. Bảng được khai
  báo trong `packages/db/src/schema/app.ts` (`glossaryGlobalArchive`). App không đọc bảng này.
- `packages/db/migrations/0031_remove_global_glossary.sql` có thứ tự: tạo bảng + FK → chép vào series cùng cặp (như cũ) →
  chuyển vào bảng lưu trữ các entry chung **không có series nào** cùng user + cùng cặp (gồm cả cặp NULL) → xoá entry
  chung → gỡ index `glossary_user_series_idx` → phần còn lại như cũ. Entry chung có series cùng cặp nhưng series nào cũng
  đã có term đó (chưa từng có hiệu lực) vẫn bị xoá, đúng phạm vi đã chốt.
- Snapshot `meta/0031_snapshot.json` được dựng lại bằng `drizzle-kit generate` (lấy snapshot của bản probe, giữ
  `id`/`prevId` cũ, xoá file probe). Journal không đổi.
  - `drizzle-kit generate` báo "No schema changes".
  - `drizzle-kit check` báo "Everything's fine".
- Index thừa: unique `(user_id, series_id, source_term)` có cùng tiền tố. Đã kiểm trên DB tạm chạy đủ migration
  (`SET enable_seqscan=off` + `EXPLAIN` lọc `user_id` + `series_id`): kết quả là
  `Index Scan using glossary_entries_scope_term_uq`, Index Cond trên cả hai cột. Index này cũng phục vụ FK kép
  `(user_id, series_id) → series` khi xoá series.
- File down `0031_remove_global_glossary.down.sql`, theo thứ tự: thêm lại cột → unique cũ → tạo lại
  `glossary_user_series_idx` → chép entry lưu trữ về `glossary_entries` (series_id NULL, đúng cặp, giữ id) → xoá bảng
  lưu trữ → gỡ dòng drizzle.
- Test `packages/db/test/remove-global-glossary-migration.test.ts`:
  - Seed thêm ba entry: ja→vi của U1 (không có series ja→vi), cặp NULL, và ko→en của U2 (U2 chỉ có ko→vi, còn series
    ko→en thuộc U1).
  - Kiểm: bảng lưu trữ có đúng 3 entry, đủ cột, giữ id gốc; entry đã chép không vào lưu trữ; chỉ còn index pkey + unique.
  - Kiểm down: entry lưu trữ quay lại glossary chung đúng cặp, đúng id; bảng lưu trữ bị xoá; chạy up lại thì lưu trữ lại
    đúng số entry.
- `docs/deployment-guide.md` (ghi chú 0031) có thêm đoạn về bảng lưu trữ, câu SQL để xem, câu SQL chép một cặp vào series
  (có tăng `glossary_rev`), và cách dùng file down. Câu SQL chép đã chạy thử trong transaction rồi ROLLBACK trên DB dev.
  `docs/export-and-batch-edit.md` có thêm một câu về bảng lưu trữ.
- DB dev:
  - Backup trước bằng `pg_dump -Fc` vào `backups-dev/mtl-dev-before-0031-archive-261125-1817.dump`.
  - DB dev đã áp 0031 bản cũ, và drizzle không áp lại migration cùng `when`. Vì vậy đã tạo bảng lưu trữ rỗng, chạy file
    down mới, rồi `pnpm db:migrate`.
  - Kết quả: 32 migration, có `glossary_global_archive`, index chỉ còn pkey + unique. DB dev không có entry glossary nào.

### 2. `infra/deploy.sh` không tự rollback khi đã áp migration mới (review mục 2)

- `new_migrations <before> <rel>` so danh sách file `packages/db/migrations/*.sql` của release đang chạy với release mới,
  rồi in các migration chỉ release mới có, mới nhất trước. Release đang chạy luôn đã migrate đủ nên đây đúng là các
  migration lần deploy này vừa áp. Cách này không cần DB hay psql trên máy deploy.
- Khi smoke hỏng và có migration mới, `refuse_auto_rollback` làm các việc sau:
  - Gửi cảnh báo "KHÔNG tự rollback" và giữ bản mới chạy. Release mới không bị xoá vì chứa file down; `previous` đã trỏ
    về bản cũ.
  - In các bước: đọc ghi chú migration (vài migration như 0024 ghi thứ tự khác), chạy down mới nhất trước, rồi
    `deploy.sh rollback`.
  - In lệnh `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f …down.sql` cho từng migration, hoặc ghi "không có file down".
  - Rồi `die`.
- Không có migration mới thì giữ nguyên hành vi cũ. Deploy đầu tiên hỏng vẫn báo + die như cũ.
- Header script và đoạn deploy/rollback trong `docs/deployment-guide.md` đã cập nhật. Phần help in thêm 2 dòng
  (`sed -n '2,10p'`).
- Kiểm:
  - `bash -n` qua.
  - `shellcheck -e SC1091` sạch. SC1091 là info về `source`, bản HEAD cũng có.
  - Chạy thử hai hàm trên thư mục giả: cùng migration → rỗng; thêm 0031 + 0032 → in `0032_d`, `0031_c` theo đúng thứ tự,
    kèm lệnh psql / "không có file down", rồi exit 1; thiếu thư mục migration ở bản cũ → coi mọi migration là mới (an
    toàn).
  - Không chạy deploy thật.

### 3. Xưng hô tự lưu: lưu hàng đủ, giữ hàng thiếu (review mục 3)

- `settings-draft.ts`:
  - `ruleComplete` mới. `draftValues` chỉ đưa các hàng đủ ô vào so / gửi, nên `isDirty`, `buildPatch` và
    `pronoun_keys_seen` đều chỉ thấy hàng đủ.
  - `fieldInvalid` không còn chặn `pronoun_rules`.
  - `adoptServer` (qua `fromServer`) giữ các hàng thiếu của form ở gần vị trí cũ khi nhận bản server, nên đồng bộ không
    xoá hàng đang điền dở. Server không có gì mới thì vẫn trả đúng `st`.
  - Bỏ `firstMissingRuleField` (chỉ còn cần "có hàng thiếu không").
- `use-settings-autosave.ts`: `commit("pronoun_rules")` luôn lưu các hàng đủ. `rulesChecked` = còn hàng thiếu, để tô đỏ.
  Xoá hàng (`"now"`) lưu ngay kể cả khi còn hàng dở. Đóng modal thì lưu hàng đủ, bỏ hàng dở / hàng trống.
- `pronoun-rules-table.tsx`: thông báo đổi thành "Hàng tô đỏ chưa được lưu: điền đủ người nói, người nghe, xưng/gọi.".
  Ô thiếu của từng hàng vẫn `aria-invalid`.

### 4. Ô chữ dài chỉ lưu khi rời ô (review mục 4)

- Giọng văn, Chữ bỏ qua và **Tên series** dùng `"later"` khi gõ, rồi lưu bằng `leave` (blur) hoặc khi đóng modal.
- Tên series cũng chuyển sang blur vì đơn giản hơn. Khi cả ba ô thôi debounce thì toàn bộ cơ chế timer (`"soon"`,
  `DEBOUNCE_MS`, map `timers`) bị xoá hẳn. Thêm nữa, gõ tên không còn làm tiêu đề trang phía sau đổi theo từng đoạn.
- Lưu xong mà người dùng đã sửa tiếp: nếu con trỏ còn ở ô đó thì chờ rời ô, không lưu giữa lúc gõ. Trước đây điều này dựa
  vào timer.

### 5. Dọn nhỏ (review mục 7, 9)

- Xoá `apps/web/src/features/series/source-lang-select.tsx`. Không còn import nào trong `src`, `e2e`, `docs`.
- Lưu xong: tên / cặp ngôn ngữ (`LIST_FIELDS`) làm mới mọi khoá `["series"]`, gồm danh sách và tên ở Hoạt động. Trường
  khác chỉ làm mới `["series", id]` (exact). Bìa lưu ở API riêng, không qua hook này.

### Docs / e2e đi kèm

- `docs/design-guidelines.md`: đoạn Cài đặt dịch tả hành vi lưu mới.
- `apps/web/e2e/series-manage.spec.ts`: test xưng hô viết lại, kiểm các ý sau:
  - Hàng dở → đỏ, không PATCH.
  - Điền đủ → lưu.
  - Có hàng dở mà xoá hàng đủ → lưu `[]` ngay, hàng dở còn trên form và vẫn đỏ.
  - Giọng văn không lưu sau 1,2 s gõ, rời ô mới lưu.
  - Đóng modal → hàng dở bị bỏ, không PATCH thêm.
  - Comment của test "Chữ bỏ qua" cũng đã sửa.

## Lệnh kiểm (tuần tự, `nice`, 1 worker) và kết quả thật

| Lệnh | Kết quả |
|---|---|
| `pnpm -C packages/db exec drizzle-kit generate --name should_be_empty` | No schema changes |
| `pnpm -C packages/db exec drizzle-kit check` | Everything's fine |
| `pnpm -C packages/db exec vitest run --maxWorkers=1` | 5 file, 10 test qua |
| `pnpm -C apps/api exec vitest run --maxWorkers=1 test/glossary.test.ts test/find-replace.test.ts test/series-memory.test.ts test/tenant-isolation.test.ts` | 66/66 qua |
| `pnpm -C apps/api exec vitest run --maxWorkers=1 test/series.test.ts` | 5/5 qua |
| `pnpm -C apps/web exec vitest run --maxWorkers=1` | 62 file, 586 test qua |
| `pnpm lint` | sạch, 509 file |
| `pnpm typecheck` | qua (db, api, web) |
| `bash -n infra/deploy.sh` / `shellcheck -e SC1091 infra/deploy.sh` | qua / sạch |
| `pnpm --filter @mtl/web e2e series-manage.spec.ts` | 10/10 qua |
| `pnpm --filter @mtl/web e2e series-auto-memory.spec.ts` | 2/2 qua |

Lần chạy `pnpm typecheck` đầu tiên bị SIGKILL (máy thiếu RAM lúc đó). Chạy từng package thì ra lỗi kiểu thật (đã sửa),
rồi chạy lại `pnpm typecheck` thì qua. Trước khi chạy e2e, cổng 5181/8797 trống và không có Playwright nào khác chạy.
Server e2e do Playwright tự bật và tắt; sau khi chạy xong cả hai cổng đều trống.

## Còn lại (bỏ qua theo quyết định, chỉ ghi lại)

- **Nit 5** (lượt lưu xưng hô xếp hàng gửi `pronoun_keys_seen` cũ, cặp vừa lưu có thể sống lại): cần hai thao tác trong
  ~100–300 ms, rất hiếm. Không sửa.
- **Nit 6** (tab web cũ mở trước deploy crash ở glossary series vì thiếu `inherited`): hết khi tải lại trang. Không sửa,
  không thêm ghi chú.
- **Nit 10** (xoá series khi còn trường chờ lưu → PATCH 404 sau khi xoá): vô hại. Giờ chỉ xảy ra khi ô chữ chưa blur lúc
  bấm "Xoá vĩnh viễn". Thực tế bấm nút đã làm ô blur trước nên lượt lưu chạy trước lệnh xoá.
- Hàng xưng hô hoàn toàn trống cũng bị tô đỏ nếu có lượt lưu xưng hô khác chạy khi nó còn trên form, ví dụ thêm hàng
  rồi bấm Xoá hàng khác. Như vậy nhất quán với "hàng chưa lưu". "+ Thêm quy tắc" vẫn xoá báo đỏ cũ.
- Hook tự lưu vẫn chỉ có test thuần + e2e (web không có thư viện test DOM), giống báo cáo phase 2.
