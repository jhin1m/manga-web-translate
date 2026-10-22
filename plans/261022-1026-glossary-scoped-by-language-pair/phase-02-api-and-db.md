---
phase: 2
title: "Phase 2: API glossary, translate, apply"
status: done
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: API glossary, translate, apply

## Overview
Một nguồn sự thật cho "entry nào áp cho series" (kèm điều kiện workspace); route glossary workspace nhận cặp qua
query; API là nơi duy nhất đảm bảo "entry chung có cặp, entry series không".

## Requirements
- `translateSettings` và `glossaryRules` dùng chung điều kiện lọc + thứ tự gộp (series đè workspace).
- Route workspace (`GET/POST /w/:ws/glossary`, `GET/POST /w/:ws/glossary/csv`) bắt buộc query
  `?source_lang=<SOURCE_LANGS>&target_lang=<TARGET_LANGS>`; thiếu/sai → 400 `invalid_query`. `parseQuery` gọi **trong
  handler**, sau middleware `requireWorkspace` → người ngoài workspace vẫn nhận 403 trước (red team #10).
- Route series không đổi chữ ký; `inherited` chỉ gồm entry chung đúng cặp của series.
- `PATCH/DELETE /w/:ws/glossary/:entryId` không đổi; phạm vi (series hoặc cặp) lấy từ chính entry. Cặp của entry
  không sửa được qua PATCH.
- `entryView` thêm `source_lang`, `target_lang` (null với entry series).
- `bumpGlossaryRev` **giữ nguyên** hành vi: entry chung → tăng mọi series của workspace (`sql\`true\``). Lọc theo cặp sẽ
  bỏ qua (không khoá) series đang được PATCH đổi sang cặp đó trong transaction song song → job dịch trùng key dùng
  glossary cũ (red team #1). Tăng thừa chỉ làm series khác cặp lỡ dedupe — vô hại.

## Architecture
Mới `apps/api/src/lib/glossary-scope.ts`:
```ts
/** Entry áp cho series: entry riêng của series + entry chung đúng cặp nguồn→đích, luôn trong workspace của series. */
export const seriesGlossaryWhere = (s: Pick<Series, "id" | "workspaceId" | "sourceLang" | "targetLang">) =>
  and(
    eq(glossaryEntries.workspaceId, s.workspaceId),
    or(
      eq(glossaryEntries.seriesId, s.id),
      and(isNull(glossaryEntries.seriesId), eq(glossaryEntries.sourceLang, s.sourceLang),
          eq(glossaryEntries.targetLang, s.targetLang)),
    ),
  ) as SQL;

/** Workspace trước, series sau → entry series thắng khi trùng source_term. */
export function mergeBySourceTerm<E extends { seriesId: string | null; sourceTerm: string }>(entries: E[]): Map<string, E>
```
Điều kiện workspace nằm **trong** helper (red team #6): `translateSettings` đọc qua `DbLike` thô
(`apps/api/src/jobs/enqueue.ts:197-205`), không có `Scoped` tự thêm `workspace_id` (`packages/db/src/scoped.ts:59`).
Với `Scoped` (find-replace) điều kiện bị lặp — vô hại.
- `enqueue.ts translateSettings`: `.where(seriesGlossaryWhere(s))` + `mergeBySourceTerm`.
- `find-replace.ts glossaryRules(sdb, s: Series, body)`: đổi tham số `seriesId` → series row (caller
  `find-replace.ts:304`, `:314` đã có `s`), dùng cùng helper.
- `routes/glossary.ts`: thay `seriesId: string | null` bằng
  ```ts
  type Scope = { seriesId: string } | { seriesId: null; sourceLang: SourceLang; targetLang: TargetLang };
  ```
  `scopeWhere(scope)` (dùng ở `glossary.ts:76,184,185,207,225,226`) thêm điều kiện cặp cho workspace;
  `create`/`importCsv` ghi cặp khi workspace, NULL khi series; `assertUniqueTerm`, `exportCsv` (tên file
  `glossary-workspace-<src>-<tgt>.csv`), `list` dùng `Scope`. `scopeOfEntry(row)` cho PATCH/DELETE.
  `bumpGlossaryRev(tx, seriesId | null)` giữ chữ ký và thân hàm.
- `lib/validate.ts`: thêm `parseQuery(c, schema)` cùng kiểu `parseJson` (lỗi `invalid_query`).
- Không cần tăng `glossary_rev` khi series đổi cặp: đổi ngôn ngữ đã tăng `settings_rev` (`series.ts:200-204,298`), và
  idempotency key dịch gồm cả hai rev (`jobs/idempotency.ts:24-33`) — đã kiểm.

## Related Code Files
- Create: `apps/api/src/lib/glossary-scope.ts`
- Modify: `apps/api/src/routes/glossary.ts`, `apps/api/src/jobs/enqueue.ts`, `apps/api/src/routes/find-replace.ts`,
  `apps/api/src/lib/validate.ts`
- Modify tests (red team #10):
  - `apps/api/test/glossary.test.ts` — gọi route workspace kèm query; các test 400 hiện có (`:84-85`) assert theo
    `error` (`invalid_body` vs `invalid_query`) để không pass sai lý do; insert trực tiếp ở `:108` thêm cặp.
  - `apps/api/test/find-replace.test.ts:228` — insert entry chung thêm `sourceLang: "ko", targetLang: "vi"`.
  - `apps/api/test/tenant-isolation.test.ts:56` — insert thêm cặp. **Không** sửa bảng route (route workspace không có
    resource id, 403 đến từ `requireWorkspace` trước khi parse query).

## Implementation Steps
1. `parseQuery` + `glossary-scope.ts`.
2. Đổi `translateSettings` và `glossaryRules` sang helper; chạy test hiện có (series ko→vi phải không đổi).
3. Refactor `routes/glossary.ts` sang `Scope`; cập nhật comment đầu file (entry chung theo cặp).
4. Test mới (`glossary.test.ts` trừ khi ghi chú khác):
   - workspace route thiếu cặp / cặp sai → 400 `invalid_query`; người ngoài workspace gửi query hợp lệ → 403.
   - entry chung ko→vi + ko→en cùng term (insert được); trùng trong một cặp → 409 `duplicate_term`.
   - series ko→en: `translateSettings` chỉ có bản ko→en; entry series cùng term đè.
   - workspace B có entry chung ko→en cùng term: `translateSettings` của series ko→en ở A không chứa nó (red team #6).
   - entry tạo qua route workspace có cặp; qua route series có NULL/NULL.
   - `inherited` của series ko→en không chứa entry ko→vi.
   - sửa entry chung → `glossary_rev` mọi series workspace +1 (hành vi cũ giữ nguyên).
   - CSV `replace` cho ko→vi không đụng entry ko→en; export trả đúng cặp.
   - `find-replace.test.ts`: glossary-apply với term chỉ có ở cặp khác → 400 `unknown_terms`.
5. `pnpm --filter @mtl/api test` + `pnpm typecheck` + `pnpm lint`.

## Success Criteria
- [x] Mọi test api xanh, gồm test mới ở bước 4.
- [x] Trong `apps/api/src` không còn chỗ lọc entry chung bằng `isNull(glossaryEntries.seriesId)` mà thiếu cặp, ngoài
      `scopeWhere` của route glossary.

## Risk Assessment
- Breaking contract route workspace (query bắt buộc): client duy nhất là web, sửa cùng lúc ở Phase 3. Không thêm
  default ko/vi để tránh lỗi ẩn M3 quay lại. Tab SPA mở từ trước deploy nhận 400 tới khi tải lại (ghi docs, không
  làm UI riêng).
