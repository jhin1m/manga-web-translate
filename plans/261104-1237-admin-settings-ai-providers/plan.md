---
title: "Trang cài đặt admin và cấu hình API AI"
description: "/settings admin-only (ADMIN_EMAILS): provider AI (Anthropic, Gemini, OpenAI, OpenAI-compatible) key mã hoá trong DB, 3 slot model, giá DB, pipeline chung, hạn mức + đăng ký runtime, quản lý user, font hệ thống"
status: implemented; pending manual smoke + commit
priority: P1
effort: "8-9d"
branch: feat/admin-settings-ai-providers
tags: [admin, ai-providers, secrets, billing, auth, worker, web, migration]
created: 2026-11-04
blockedBy: []
blocks: []
---

# Trang cài đặt admin và cấu hình API AI

## Overview

`/settings` hiện là cài đặt cá nhân (Font + Pipeline trong `user_settings`). Key AI chỉ ở env worker, 2 provider, bảng
giá hardcode lặp ở `apps/api/src/billing/prices.ts:5` + `worker/mtl_pipeline/providers/base.py:25`. Không có khái niệm
admin. Plan: `/settings` thành trang admin, cấu hình provider/key/model/giá trên UI, worker nhận key theo job lúc claim.

Chế độ **hard + TDD**: mỗi phase có Tests Before (khoá hành vi hiện tại) → Refactor/Implement → Tests After → Regression
Gate. Mọi đường dẫn/symbol đã kiểm trong repo ngày 2026-11-04 (red team kiểm lại cùng ngày).

Báo cáo đầu vào:
- Thiết kế đã duyệt: [brainstorm-261104-1237-admin-settings-ai-providers-report.md](../reports/brainstorm-261104-1237-admin-settings-ai-providers-report.md)
- [research-261104-1237-openai-compatible-provider-report.md](./reports/research-261104-1237-openai-compatible-provider-report.md)
- [research-261104-1237-better-auth-admin-secrets-report.md](./reports/research-261104-1237-better-auth-admin-secrets-report.md)
- Red team: `reports/red-team-261104-1305-{assumption-destroyer,failure-mode-analyst,scope-complexity-critic,security-adversary}-report.md`

<!-- red-team -->
## Quyết định của user (D1–D8, nguyên văn brainstorm — không đảo)

| # | Quyết định |
|---|---|
| D1 | `/settings` **admin-only**; Pipeline → cài đặt **chung toàn hệ thống**; font cá nhân → `/fonts` (menu avatar) |
| D2 | Admin xác định qua env **`ADMIN_EMAILS`** (không migration role) |
| D3 | Key AI lưu **DB mã hoá** (AES-256-GCM, master key env `SECRETS_KEY`), nhập từ UI |
| D4 | Provider: **Anthropic, Gemini, OpenAI, OpenAI-compatible** (base URL tuỳ chỉnh) |
| D5 | Gán model **3 slot: OCR / Dịch / Hiệu đính**; bỏ tier Standard/Premium |
| D6 | Giá model **admin nhập** (đề xuất sẵn giá model đã biết); billing đọc từ DB |
| D7 | Phạm vi thêm: **hạn mức chi phí + bật/tắt đăng ký trên UI, danh sách user (khoá/mở), font hệ thống** |
| D8 | Giữ cả 6 giai đoạn trong 1 plan (red team tách giai đoạn 3 thành 3a/3b → 7 phase, cùng phạm vi) |

<!-- red-team -->
## Tự quyết (đổi được)

Lựa chọn kỹ thuật chốt sau research + red team; đảo được nếu có bằng chứng mới.

| # | Lựa chọn | Phase |
|---|---|---|
| T1 | Đăng ký runtime: `hooks.before` `/sign-up/email` đọc `system_settings.signup_enabled` (fallback env); bỏ `disableSignUp`; giữ mã `EMAIL_PASSWORD_SIGN_UP_DISABLED`; không bật được khi thiếu 1 trong 2 hạn mức hiệu lực. Hook **luôn** chặn email thuộc `ADMIN_EMAILS` (admin chỉ tạo bằng `pnpm create-user`) | 1 (chặn admin), 5 |
| T2 | Rate limit: tắt khi `NODE_ENV=test` (test cần thì bật qua tham số + IP riêng); bật ở dev/production | 5 |
| T3 | Khoá user tự làm: `user.disabled_at` (`additionalFields`), hook `session.create.before` fail-closed, `deleteUserSessions`, `requireUser` kiểm, claim bỏ job của user bị khoá | 6 |
| T4 | Mã hoá: AES-256-GCM, blob `base64(version1B|iv12|tag16|ct)`, AAD `ai_provider:<id>`, **1** `SECRETS_KEY`, không xoay tự động (đổi key = nhập lại key provider trên UI) | 2 |
| T5 | `base_url` compatible: bắt buộc `https`; probe dùng `fetch` không theo redirect + timeout 10s; không kiểm DNS/IP | 2 |
| T6 | Đổi `base_url` → bắt buộc nhập lại key (409 `key_required`) | 2 |
| T7 | Slot = 3 cột FK `ON DELETE RESTRICT` trên `system_settings` (migration 0022); `model_id` bất biến; xoá provider/model bị chặn khi còn slot hoặc job active tham chiếu | 2 |
| T8 | Worker: 1 class `OpenAIProvider` (SDK `openai`, Chat Completions) cho `openai` + `openai_compatible`; `strict_schema()` chỉ cho OpenAI; structured output = cờ provider + tự hạ `json_object` 1 lần khi 400 khớp; `finish_reason=length` → `schema`; 429 quota/402 → `auth`; `max_completion_tokens` (chính chủ) / `max_tokens` (compatible); `reasoning_effort: "low"` chỉ khi model có cờ `reasoning` | 3 |
| T9 | Worker: `jobs.error` chỉ còn lớp lỗi + câu chung; redact chạy ở formatter (trước mọi `log.exception`); logger SDK/HTTP ghim WARNING kể cả `-v` | 3, 4 |
| T10 | Key giao theo job lúc claim; payload snapshot `{provider_id, model}`; giải mã lỗi → job `failed` `auth` với câu rõ ràng | 4 |
| T11 | Breaker LLM theo provider (`provider_id`; job dùng env → khoá `env` = hàng `llm_errors`/`llm_paused` hiện có) | 4 |
| T12 | Billing sửa 1 lần (phase 4): job có `payload.llm` → giá ref; không → bảng tĩnh y nguyên. Không tính riêng `cached_tokens` | 4 |
| T13 | Bỏ tier: key + payload proofread giữ `{tier}` khi chưa gán slot Hiệu đính (1 phiên bản); gỡ `series.llm_tier` (migration 0023, không tăng `settings_rev`) | 4 |
| T14 | Bump pipeline **0.10.0** + `MIN_PIPELINE_VERSION`; deploy worker trước API | 4 |
| T15 | Pipeline chung: copy trong SQL migration 0021 từ hàng `user_settings` `updated_at` mới nhất; không có → mặc định | 1 |
| T16 | Font hệ thống dùng lại id `custom-<8hex>` (không đổi hợp đồng worker); trần 20 font hoặc tổng 100MB | 7 |
| T17 | Hạn mức trên UI: xác nhận khi giá trị mới < đã chi hôm nay; không có trần trên (admin được tin, `GLOBAL_MONTHLY_USD` env vẫn chặn) | 5 |
| T18 | Gợi ý giá model mặc định không reasoning; model reasoning: cờ `reasoning` + cảnh báo trần token trên UI | 2 |

## Phases

| # | Phase | Effort | Phụ thuộc | Status |
|---|-------|--------|-----------|--------|
| 1 | [Nền admin + layout + `/fonts` + pipeline chung](./phase-01-admin-foundation-layout-fonts-global-pipeline.md) | 1.25d | — | Completed |
| 2 | [Provider/model/key (API + UI) + slot](./phase-02-ai-providers-models-keys-db-prices.md) | 1.5d | 1 | Completed, pending manual smoke (probe OpenAI/compatible) |
| 3 | [`OpenAIProvider` + compatible chạy bằng env/CLI](./phase-03-openai-provider-env-mode.md) | 1d | — (worker thuần) | Completed, pending manual smoke (OpenAI + OpenRouter) |
| 4 | [Key theo job qua claim + breaker theo provider + billing + bỏ tier + 0.10.0](./phase-04-per-job-llm-config-via-claim.md) | 2d | 2, 3 | Completed, pending manual smoke (key thật, đổi key, quét log `-v`) |
| 5 | [Hạn mức + đăng ký runtime](./phase-05-cost-limits-runtime-signup.md) | 1d | 1 | Completed |
| 6 | [Người dùng (list, chi phí, khoá/mở)](./phase-06-users-list-cost-disable.md) | 1d | 1 | Completed |
| 7 | [Font hệ thống](./phase-07-system-fonts.md) | 1d | 1 | Completed |

<!-- red-team -->
Thứ tự thực thi: **tuần tự 1 → 7**. Phase 3 không phụ thuộc gì (worker thuần, không bump) nên làm song song với 1–2
được nếu có 2 người (chỉ chung `.env.example` + `docs/job-queue-worker.md` — gộp lúc merge). 5/6/7 độc lập về logic sau 1 nhưng chung file
(`apps/api/src/auth.ts` 1+5+6, `apps/api/src/routes/admin.ts`, `apps/web/src/features/admin/admin-sections.ts`,
`apps/api/src/billing/user-quota.ts` 5+6, docs) và chuỗi migration → không chạy song song.

<!-- red-team -->
Migration: 0021 `system_settings` (P1, kèm copy pipeline) · 0022 `ai_providers` (P2, kèm 3 cột slot FK) · 0023
`drop_series_llm_tier` (P4) · 0024 `user_disabled_at` (P6) · 0025 `system_fonts` (P7). Sinh: `pnpm --filter @mtl/db
generate --name <slug>` (drizzle-kit, `strict: true`), thêm SQL dữ liệu/CHECK nếu cần (`--> statement-breakpoint`), kèm
file down `packages/db/migrations-down/00NN_<slug>.down.sql`. Cột user: `pnpm auth:generate` trước rồi `db:generate`.
Đổi thứ tự 5↔6↔7 → đánh số migration theo thứ tự merge.

## Thứ tự deploy (1 release)

1. `.env` API: `ADMIN_EMAILS`, `SECRETS_KEY` (backup ngoài DB — mất/đổi key = nhập lại key provider); không ghi đè
   `MIN_PIPELINE_VERSION` < 0.10.0.
2. Backup DB (`docs/deployment-guide.md` mục 7).
3. Worker Mac + image Modal lên **0.10.0** (`uv sync` có `openai`; `modal deploy modal_app.py`). Worker 0.10.0 đọc
   được payload/claim cũ (mọi trường mới optional).
4. `infra/deploy.sh <ref>`: migrate 0021–0025, API + web + `mtl-jobs`; `infra/smoke.sh` kiểm đăng ký theo trạng thái
   thật (phase 5), không tạo user.
5. Smoke tay: admin vào `/settings`, user thường bị redirect; thêm provider → Kiểm tra → gán slot → dịch 1 chương.
6. Rollback: xem phase 4 (checklist 0.10.0) — 0023 xoá cột `series.llm_tier` nên API bản cũ cần chạy down 0023 trước.

## Tiêu chí nghiệm thu

- [x] User thường: không thấy link Cài đặt, `GET /api/admin/*` → 403, `/settings` → redirect `/`; `/fonts` dùng được. (test quét router + e2e)
- [x] Đăng ký bằng email thuộc `ADMIN_EMAILS` luôn bị từ chối. (signup.test + e2e)
- [ ] Admin thêm provider OpenAI + key → Kiểm tra OK → gán slot Dịch → dịch chương dùng đúng model, ledger tính theo giá đã nhập.
      Chưa: luồng đã phủ bằng test/fake worker; chưa chạy với key OpenAI thật (smoke tay).
- [x] Đổi key trên UI → job kế tiếp dùng key mới, không restart worker. (claim-llm test; smoke key thật chưa)
- [x] Không có provider DB → worker chạy như cũ bằng env. (Tests Before + idempotency key không đổi)
- [x] Key không xuất hiện trong response web, log API, log worker, `jobs.payload/result/error`. (assert chuỗi trong test API + test redact worker)
      Chưa: quét log worker `-v` với key thật.
- [x] Bật đăng ký khi thiếu hạn mức → bị chặn; tắt đăng ký → signup bị từ chối ngay, không restart; deploy không vỡ smoke. (admin-limits/signup test; `smoke.sh` chạy thật cả 2 trạng thái)
- [x] Khoá user → session hiện tại về login; đăng nhập lại → `USER_DISABLED`; job của họ không được claim nữa. (admin-users test + e2e)
- [x] Font hệ thống hiện trong editor của mọi user và render đúng ở worker. (e2e fonts + test_job_fonts; id `custom-*` nên worker không đổi)
- [x] `pnpm typecheck && pnpm lint && pnpm test`, `cd worker && uv run pytest && uv run ruff check .`,
      `pnpm --filter @mtl/web e2e` pass. (tester 2026-11-04: api 431, web 371, shared 60, db 8, worker 351, e2e 55/55,
      migration 0021–0025 up/down/up sạch — `from-tester-261104-1544-final-regression-gate-report.md`)

## Gate chung

Phase 1–2: typecheck + lint + test (shared/db/api/web) + e2e liên quan. Phase 3: pytest + ruff. Phase 4: thêm `pnpm
schema:emit` không lệch (`packages/shared/test/shared-contracts.test.ts`). Phase 7 cuối: e2e đầy đủ.

## Kết quả triển khai (2026-11-04)

Cả 7 phase đã code + review + áp fix review; thay đổi đang staged, chưa commit. Review: 8–8.5/10, 0 Critical, 1 High (phase 6, đã fix).

Báo cáo:
- Implementer: `plans/reports/from-fullstack-developer-261104-{1337-phase-01-admin-foundation, 1356-phase-02-ai-providers, 1337-phase-03-openai-provider, 1414-phase-04a-api-llm-config, 1430-phase-04b-worker-llm-config, 1446-phase-05-limits-signup, 1506-phase-06-users-admin, 1523-phase-07-system-fonts}-report.md`
- Review: `plans/reports/from-code-reviewer-261104-{1345-phase-01-03, 1408-phase-02, 1438-phase-04, 1506-phase-05, 1514-phase-06, 1534-phase-07}-review-report.md`
- E2E cuối: xem `from-tester-261104-1544-final-regression-gate-report.md` (chưa có kết quả lúc sync).

Số test (sau review fix): api 431 · web 371 · shared 60 · db 8 · worker 351. Typecheck + lint sạch, `db generate` / `schema:emit` không lệch. E2E: pending (lần chạy cuối của phase 7: 55/55).

Còn lại trước khi đóng plan:
1. Smoke tay key thật (chưa chạy): probe OpenAI + compatible; `--provider openai` / OpenRouter dịch 1 chương; Gemini OCR 1 trang; đổi key giữa chừng; quét log worker `-v`.
2. ~~Kiểm ảnh Modal có cài `openai`~~ — đã kiểm: cài từ pyproject (`modal_app.py:35`).
3. ~~`pnpm db:migrate` dev DB~~ — đã ở 0025. Còn: thêm `ADMIN_EMAILS` + `SECRETS_KEY` vào `.env` local.
4. ~~Dọn dòng pipeline per-user trong docs~~ — đã sửa (docs chỉ còn `PUT /api/admin/settings/pipeline`).
5. Commit (conventional, tách theo phase nếu muốn) — e2e cuối đã xanh.

Lệch đáng nhớ:
- Phase 3: quota 429 theo hậu tố `_spend_limit_exceeded`/`_usage_limit_exceeded` (+ `insufficient_quota`, `credit_balance_exhausted`); tự hạ `json_object` chỉ cho compatible.
- Phase 4: `saveSystemPipeline` merge jsonb để giữ `proofread_tier` legacy; billing nhiều ref → max, một ref → giá ref nếu `usage.model` khớp; claim vẫn chạy kiểm ngân sách toàn cục khi breaker đang dừng; thiếu provider → câu lỗi chung, không lộ uuid.
- Phase 5: server quyết định `confirm_required` (web không có `needsConfirm`); `GET` trả thêm `env`, `effective.signup_open`; `/healthz.signup` = `open|closed|null`.
- Phase 6: `AuthGate` bỏ dev auto-login sau khi từng có session; 403 `user_disabled` điều hướng full-page.
- Phase 7: `Scoped.selectShared` (chỉ bảng không có `userId`); `allocateCustomFontId` kiểm cả 2 bảng font; 409 xoá trả `series_count`, có runbook SQL (chưa chạy thử), không force-delete.

## Câu hỏi còn mở

Đã giải quyết khi triển khai:
1. ~~Header probe Anthropic/Gemini~~ — đã kiểm live: Anthropic `x-api-key` + `2023-06-01` OK; Gemini `x-goog-api-key` OK, key sai trả 400 `API_KEY_INVALID` → auth. OpenAI/compatible: chưa kiểm live (không có key).
2. ~~Giá gợi ý OpenAI~~ — đối chiếu lại 2026-11-04, khớp research (nguồn WebFetch tóm tắt; admin vẫn xác nhận giá trên UI).

Còn chờ user quyết:
3. DB `null` = theo env → admin không đặt được "không giới hạn" đè env. Đã triển khai theo đề xuất (chấp nhận); cần user xác nhận.
4. `GLOBAL_MONTHLY_USD` vẫn chỉ env (chưa có trên UI) — chờ xác nhận giữ.
5. Audit log thao tác admin — chưa làm (YAGNI), chờ xác nhận.
6. Worker token lộ → lộ mọi key slot: chưa làm `worker_tokens.llm_keys`; rủi ro đã ghi ở `docs/deployment-guide.md`. Cần quyết có làm không.
7. Job `queued` của user bị khoá vẫn nằm hàng đợi (không claim, không tốn tiền; ghi docs) — chờ quyết có huỷ hẳn khi khoá không.
8. (Mới) Env khẩn cấp vs DB: hiện DB thắng env (`DB ?? env`); không có env override. Khẩn cấp: sửa trên UI hoặc `UPDATE system_settings SET global_daily_usd=0 / signup_enabled=false WHERE id=1` (đã ghi docs). Cần user chốt có thêm env override không.
9. (Mới) Force-delete font hệ thống đang là mặc định của series: hiện 409 `in_use` + runbook SQL; cần user chốt có thêm tuỳ chọn force-delete không.

<!-- red-team -->
## Red Team Review

Session 2026-11-04 · 4 reviewer (assumption-destroyer, failure-mode-analyst, scope-complexity-critic,
security-adversary) · 36 finding gốc gộp thành 15 nhóm · **14 nhận / 1 bác**.

| # | Nhóm | Mức | Quyết định | Áp vào |
|---|---|---|---|---|
| 1 | Chiếm admin qua đăng ký email thuộc `ADMIN_EMAILS` | Critical | Nhận: hook sign-up chặn email admin (chuẩn hoá trim/lowercase), admin chỉ tạo bằng `create-user`, có test | P1, P5 |
| 2 | Đổi `base_url` giữ key cũ → gửi key tới host lạ | High | Nhận: PATCH đổi `base_url` bắt buộc kèm key mới (409 `key_required`) | P2 |
| 3 | SSRF/rò rỉ: guard tự viết chỉ ở API, worker theo redirect, lỗi provider tới user, scrub sau log | High | Nhận (rút gọn): bỏ `safeRequest`/kiểm DNS/cờ private; https + probe không redirect + timeout; `jobs.error` câu chung; redact ở formatter; ghim logger; ghi rủi ro token worker | P2, P3, P4 |
| 4 | Máy xoay master key (keyring, PREV, script) thừa + rủi ro restore | High | Nhận: bỏ script, PREV, keyring; giữ byte version; đổi key = nhập lại | P2 |
| 5 | Xoá/sửa provider/model làm job đang chờ fail; `ai_tasks` jsonb không FK | High | Nhận: 409 khi còn job active tham chiếu; `model_id` bất biến; 3 cột FK RESTRICT ở 0022; giải mã lỗi → `auth` rõ ràng | P1, P2, P4 |
| 6 | Breaker LLM toàn cục → 1 provider hỏng dừng cả hệ thống | High | Nhận: breaker theo provider (`env` cho job env) | P4 |
| 7 | Hạ hạn mức trên UI fail job hàng loạt | High | Nhận: UI (+ API) bắt xác nhận khi < đã chi hôm nay, cảnh báo nêu hậu quả | P5 |
| 8 | Đăng ký runtime phá `smoke.sh`/deploy; rate limit làm test đỏ | High | Nhận: smoke kiểm đúng trạng thái không tạo user; docs; rate limit tắt ở `NODE_ENV=test`; sửa dòng rủi ro; giữ nút (D7) | P5 |
| 9 | Phase 3 quá to; thiếu fake `_Deps` trong test worker | High | Nhận: tách 3a/3b (→ phase 3 + 4), liệt kê mọi fake deps, ước lượng lại | P3, P4 |
| 10 | Bỏ tier chưa đủ (`series.llm_tier`), key proofread đổi phá dedup | Medium | Nhận: giữ key/payload `{tier}` 1 phiên bản; gỡ `llm_tier` (migration 0023) không tăng `settings_rev` | P4 |
| 11 | Touchpoint bị sót (Properties.tsx, đếm 20 font, 401 web, test dùng route xoá, cache query) | High | Nhận: bổ sung vào Related files + test | P1, P6, P7 |
| 12 | User bị khoá vẫn được claim job; hook fail-open | Medium | Nhận: claim bỏ job user bị khoá; hook fail-closed (an toàn với `create-user` — script không tạo session) | P6 |
| 13 | `tenant-isolation` quét cả route admin; state process (`ADMIN_EMAILS`, secrets) rò giữa test | High | Nhận: loại `/api/admin/` có chủ đích + test riêng; reset env sau mỗi test; ca email viết hoa | P1, P2 |
| 14 | Đơn giản hoá (billing 1 lần, structured output 1 cơ chế, reasoning theo cờ, font `custom-`, migration SQL, trần font, gợi ý không reasoning, tách bảng quyết định) | Medium | Nhận toàn bộ | P1, P2, P3, P4, P7, plan.md |
| 15 | Hạn mức UI không có trần trên (env nên là trần) | Medium | **Bác**: admin được tin; `GLOBAL_MONTHLY_USD` env vẫn chặn | — |

### Whole-Plan Consistency Sweep

Đọc lại plan.md + 7 phase sau khi sửa; grep thuật ngữ cũ trên mọi file plan (2026-11-04):

| Thuật ngữ cũ | Kết quả |
|---|---|
| `sys-` (id font hệ thống) | 0 — phase 7 dùng `custom-<8hex>`, `JobFonts` không đổi |
| `safeRequest`, `assertPublicHost`, `BlockList`, `AI_ALLOW_PRIVATE_BASE_URL` | chỉ còn trong bảng Red Team Review (mô tả việc bỏ) |
| `SECRETS_KEY_PREV`, `SECRETS_KEY_ID`, `rotate-secrets`, keyring | chỉ còn trong Red Team Review + câu "không keyring" ở phase 2 |
| `ai_tasks` (jsonb) | 0 trong phase; API đổi tên `PUT /settings/slots`, field `slots`, zod `AiSlots`; slot = 3 cột FK (0022) |
| `seed` (seed pipeline lúc boot) | 0 — thay bằng SQL trong 0021; "seed" còn lại chỉ là seed dữ liệu test/e2e |
| `tier` | chỉ ở D5, T13, phase 1 (tier đọc từ pipeline tới phase 4), phase 3 (`make_provider(name, tier)` env), phase 4 (legacy `{tier}`) — nhất quán |
| Số phase / phụ thuộc | 7 phase; tham chiếu chéo đã đổi (claim = phase 4, hạn mức = 5, user = 6, font = 7); bảng Phases khớp frontmatter `dependencies` |
| Migration | 0021 (P1) · 0022 (P2, gồm slot FK) · 0023 (P4) · 0024 (P6) · 0025 (P7) — khớp từng phase + checklist deploy (migrate 0021–0025) |
| Billing | chỉ đổi ở phase 4 (phase 2 ghi rõ "không đổi"; phase 3 chỉ thêm 2 dòng giá bảng tĩnh cho env OpenAI) |
| `LlmConfig` | `{type, model, api_key, base_url, structured_output, reasoning}` ở phase 4 = tham số `OpenAIProvider` phase 3; không còn `vision` |
| `structured_output` | 1 cơ chế: cột provider (mặc định `json_schema`, phase 2) + tự hạ 1 lần (phase 3) |

Mâu thuẫn còn lại: không. Điểm cần kiểm lúc implement (không phải mâu thuẫn): thứ tự validate mật khẩu/email trong
`better-auth/dist/api/routes/sign-up.mjs` cho `smoke.sh` (phase 5); `useSession` có refetch khi `$sessionSignal` (phase 6).

## Quyết định cho câu hỏi còn mở (2026-11-04, user uỷ quyền)

User giao quyết hộ. Mọi lựa chọn dưới đây giữ nguyên code đã triển khai (ưu tiên ổn định, YAGNI), đảo lại được khi cần.

| Câu hỏi | Quyết định | Lý do |
|---|---|---|
| Env 0 có luôn thắng giá trị UI (công tắc khẩn cấp) không? | **Không** — giữ DB thắng env (D7/T17) | Đặt 0 / tắt đăng ký trên UI có hiệu lực ngay, không restart → nhanh hơn sửa env. Runbook đã ghi cách UI + SQL. Hai nguồn sự thật dễ gây nhầm hơn |
| Nút xoá cưỡng bức font hệ thống đang làm mặc định series | **Không làm** | Hiếm (chủ yếu khi gỡ vì bản quyền); runbook SQL đã kiểm trên DB thử. Nút cưỡng bức đổi font của user khác một cách âm thầm |
| Q3: DB `null` = theo env, admin không đặt "không giới hạn" đè env được | **Chấp nhận** | Muốn không giới hạn thì bỏ biến env. Tránh thêm trạng thái thứ 3 trên UI |
| Q4: `GLOBAL_MONTHLY_USD` chỉ env | **Giữ chỉ env** | Là trần an toàn cứng cuối cùng; UI không nên gỡ được nó |
| Q5: Audit log thao tác admin | **YAGNI** | Hiện 1 admin. Làm khi có ≥2 admin |
| Q6: Token worker riêng để nhận key (`worker_tokens.llm_keys`) | **Chưa làm** | Worker chỉ chạy trên Mac/Modal của chủ hệ thống; token đã là bí mật. Làm khi có worker bên thứ ba |
| Q7: Khoá user có huỷ job đang chờ không | **Không huỷ** | Job không được claim → không tốn tiền; mở khoá là chạy tiếp (đảo được). Rủi ro khi rollback API đã ghi trong deployment-guide |
| `SECRETS_KEY` cho `.env` local | **Đã tạo** (`openssl rand -base64 32`) | Cần để lưu key provider trên UI khi dev |
