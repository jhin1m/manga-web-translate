---
phase: 8
title: "Trước khi mở đăng ký công khai: control plane SaaS"
status: pending
priority: P2
effort: "~8d"
dependencies: [7]
---
# Phase 8: Trước khi mở đăng ký công khai — quota, BYOK, admin nền tảng, takedown

## Overview
Tách từ Phase 7 cũ (red team #8, user duyệt 20/10/2026). MVP chạy invite-only cho một nhóm chưa thu tiền nên không cần các phần này; **bắt buộc xong phase này trước khi tắt invite-only**. Gồm: quota theo workspace có giữ chỗ nguyên tử, BYOK qua proxy LLM phía API, `platform_role` + router `/admin` riêng, audit log nền tảng append-only, takedown 2 bước + form báo cáo có rate-limit, ToS, ma trận role vượt owner/member, đối soát billing.

## Requirements
- **Quota theo workspace, giữ chỗ nguyên tử (red team #8, #14):** bảng `workspace_quotas` (workspace_id PK, plan, monthly_page_limit, monthly_budget_usd, pages_used, pages_reserved, usd_used, usd_reserved, period_start). Enqueue: `UPDATE … SET pages_reserved = pages_reserved + $n WHERE workspace_id=$ws AND pages_used + pages_reserved + $n <= monthly_page_limit RETURNING` — 0 dòng → **402** + thông báo. Complete/fail/cancel: chuyển reserved → used theo chi phí thực (server tính), nhả phần thừa. **Fail-closed:** workspace không có dòng quota → từ chối, trừ `plan='internal'` (nhóm hiện tại; không giới hạn nhưng vẫn ghi ledger). `ENFORCE_QUOTA=false` chỉ dùng khi rollback.
- **BYOK qua proxy LLM phía API (red team #8):** key không bao giờ rời VPS. Worker gọi `POST /worker/v1/jobs/:id/llm` (fenced bằng `lease_token`+`attempt`, chỉ provider/model trong allowlist, giới hạn số call/token theo job); API giải mã key **AES-256-GCM, AAD = workspace_id** (key master từ env/file root-only), gọi provider, trả kết quả. Worker thêm provider `proxy` trong `mtl_pipeline/providers/`. Ledger ghi token với `cost_usd=0` cho phần LLM BYOK. Không log key; test grep log/DB/response.
- **Admin nền tảng:** cột `user.platform_role` (`none`/`support`/`superadmin`), tách khỏi role trong workspace; router `/admin/*` riêng (middleware riêng, không dùng `requireWorkspace`); trang admin: job queued/running/failed 24h, p50/p95 thời gian/trang, chi phí ngày, quota từng workspace.
- **Audit log nền tảng:** bảng `platform_audit_log` (actor_user_id, action, target_type, target_id, workspace_id **giá trị, không FK** — xoá workspace không xoá log), append-only (REVOKE UPDATE/DELETE cho role DB của app).
- **Takedown 2 bước:** bước 1 `suspend` (ẩn series/workspace, chặn mọi presigned GET, job huỷ) ngay khi nhận báo cáo hợp lệ; bước 2 `purge` (xoá object storage + dữ liệu) sau khi người có `platform_role` thứ hai xác nhận hoặc hết thời hạn phản hồi; mỗi bước ghi `platform_audit_log`.
- **Form báo cáo vi phạm** công khai: rate-limit theo IP + email (VD 5/giờ), captcha, lưu vào hàng đợi xử lý của admin.
- **Rà license trước khi thương mại hoá** (MVP bỏ qua license theo quyết định user 20/10/2026): liệt kê code/model/font đã dùng (theo comment ghi nguồn + `models.lock.json`), thay phần GPL/AGPL hoặc weight/font không cho dùng thương mại, viết `docs/third-party-licenses.md`.
- **ToS** + chính sách lưu trữ (tuỳ chọn xoá ảnh gốc sau N ngày) + chính sách không train model trên dữ liệu người dùng; tư vấn pháp lý trước khi mở.
- **Ma trận role vượt owner/member:** owner/admin (thành viên, quota, key BYOK), editor (upload, sửa, export), viewer (xem); kiểm ở middleware + test ma trận cho mọi route.
- **Đối soát billing hằng ngày:** so tổng `usage_ledger` theo provider với số liệu usage/hoá đơn provider; lệch > 5% → cảnh báo.
- Mở đăng ký: bật lại sign-up + cho user tạo workspace (gán `workspace_quotas` plan free mặc định) — chỉ sau khi mọi tiêu chí dưới đạt.

## Architecture
```
enqueue ─> quota.reserve (UPDATE … RETURNING) ─402─> UI
complete/fail/cancel ─> quota.settle(actual_cost)
worker ─> /worker/v1/jobs/:id/llm (lease fenced) ─> API: decrypt(AES-GCM, AAD=ws) ─> provider ─> kết quả
/admin/* (platform_role) ─> takedown suspend → purge (2 người / hết hạn) ─> platform_audit_log
```

## Related Code Files
Create:
- `packages/db/src/schema/{workspace-quotas.ts,platform-audit-log.ts,byok-keys.ts,abuse-reports.ts}` + migration (thêm `user.platform_role`)
- `apps/api/src/billing/{quota.ts,reconcile.ts}`, `apps/api/src/crypto/byok.ts`, `apps/api/src/llm-proxy/*`
- `apps/api/src/routes/{admin/*.ts,byok.ts,members.ts,abuse-report.ts}`, `apps/api/src/middleware/{platform-role.ts,rate-limit.ts}`
- `apps/web/src/features/settings/{Members.tsx,Usage.tsx,ApiKeys.tsx}`, `apps/web/src/features/admin/*`, `apps/web/src/routes/{terms.tsx,report.tsx}`
- `worker/mtl_pipeline/providers/proxy.py`
- `apps/api/test/{quota-reservation.test.ts,byok-proxy.test.ts,roles-matrix.test.ts,takedown.test.ts,admin-router.test.ts}`
- `docs/takedown-policy.md`, `docs/terms-of-service.md`
Modify: `apps/api/src/jobs/{enqueue.ts,queue.ts}` (reserve/settle), `apps/api/src/routes/worker.ts` (route llm), `apps/api/src/auth.ts` (mở sign-up có điều kiện)

## Implementation Steps
1. Migration quota/audit/byok/abuse + `platform_role`.
2. `quota.ts` reserve/settle + test đua 50 enqueue đồng thời không vượt hạn mức.
3. BYOK: mã hoá AAD, proxy LLM fenced, provider `proxy` trong worker, test không rò.
4. Router `/admin` + `platform_role` + trang số liệu.
5. Takedown 2 bước + `platform_audit_log` + form báo cáo rate-limit.
6. Ma trận role + test.
7. Đối soát billing + cảnh báo.
8. ToS/chính sách; tư vấn pháp lý; checklist mở đăng ký.

## Success Criteria
- [ ] 50 enqueue đồng thời ở biên hạn mức → không vượt quota; vượt → 402 có thông báo; job đã nhận vẫn chạy xong.
- [ ] Workspace không có dòng quota (không phải `internal`) → enqueue bị từ chối.
- [ ] BYOK key không xuất hiện trong log/DB plaintext/response API/worker (test grep); ciphertext đem sang workspace khác không giải mã được (AAD).
- [ ] Gọi `/worker/v1/jobs/:id/llm` với lease cũ → 409.
- [ ] Viewer không sửa được, editor không quản lý thành viên (test ma trận); user không có `platform_role` gọi `/admin/*` → 404.
- [ ] Takedown 1 series: suspend → mọi GET 404 ngay; purge → object storage bị xoá; có 2 dòng `platform_audit_log`, còn nguyên sau khi xoá workspace.
- [ ] Form báo cáo: request thứ 6/giờ từ cùng IP → 429.
- [ ] Đối soát 7 ngày liên tiếp lệch ≤ 5%.

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| Rò key BYOK | Thấp × Cao | Proxy phía API, key không rời VPS, AAD theo workspace, không log |
| Quota đua (check-then-insert) | TB × TB | Giữ chỗ nguyên tử bằng UPDATE có điều kiện |
| Admin lạm quyền / xoá nhầm | Thấp × Cao | Takedown 2 bước, audit append-only không FK |
| DMCA/bản quyền khi mở công khai | TB × Cao | ToS, takedown, private-by-default, tư vấn pháp lý trước khi mở |
| Spam form báo cáo | TB × Thấp | Rate-limit + captcha |
| Proxy LLM thành nút cổ chai VPS | TB × TB | Chỉ dùng cho BYOK; key platform vẫn ở worker; timeout + giới hạn đồng thời |

Rollback: tất cả sau cờ — `ENFORCE_QUOTA=false`, tắt route BYOK (worker dùng key platform), giữ invite-only (không mở đăng ký). Migration additive.
