# Research: infra, chi phí, stack app, editor (20/10/2026)

~11 web call. "(unverified)" = ước lượng/từ trí nhớ.

## 1. Đối thủ — Torii (toriitranslate.com, /pricing)
- Giá: gói credit không hết hạn — 2.5k/$5.99, 6k/$12.99, 15k/$29.99 (~$1.9–2.4/1k). ~1 credit/trang (scan + LLM; model premium tốn hơn). BYOK = 1 credit/ảnh.
- Extension: mọi trình duyệt lớn, click ảnh hoặc auto khi cuộn, dịch vùng màn hình, lưu ZIP/PDF/PSD, lịch sử.
- Web: upload ảnh/ZIP/PDF, dịch hàng loạt, clean, colorize.
- Editor: move/resize/rotate text, font tuỳ chỉnh, xoá/vẽ/AI inpaint, find/replace cả chương, OCR thủ công vùng chọn, warp text, layer, undo; dùng không cần đăng ký.
- Model: Claude/Gemini/GPT/DeepSeek/Grok, chia sẻ ngữ cảnh giữa trang, prompt riêng theo bộ (kính ngữ, glossary). Strip dài dịch nguyên ảnh.
- "140+ ngôn ngữ" nhưng không nêu tiếng Việt → chất lượng VI chưa rõ.
- Khác biệt có thể làm: VI-first (xưng hô, glossary VI, font đủ dấu), workflow nhóm (role, giao chương, trạng thái duyệt), worker local miễn phí + BYOK, glossary chung cho nhóm. Hoãn: extension, colorize, PSD.

## 2. GPU serverless
| Nhà cung cấp | Giá | Cold start | Nhận xét |
|---|---|---|---|
| Modal | /giây: T4 $0.000164, L4 $0.000222, A10 $0.000306; $30 free/tháng | container 1–2s, tính cả load model, idle 60s mặc định | DX tốt nhất, Python-first, Volume chứa weights → **chọn 1** |
| RunPod Serverless | L4 ~$0.69/h, 4090 $1.10/h | chưa kiểm | Rẻ hơn, Docker + handler, nhiều ops → **chọn 2** |
| Beam | T4 ~$0.54/h (unverified), $30 free | | Ổn, cộng đồng nhỏ |
| Replicate | T4 $0.81/h | ~60s custom | Kém cho tải dồn cục |
| fal.ai / Vast.ai | — | — | Bỏ qua |

- GPU/trang (1–3s): ~$0.0005–0.0007 → ~$0.5–1/1000 trang. Ở lưu lượng thấp, cold start + idle tail chiếm phần lớn (load 1–3GB weights 5–20s). Giảm: weights trên Volume/snapshot, chỉnh scaledown_window, gộp nhiều trang/call.
- CPU-only VPS (unverified): ~5–15s/trang trên 4 vCPU → đủ vài nghìn trang/ngày qua hàng đợi, không hợp tương tác tức thì. Giữ cùng interface worker cho CPU/MPS/GPU.

## 3. Chi phí LLM/trang (~3k token vào gồm ảnh, ~600 ra, không thinking)
| Model | In/Out per MTok | $/trang | $/1k trang |
|---|---|---|---|
| Gemini 2.5 Flash-Lite | 0.10/0.40 | 0.0005 | 0.54 |
| Claude Haiku 5.5 | 0.10/0.50 | 0.0006 | 0.60 |
| Gemini 3.1 Flash-Lite | 0.25/1.50 | 0.0017 | 1.65 |
| Gemini 2.5 Flash | 0.30/2.50 | 0.0024 | 2.40 |
| Gemini 3 Flash Preview | 0.50/3.00 | 0.0033 | 3.30 |
| Claude Sonnet 5.5 | 2/10 | 0.012 | 12 |
- Batch API Claude giảm 50%. Thinking tính như output → có thể đắt gấp nhiều lần.
- Chưa có benchmark JA/KO/ZH→VI. Đề xuất: Haiku 5.5 hoặc Gemini 3.1 Flash-Lite mặc định; Gemini 3 Flash / Sonnet 5.5 cho "premium". Test mù 50 trang trước khi chốt.
- DeepL có tiếng Việt (06/2025) nhưng chỉ text, không ngữ cảnh ảnh → không hợp.

## 4. Stack app (1 đề xuất)
- Monorepo TypeScript: Vite + React SPA (editor + dashboard), API Hono, package types dùng chung. (Phương án khác: Go + River + React — gần thói quen user, chấp nhận được.)
- Postgres + Drizzle; better-auth (plugin organization → workspace/thành viên/role).
- Hàng đợi: bảng job trong Postgres (pg-boss), không Redis. Worker Mac local: chỉ gọi ra ngoài (claim/heartbeat/complete qua HTTP) → không cần mở cổng. GPU serverless: dispatcher gọi Modal, worker trả kết quả qua callback có ký. Job theo trang, idempotency key.
- Lưu trữ: MinIO + presigned PUT/GET; sang R2 khi public. Path `ws/{id}/proj/{id}/page/{id}/{original,clean,mask}.png`.
- Deploy: VPS + Cloudflare + systemd.
- Multi-tenant: mọi bảng có workspace_id, ép qua query helper (RLS để sau). Bảng: users, workspaces, memberships, projects(series), chapters, pages, page_state (JSON editor: text box, layer, version), jobs (status, attempts, worker_id, cost), glossary, usage_ledger (credit/quota, sẵn cho thanh toán). Kiểm quota khi enqueue.

## 5. Editor canvas
| Lựa chọn | Kết luận |
|---|---|
| Konva / react-konva | **Chọn.** Layer gốc/sạch/text/mask khớp Konva Layer; MIT |
| Fabric.js v6 | Có serialize JSON + sửa text sẵn, nặng hơn với scene lớn, không có chữ dọc |
| PixiJS | WebGL nhanh nhất nhưng sửa text tự làm → thừa cho MVP |
| Polotno SDK | Trên Konva, license thương mại $199–899/tháng gắn domain → loại |

Thiết kế với Konva:
- Strip dài 10000+px: trình duyệt giới hạn canvas (~16k px/cạnh, Safari thấp hơn — unverified) → cắt tile 1024–2048px, mỗi tile 1 Konva.Image, chỉ render tile trong viewport.
- Chữ dọc: custom Shape hoặc mỗi cột 1 Text. Chữ cong: Konva.TextPath.
- Brush mask: layer canvas offscreen → xuất PNG mask → worker LaMa → thay layer "clean".
- Undo/redo: state trong store (zustand + immer patches), Konva chỉ để render.
- Export: trang nhỏ xuất client (toBlob); strip dài xuất theo tile rồi ghép ở server, hoặc render state JSON phía server — chốt sớm.

## Câu hỏi chưa giải quyết
1. Torii dịch tiếng Việt tốt không (thử tài khoản free)?
2. Extension có vào MVP không?
3. Editor cần cộng tác real-time hay chỉ khoá theo chương?
4. Bộ truyện/ngôn ngữ nguồn nào chiếm đa số?
5. Rủi ro pháp lý/ToS khi SaaS lưu nội dung scanlation (DMCA, quy trình gỡ)?
