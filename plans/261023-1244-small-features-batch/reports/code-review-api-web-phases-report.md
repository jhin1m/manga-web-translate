# Code review: phase 1, 3, 4, 5 (API + web) — đợt tính năng nhỏ

Ngày: 2026-10-23 · Nhánh `feat/small-features-batch` (chưa commit) · Người review: code-reviewer

## Phạm vi
- P1: `packages/db` migration 0011 + down, `routes/pages.ts`, `routes/series.ts` (`exportStatus`).
- P3: `lib/mailer.ts`, `lib/invite-email.ts`, `auth.ts`, `env.ts`, `routes/workspaces.ts`, web `routes/workspaces.tsx`, `test/invite-email.test.ts`.
- P4: `PUT .../source-files/order` (`routes/chapters.ts`), web `features/chapter/{api,use-source-images,source-rail,source-rail-model,chapter-workspace}`.
- P5: `shared/ignore-text.ts`, `jobs/claim-inputs.ts`, `lib/batch-edit.ts`, `routes/series-ignore-apply.ts`, `find-replace.ts`, web `features/series/*`, `text-table/rows.ts`.
- Bỏ qua phase 2/6 (reviewer khác), trừ chỗ chạm chung.

## Kiểm tra đã chạy
- `pnpm typecheck`: sạch. `pnpm lint` (biome): sạch, 297 file, không fix.
- `pnpm --filter @mtl/shared test`: 28/28 pass.
- Không chạy test API/e2e (theo yêu cầu).
- Thử ReDoS thật (tsx, shared `compileIgnoreList`): `/\w*\w*\w*\w*\w*\w*\w*\w*!/` **qua được validation** (`ignoreEntryError` = null) và **treo > 120 s** trên chuỗi 60 ký tự `a` (bị alarm giết).
- Kiểm JSX hint bằng esbuild: chuỗi hiển thị là `/discord\\s*\\.\\s*gg/` (2 dấu `\`).

## Đánh giá chung
Refactor batch-edit sạch, giữ đúng hành vi cũ. Route mới có tenant isolation và có test. Có 2 lỗi mức high cần
quyết định trước khi merge: (1) heuristic chặn ReDoS không chặn được backtracking đa thức, mà regex chạy đồng bộ
trong transaction claim của API dùng chung mọi tenant; (2) sắp xếp ảnh làm hỏng luồng "tiếp tục upload" của chương nháp.

**Điểm: 7/10**

---

## Critical
Không có.

## High

### H1. ReDoS: heuristic để lọt mẫu đa thức, regex chạy đồng bộ trong transaction claim → treo cả API (mọi tenant)
- `packages/shared/src/ignore-text.ts:34-55` (`hasNestedQuantifier`) chỉ bắt lượng từ lồng trong nhóm. Lượng từ
  **đứng cạnh nhau** (`\w*\w*\w*…`, `.*.*.*…x`) hay alternation chồng lấn (`(a|a)+`, report đã thừa nhận) không bị chặn.
  Giới hạn 100 ký tự cho phép ~30 lượng từ liên tiếp → O(n^k).
- Chạy ở: `apps/api/src/jobs/claim-inputs.ts:194,210,235` → `buildInputs` được gọi trong tx claim
  (`apps/api/src/jobs/queue.ts:144`). Cũng chạy ở preview/apply cấp series (`routes/series-ignore-apply.ts:118,156`),
  trên mọi region của mọi chương.
- Kịch bản: bất kỳ **thành viên** (không cần admin; `PATCH /w/:ws/series/:id` chỉ `requireWorkspace()`) lưu
  `/\w*\w*\w*\w*\w*\w*\w*\w*!/` → lần claim `chapter.translate` kế tiếp của series có câu OCR ~60 ký tự không có `!`
  → event loop Node bị chặn, tx claim giữ khoá dòng job. API ngừng phục vụ **mọi workspace**. Restart xong, worker
  claim lại đúng job đó → treo lại, cho tới khi xoá mục bằng SQL tay. Đã tái hiện: treo > 120 s.
- Plan đánh giá rủi ro này là "tự gây" (invite-only). Thực tế blast radius là **liên tenant** (một tiến trình API
  dùng chung), nên giả định đó không đúng. Đây là quyết định của user → trình bày lựa chọn, chưa tự đổi:
  1. Dùng `re2` (thời gian tuyến tính) ở API; web giữ `RegExp` (chỉ treo tab của chính người đó). Chắc nhất.
  2. Thêm vào heuristic: cấm ≥2 lượng từ không giới hạn trong cùng pattern, cấm alternation có lượng từ ở ngoài;
     cắt text còn ≤ 200 ký tự trước khi `re.test`. Rẻ, nhưng vẫn là danh sách chặn (blocklist).
  3. Chỉ owner/admin được lưu mục regex.
  4. Chuyển phần khớp regex sang worker (Python `re` cũng backtracking → cần timeout) — tốn công hơn.
  Khuyến nghị: 1, hoặc 2+3 nếu không muốn thêm dependency native.

### H2. Đổi thứ tự ảnh làm hỏng "tiếp tục upload" (resume) của chương nháp
- `apps/web/src/features/upload/upload-manager.ts:205-209,214`: `resumeChapter` ghép file thả lại (sắp tự nhiên)
  với `source_files` **sắp theo `ord`**, theo vị trí, và chỉ kiểm `bytes`. P4 đổi `ord` khi ảnh còn đang tải
  (report P4: "Ảnh đang tải lên vẫn đổi chỗ được").
- Kịch bản: thả 30 ảnh → đang upload thì kéo ảnh 30 lên đầu → đóng tab / mất mạng → mở lại và thả cùng bộ file →
  lỗi "Ảnh thứ 1 (…) khác dung lượng file đã khai báo", không tiếp tục upload được, trừ khi tự đảo lại đúng thứ tự cũ
  hoặc xoá chương. Nếu 2 ảnh trùng `bytes`, bytes của ảnh này bị đẩy lên key của ảnh kia (sai ảnh, `dhash`/kích thước
  lệch) mà không có cảnh báo.
- Cách sửa (chọn 1):
  - `resumeChapter` sắp `source_files` theo `id` (uuidv7, tạo tuần tự trong `POST /chapters` → đúng thứ tự khai
    báo), không theo `ord`.
  - Hoặc chặn đổi thứ tự khi `uploadedIds` chưa đủ (rail đã có trạng thái upload).
  Thêm unit test cho `resumeChapter` sau khi reorder.

## Medium

### M1. Đổi thứ tự liên tiếp nhanh: PUT chạy song song, server có thể chốt thứ tự khác UI
- `apps/web/src/features/chapter/use-source-images.ts:113-129`: mutation TanStack mặc định chạy song song, và
  `onSuccess` không ghi lại thứ tự server trả về. Mỗi PUT gửi **cả bộ** `ids`. `lockChapter` tuần tự hoá ở DB, nhưng
  thứ tự commit phụ thuộc lúc request tới, không phải lúc bấm.
- Kịch bản: giữ Alt+↓ (phím lặp ~30 ms) → PUT N-1 commit sau PUT N → DB giữ thứ tự N-1, UI hiện thứ tự N (cache
  không lấy lại trong 10-12 phút) → Bước 1 ghép theo thứ tự người dùng không nhìn thấy.
- Sửa: `useMutation({ scope: { id: \`reorder-${chapterId}\` }, … })` để các mutation chạy nối tiếp, và/hoặc ghi
  `source_files` server trả về ở `onSuccess` khi `seq.current === ctx.n`.

### M2. Báo "Đã gửi email" kể cả khi gửi lỗi
- `apps/web/src/routes/workspaces.tsx:79-80`: câu thông báo dựa vào `mail_enabled` (đã cấu hình), không dựa vào việc
  gửi có thành công. `auth.ts` nuốt lỗi gửi (đúng yêu cầu), nhưng UI vẫn hiện "Đã gửi email mời tới X".
- Kịch bản: mật khẩu SMTP hết hạn → mọi lời mời báo "Đã gửi email…", admin tin là đã gửi và không chuyển link.
  Phần "Không nhận được? Gửi link này" chỉ giảm nhẹ chứ không sửa được hiểu lầm.
- Plan chỉ yêu cầu "biết mail đã bật hay chưa", nên đúng tiêu chí, nhưng gây hiểu lầm. Sửa rẻ: ghi lần gửi cuối
  (ok/lỗi) theo invitation id vào bộ nhớ hoặc cột, rồi trả `mail_sent` ở `GET …/link`. Hoặc đổi câu thành
  "Đã thử gửi email…".

### M3. Hint regex ở form hiển thị sai (2 dấu `\`)
- `apps/web/src/features/series/series-settings-form.tsx:213`: JSX text không xử lý escape, nên
  `/discord\\s*\\.\\s*gg/` hiện nguyên 2 dấu `\` (đã xác nhận bằng esbuild). Người dùng copy về sẽ được regex khớp
  dấu `\` thật, không khớp `discord . gg`.
- Sửa: `{"(vd /discord\\s*\\.\\s*gg/)"}` (đưa vào chuỗi JS) hoặc viết `\s` một dấu trong JSX text.

### M4. Áp ngược cấp series: N+1 và đọc toàn bộ state series vào bộ nhớ, chạy 2 lần
- `routes/series-ignore-apply.ts:118-120,156-158`: mỗi chương chạy `chapterPages` (2 query, tải JSON `page_states`
  đầy đủ). Apply đọc lại toàn bộ rồi `applyBatch` đọc thêm lần nữa trong tx. Series 200 chương × 50 trang → ~400-600
  query và vài trăm MB JSON trong một request đồng bộ, kèm regex (H1) trên mọi region.
- Chấp nhận được cho MVP, nhưng cần ghi lại giới hạn. Cải thiện: 1 query lấy state của mọi chương (`inArray`
  chapterId), và ở apply chỉ chạy `applyBatch` cho chương có `versions` trong body.

## Low

- **L1** `apps/api/src/lib/mailer.ts:14`: `decodeURIComponent(url.password)` ném `URIError` khi mật khẩu có `%`
  không hợp lệ (`smtps://u:ab%zz@h` qua được `z.string().url()`). Lỗi xảy ra **bên trong** `catch` của `auth.ts`,
  nên thoát ra ngoài → `inviteMember` trả 500 dù lời mời đã tạo, và link không được log. Sửa: bọc
  `try { decodeURIComponent } catch { raw }`, hoặc validate lúc parse env.
- **L2** `routes/series-ignore-apply.ts:83-89`: `alreadyMine` lấy từ snapshot `ch` chụp ở đầu request. Nếu chính user
  mở editor (lấy khoá) giữa lúc chụp và lúc `acquire`, `finally` sẽ nhả mất khoá của editor đó (heartbeat có thể
  lấy lại). Sửa: đọc holder ngay trước `acquireChapterLock`.
- **L3** `routes/series-ignore-apply.ts:206-215`: undo cấp series không bỏ qua chương `busy` (apply thì có), và
  nhận **bất kỳ** `batch_id` nào của series, kể cả batch find-replace/glossary cấp chương (khi đó chạy chế độ
  `skip` thay vì `fail`). Cùng tenant, cùng quyền, không phải lỗ hổng, nhưng hợp đồng chưa chặt. Có thể lọc theo
  actor/loại batch nếu cần.
- **L4** `source-rail.tsx:44,142`: Alt+↑ ở ảnh đầu (hoặc Alt+↓ ở ảnh cuối) đặt `refocus.current` nhưng `moveSource`
  no-op, không clear → lần `items` đổi sau đó (vd xoá ảnh khác) sẽ kéo focus về ảnh cũ.
- **L5** `use-source-images.ts:121`: `before` chỉ lấy từ cache `sourceFiles`. Nếu cache đó trống mà detail có dữ
  liệu, lỗi API không hoàn được thứ tự ở cache detail.
- **L6** Đổi ngữ nghĩa danh sách đã lưu (P5): mục cũ dạng `/…/` (trước là chữ thường) giờ thành regex; mục như `a b`
  (hợp lệ trước đây) giờ không hợp lệ → form báo lỗi dòng và PATCH series (luôn gửi `ignore_text`) bị 400 cho tới
  khi sửa mục đó. Chưa thấy ghi chú migration dữ liệu. Nên có 1 dòng trong docs/README.
- **L7** `routes/pages.ts:106`: `sql\`now()\` as unknown as Date` ép kiểu cho qua type của `Scoped.update`. Chạy
  đúng nhưng che kiểu. Nên mở rộng `Values<T>` để nhận `SQL`, hoặc thêm comment.
- **L8** Mail: `role` gửi thô (`member`/`admin`) trong mail tiếng Việt. Nên map sang "thành viên"/"quản trị".

## Hồi quy ở các điểm chạm (b)
- **find-replace / glossary-apply → `batch-edit.ts`**: đã so từng dòng với `HEAD`. Lọc trang `skipped`, kiểm
  `versions` → 409 `preview_stale`, update có điều kiện version, history `batch_id`, `pruneHistory`, undo
  409 `undo_conflict` / 404 `batch_not_found`, kiểm khoá `assertChapterLock` ở route: **giữ nguyên**. JSON apply giữ
  key `replaced`. Khác biệt duy nhất: undo trả `pages` = số trang thực sự khôi phục, thay vì `hist.length` (chỉ lệch
  khi dòng `page_states` đã bị xoá). Không đáng kể. `MAX_PREVIEW_MATCHES` đã chuyển file, không còn chỗ import cũ.
- **claim-inputs**: `compileIgnoreList` biên dịch 1 lần mỗi claim. `withoutIgnored` giờ luôn copy (trước đây trả
  nguyên object khi list rỗng), chỉ tốn chút bộ nhớ. Đúng hành vi, ngoài H1.
- **invite-only auth**: link/token không đổi. Chỉ log link khi không gửi được mail. Gửi lại dùng `resend: true` của
  better-auth 1.7.11 (đã đọc source: giữ id, gia hạn `expiresAt`, quyền `invitation:create` → member bị 403).
- **assertSourcesEditable / lock**: route order dùng đúng mẫu PATCH skip (`lockChapter` FOR UPDATE + guard trong
  tx). Commit kiểm bộ ảnh theo tập (không theo thứ tự) nên reorder xen giữa không làm hỏng commit. Ingest đọc `ord`
  lúc claim. Ngoại lệ là luồng resume upload ở web (H2).
- **exportStatus**: `maxBy(skip_changed_at)` bỏ qua null, chạy song song trong `Promise.all`, không N+1.

## Hợp đồng công khai (c)
- `GET …/invitations/:id/link` chỉ thêm `mail_enabled`. Env mới `SMTP_URL`/`MAIL_FROM` là tuỳ chọn, có trong
  `.env.example` và docs. `PATCH /pages/:id` giữ shape `{id, skipped}`. Cột `pages.skip_changed_at` nullable, file
  down theo đúng mẫu 0010.
- `isIgnoredText` / `isValidIgnoreEntry` giữ chữ ký, nhưng ngữ nghĩa đổi (L6).
- Không thuộc phạm vi nhưng có trong diff: `MIN_PIPELINE_VERSION` 0.4.2 → 0.5.1 (phase 6, reviewer kia đã nắm).

## Bảo mật (e)
- Không log link khi gửi thành công: đúng (`auth.ts`, test kiểm `console.info`).
- Mật khẩu SMTP được che trong log lỗi, trừ ngoại lệ ở L1.
- HTML mail escape đủ `& < > " '`, kể cả `href`. Tên bị bỏ xuống dòng, subject đi qua nodemailer encode.
- Tenant isolation: 4 route mới (order, ignore-apply preview/apply/undo) có case 403 chéo workspace và 404 chéo tài
  nguyên trong `tenant-isolation.test.ts`. Undo đọc `page_state_history` qua `sdb` scoped.
- Gửi lại chỉ admin/owner: do quyền better-auth, có test.
- ReDoS: xem H1.

## Churn định dạng (biome)
- Đã đối chiếu `git diff --name-only` với danh sách file trong 6 phase: không thấy file **ngoài phạm vi** nào bị
  sửa chỉ vì định dạng. Mọi file đổi đều có trong file "Related Code Files" của một phase, hoặc là output sinh ra
  (`packages/shared/json-schema/*` từ `schema:emit`, thay đổi do zod của phase 2/6). Các hunk kiểu xuống dòng
  `inArray(\n…)` nằm trong code mới viết. Không có churn cần revert.

## Tiêu chí chấp nhận (a)
| Phase | Đạt | Còn mở |
|---|---|---|
| P1 | Cột + PATCH chỉ bump khi đổi + exportStatus + test 3 kịch bản + docs | Kiểm tay UI "Xuất lại" |
| P3 | Env + refine, mailer timeout, mail VI có escape, fallback log, `mail_enabled`, nút gửi lại, test | Thử SMTP thật. M2 (câu báo sai khi gửi lỗi) |
| P4 | API + 400/423/409 + tenant + `moveItem` + DnD/menu/Alt+↑↓ + toast hoàn tác + e2e | Safari tay. **H2**, M1 |
| P5 | Bỏ dấu cách, regex, lỗi từng dòng, compile 1 lần, áp ngược có xem trước/hoàn tác/bỏ qua chương khoá | **H1** (heuristic yếu hơn rủi ro thật), M3, M4 |

`plan.md` vẫn ghi mọi phase là "Pending" trong khi các phase file ghi `completed`. Lead nên cập nhật.

## Việc nên làm (theo thứ tự)
1. H1: user chọn hướng (re2 / heuristic chặt hơn + cắt độ dài text + chỉ admin). Trước khi merge.
2. H2: resume sắp theo `id`, hoặc khoá reorder khi upload chưa xong. Thêm unit test.
3. M1: thêm `scope` cho mutation reorder.
4. M3: sửa chuỗi hint (1 dòng).
5. M2, L1: sửa nhanh ở mailer và câu báo.
6. M4 và các mục low: làm sau.

## Câu hỏi còn mở
- H1: có giữ được giả định "rủi ro tự gây" khi API dùng chung cho nhiều workspace không? Nếu không → cần quyết định
  hướng 1/2/3.
- H2: có muốn cho phép đổi thứ tự khi upload chưa xong không (sửa resume), hay khoá luôn (đơn giản hơn)?
