---
title: "Font theo kiểu chữ (suy nghĩ, ghi chú)"
description: "AI dịch gắn kiểu chữ normal/thought/note cho từng vùng; typeset chọn font theo slot series; editor đổi loại chữ nhanh"
status: completed
priority: P2
effort: "1.5d"
tags: [fonts, typeset, translate, editor, contract, tdd]
created: 2026-11-02
---

# Font theo kiểu chữ (suy nghĩ, ghi chú)

## Overview

Brainstorm: [brainstorm-261102-1547-text-style-fonts-and-effects-report.md](../reports/brainstorm-261102-1547-text-style-fonts-and-effects-report.md) (phần A; phần B hiệu ứng chữ = plan sau).

Hiện tại: font chọn chỉ theo `kind` (`text_bubble` → Thoại, `text_free` → Dẫn truyện) ở `worker/mtl_pipeline/typeset.py:197 font_for`. Thêm trục **kiểu chữ** do LLM dịch suy ra từ text (không thấy ảnh):

| style | Nhận diện (prompt) | Font slot | Slot trống → |
|---|---|---|---|
| `normal` | mặc định / không chắc | theo kind như cũ | — |
| `thought` | ngoặc （…）/(…), độc thoại nội tâm, nói thầm | `default_fonts.thought` | font theo kind (như normal) |
| `note` | ghi chú/viết tay nhỏ ngoài bóng | `default_fonts.note` | font theo kind (như normal) |

Fallback "slot trống → như normal" giữ series cũ chạy y hệt (không cần đoán font nào).

## Quyết định

- `Region.style` optional enum `normal | thought | note`; thiếu = `normal`. Trang cũ không đổi.
- `TranslateSettings` thêm `thought_font?`, `note_font?` (optional, như `narration_font`). API **chỉ gửi khi series đã chọn** slot; worker thiếu → font theo kind.
- Series `default_fonts` jsonb thêm khoá `thought`, `note` (không migration).
- `PIPELINE_VERSION` 0.7.1 → **0.8.0** (schema strict: worker cũ từ chối region có `style` / settings có trường mới). Deploy: worker trước → nâng `MIN_PIPELINE_VERSION` → API/web.
- Editor: ô "Loại chữ" ở Properties chỉ hiện khi box có region **và** series đã chọn ≥ 1 slot thought/note; đổi loại = set `region.style` + `box.font_family` (1 bước undo). Box vẽ tay không region → không có ô.
- Đổi slot series không cập nhật box đã có (giống slot hiện tại).
- Chương đã dịch không có style; chỉ dịch mới/dịch lại mới được AI gắn. Chương cũ đổi tay bằng ô "Loại chữ". Không làm job gắn style riêng.
- `MIN_PIPELINE_VERSION` default trong `apps/api/src/env.ts` lên `0.8.0` cùng worker.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Hợp đồng shared + version](./phase-01-shared-contract.md) | Done |
| 2 | [Worker: style từ LLM + chọn font](./phase-02-worker-style-and-font.md) | Done |
| 3 | [API: settings + font inputs](./phase-03-api-settings-and-claim-fonts.md) | Done |
| 4 | [Web: slot series + editor Loại chữ](./phase-04-web-series-slots-and-editor.md) | Done |
| 5 | [Docs + gate đầy đủ](./phase-05-docs-and-full-gate.md) | Done |

Tuần tự 1 → 2 → 3 → 4 → 5 (2 cần schema của 1; 3 cần 1; 4 cần 1+3).

## Success Criteria

- [x] Dịch chương mới: region có `style`; box `thought`/`note` dùng font slot khi series đã chọn; slot trống → như cũ.
- [x] Trang/job/payload cũ (không `style`, không trường font mới) chạy và render y hệt trước.
- [x] Editor đổi "Loại chữ" → đổi font theo slot, lưu được, undo 1 bước.
- [x] Font tuỳ chỉnh (`custom-*`) đặt ở slot mới được worker tải (claim inputs).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `cd worker && uv run pytest` xanh; contract schema test xanh.

## Out of scope

Hiệu ứng chữ (viền đôi, bóng đổ) — plan riêng sau. Gửi ảnh vào call dịch, kiểu "hét", gradient, preset, SFX.

## Open questions

- Độ chính xác `thought`/`note` text-only chưa đo — đo trên 2–3 chương thật trong phase 2 (KO + JA); quá tệ thì siết prompt, sau nữa mới cân nhắc thumbnail.

## Validation Log

### Session 1 — 2026-11-02
Questions asked: 3
1. Ô "Loại chữ" khi series chưa chọn slot → **ẩn** (option chỉ gồm loại có slot). → phase 4.
2. Chương đã dịch không có style → **chấp nhận**, không làm job gắn style riêng. → plan Quyết định.
3. Đo độ chính xác trên 2–3 chương thật → **có**. → phase 2.

### Verification Results
- Claims checked: 22 (tier Full, 5 phase; spot-check theo file/symbol/flow)
- Verified: 19 | Failed: 0 | Unverified → resolved: 3
- Resolved: `TRANSLATE_SCHEMA` viết tay `worker/mtl_pipeline/providers/base.py:66` (phase 2 sửa rõ); `MIN_PIPELINE_VERSION` default `apps/api/src/env.ts:44` phải bump (phase 3 sửa rõ); emit ra `packages/shared/json-schema/` (phase 1).
- Flow: AI state thay nguyên state khi `stateOrigin === "ai"` (`apps/api/src/jobs/page-state-writer.ts:35`) → style đi theo; trang đã sửa tay → `aiUpdateAvailable`, không mất. Proofread lưu gợi ý riêng (`queue.ts:421`), không đụng region.
- Schema strict worker (`worker/mtl_worker/__init__.py` mốc 0.5.0/0.7.1) → bump 0.8.0 đúng lệ.

### Whole-Plan Consistency Sweep
- Đã đọc lại plan.md + 5 phase: fallback slot trống = theo kind (thống nhất plan/phase 2/phase 4/report brainstorm); version 0.8.0 nhất quán phase 1/3/5; không còn "kiểm" mơ hồ về schema provider/env.
- Mâu thuẫn còn lại: 0.

<!-- slug: text-style-fonts -->

## Kết quả thực thi — 2026-11-02

- Gate: typecheck + biome xanh; test shared 38, web 325, db 5, api 319, worker 276; ruff sạch.
- Đo style: [reports/phase-02-style-accuracy-report.md](./reports/phase-02-style-accuracy-report.md) — prompt đã siết sau lượt 1 (Gemini gắn note cho thoại ngoài bóng). Lượt 2 đo bằng Haiku vì Gemini hết quota free tier; **còn phải đo lại trên Gemini trước deploy**.
- Kiểm tay editor: [reports/phase-04-loai-chu.png](./reports/phase-04-loai-chu.png).
- Review: `plans/reports/code-review-261102-1630-text-style-fonts-report.md` (8.5/10); đã sửa: test export slot độc lập + mutation-check, doc parity, type trùng, test ẩn select. Còn lại (chấp nhận): font slot tuỳ chỉnh chưa nạp → editor rơi về font theo kind; test parse style chỉ qua Anthropic (dùng chung `parse_translate` với Gemini).
- Deploy: worker 0.8.0 → `MIN_PIPELINE_VERSION=0.8.0` → API/web (docs/deployment-guide.md).
