# Báo cáo overnight — cài đặt pipeline, OCR local, LaMa manga, AI hiệu đính

Brief: [`plans/261024-0028-local-ocr-manga-lama-proofread/goal-brief.md`](../261024-0028-local-ocr-manga-lama-proofread/goal-brief.md)
· Plan: [`plan.md`](../261024-0028-local-ocr-manga-lama-proofread/plan.md) · Branch `feat/pipeline-settings-local-ocr-proofread`
(từ `main` @ `c2a69b3`). Chưa push / merge / PR / deploy (đúng mục Cấm).

## Kết quả theo phase

| Phase | Commit | Nội dung |
|---|---|---|
| 1. Cài đặt pipeline | `b2ff8b7` | `packages/shared/src/pipeline-settings.ts` (zod + mặc định = hành vi cũ + `resolvePipelineSettings`), migration `0013_workspace_pipeline_settings` (+down), `PUT /api/w/:ws/settings/pipeline` (admin), `GET /api/w/:ws` trả `settings.pipeline`; snapshot vào payload `page.prepare.pipeline` / `page.reinpaint.inpaint` / `page.ocr_region.ocr_engine`; input_rev prepare chỉ đổi khi khác mặc định; `llmJobSql` + `isLlmPayload`: OCR local không bị breaker / kill-switch chặn; `MIN_PIPELINE_VERSION` 0.6.0; tab "Pipeline" ở Cài đặt nhóm (nhãn VI + thuật ngữ EN + tooltip, "Nâng cao" thu gọn) |
| 2. LaMa manga + CTD | `509988b` | `lama_manga` (ONNX `mayocream/lama-manga-onnx`, = dreMaz AnimeMangaInpainting — "lama漫画" của Saber; không cần convert), `LamaInpainter` dùng chung (hệ số output 0..1 → ×255), `inpaint_size` = cạnh cửa sổ gom; detector CTD (khối chữ từ output `blk`, port postprocess YOLO của manga-image-translator; bóng vẫn từ RT-DETR); `mask_dilation`; model `optional` + `ensure_model` tải lazy có sha256 |
| 3. OCR local | `8219447` | `mtl_pipeline/local_ocr/`: MangaOCR ONNX (`mayocream/manga-ocr-onnx`, encoder/decoder, greedy), PaddleOCR ONNX (PP-OCRv6 det/rec small + PP-OCRv5 korean rec của RapidOCR; port tiền/hậu xử lý, không thêm dependency); giữ `MIN_INK_RATIO` / thứ tự id / `low_conf`, usage rỗng; "OCR lại vùng" dùng engine theo cài đặt; script `worker/scripts/smoke_local_models.py` |
| 4. AI hiệu đính | `7deaf79` | Job `chapter.proofread` (LLM, tính tiền, fencing/heartbeat/retry như cũ), migration `0014_proofread_suggestions` (+down), `POST/GET …/chapters/:id/proofread`, `PATCH …/proofread-suggestions/:id`; worker 1 call/trang (JSON + ảnh gốc), prompt `prompts/proofread_page.md`, Premium = `MTL_*_PREMIUM_MODEL`; panel "Hiệu đính" trên rail: cũ → mới + lý do, Nhận / Bỏ, "Nhận tất cả ở trang này"; Nhận = `setRegionTranslation` qua editorStore (undo, autosave, version, khoá, relayout); khối sửa khác → "Lỗi thời" |
| 5. Docs + review | `fb6aa26`, `4b20da4` | README (tính năng, việc còn lại, gỡ "OCR local" khỏi chức năng thiếu), `docs/job-queue-worker.md`, `docs/editor.md`, `docs/design-guidelines.md`, `docs/development-setup.md`, checklist deploy `docs/deployment-guide.md` mục 4, `worker/THIRD_PARTY.md`; sửa finding code review |

## Kiểm tra (lần chạy cuối, sau commit `4b20da4`)

| Check | Kết quả |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` (biome) | 313 file, 0 lỗi |
| `pnpm test` | shared 37, db 3, web 197, api 252 — tất cả pass |
| `cd worker && uv run pytest` | 217 pass (gồm test model thật: LaMa manga, MangaOCR, PaddleOCR ko/en/zh); ruff + mypy sạch |
| `pnpm --filter @mtl/web e2e` | 34/34 pass (mới: `pipeline-settings`, `proofread`) |

Ghi nhận: 1 lần `proofread.test.ts` (ca "lượt cũ xong sau lượt mới") fail trong lượt chạy full đầu tiên sau sửa review;
đã đổi so `created_at` sang SQL (Date JS mất micro giây) — sau đó 5 lần chạy riêng + 4 lần full đều pass. Nguyên nhân
gốc lần fail đó chưa tái hiện được.

## Smoke test model thật

Máy: Mac (CPU, onnxruntime 1.31, không GPU). Ảnh: 2 trang manga màu tiếng Nhật chữ dọc 3066×4096 (`pic/before1.png`,
`before2.png` trong repo tham khảo Saber — chỉ dùng đo, không commit). Trong repo mình không có ảnh manga thật nào
(`worker/tests`, `spikes`, `docs/benchmarks` không có) → thêm chữ in tổng hợp từ font hệ thống cho ko/zh/en.
Nhãn CER tự gõ từ ảnh (11 vùng), CER = trung bình theo vùng, NFKC.

**Giai đoạn 1 (detect + mask + inpaint), giây/trang** — lượt đầu (máy đang chạy song song việc khác, số tuyệt đối dao động ±40%):

| Ảnh | RT-DETR + big_lama | RT-DETR + lama_manga | CTD + big_lama | CTD + lama_manga |
|---|---|---|---|---|
| before1 | 7.12 | 7.39 | 7.93 | 8.33 |
| before2 | 3.55 | 3.66 | 3.77 | 3.93 |

Phần lớn vùng chữ ở 2 trang này được flood-fill (nền bóng phẳng) nên LaMa ít chạy. Ép LaMa chạy mọi vùng (bỏ flood-fill):
before1 big_lama 22.7s, lama_manga 24.3s.

**Chất lượng xoá chữ (soi mắt):** bóng thoại 2 trang này bán trong suốt và chữ có viền trắng dày → với nới mask mặc
định (2–6px) cả 2 model đều để lại vệt viền trắng (hành vi sẵn có, không phụ thuộc inpainter). Nới mask 12px:
lama_manga sạch hơn rõ rệt so với big_lama (ít vệt, nền cửa gỗ phía sau liền hơn). CTD bắt thêm SFX "へへへ" (RT-DETR bỏ
qua) → bị xoá.

**OCR local (`ja`, thứ tự đọc rtl):**

| Engine | before1 (7 vùng) | before2 (4 vùng) | Thời gian OCR/trang |
|---|---|---|---|
| MangaOCR | CER 0.34 | CER 0.09 | 0.4–1.5s |
| PaddleOCR | CER 0.17 | CER 0.11 | 0.2–0.7s |

- MangaOCR: 3 bóng thoại dài đọc đúng gần tuyệt đối (sai `…` / `．．．` đã chuẩn hoá); CER before1 bị kéo lên bởi chữ
  ngang 2 dòng trên bìa sách (`最高級製薬の`, `バレンゼｎｏ`) và `ああ` thay vì `あ` (vùng 1 ký tự).
- PaddleOCR: trước khi tách cột theo hình chiếu, chữ dọc bị đọc theo hàng (CER ~0.6); sau sửa đúng phần lớn, bỏ sót
  vùng chữ nhỏ trên nền gỗ (rỗng → `low_conf`) và `フヒヒ…`.
- Chữ in tổng hợp: PaddleOCR zh ngang/dọc, ko, en, ja dọc CER 0; MangaOCR ja dọc đúng, confidence 0.998.
- Không có nhãn manhwa tiếng Hàn thật → **chưa đo** PaddleOCR tiếng Hàn trên trang thật.

**AI hiệu đính:** **chưa đo với LLM thật** (máy không có API key trong phiên; e2e dùng worker giả). Chất lượng gợi ý,
chi phí/chương Standard vs Premium cần đo.

## Code review (`/ak:code-review`)

3 reviewer độc lập (API/shared/DB, worker, web). Đã xác nhận "workspace chưa cấu hình chạy y hệt" (reviewer worker so
byte-to-byte regions/mask/clean với `c2a69b3` trên ảnh tổng hợp; input_rev prepare không đổi). Finding đã sửa (`4b20da4`):

| Mức | Finding | Sửa |
|---|---|---|
| Cao | PaddleOCR coi mọi crop cao zh/ja là chữ dọc → chữ ngang trong bóng cao bị xáo trộn, conf 0.99 | Chỉ tách cột khi trang đọc `rtl`; `page.ocr_region` mang `reading_order`; test hồi quy |
| Cao | Gợi ý hiệu đính gộp mọi khoảng trắng → Nhận làm mất xuống dòng tay; sửa riêng xuống dòng không bị coi là lỗi thời | Chuẩn hoá giữ `\n` ở worker / API / web, test |
| TB-Cao | Dispatcher Modal vẫn bỏ qua prepare OCR local khi breaker LLM bật | `oldestQueuedAgeS` dùng `not(llmJobSql)` |
| TB-Cao | URL ảnh proofread (10') hết hạn giữa chương dài | Worker tải + thu nhỏ mọi ảnh ngay sau claim |
| TB | 2 lượt hiệu đính complete cùng lúc đụng unique / lượt cũ đè lượt mới | Khoá dòng chương + bỏ lượt cũ khi đã có lượt mới thành công; test |
| TB | Job proofread (chỉ đọc) làm chương "bận" khi ingest lại / áp ngược chữ bỏ qua | `notReadOnlyJob` |
| TB | Usage mất khi kết quả sai hợp đồng ở bước complete | Kiểm `job-result` trước khi lấy usage; test |
| TB | 1 trang JSON sai làm fail + tính tiền lại cả chương | Bỏ trang đó, giữ trang khác (429/provider vẫn ném); test |
| TB | Guard token ra 2000 < max_tokens proofread | Guard riêng (3072 + 256) |
| TB | Lỗi nạp/tải model OCR local xảy ra sau detect+inpaint | Nạp engine đầu handler |
| TB | Panel: lỗi thô provider, lỗi Bỏ/tải không hiện, tương phản < 4.5:1, chạy lại/Bỏ khi chỉ xem; form Pipeline đè sửa dở khi refetch | `describeJobError`, thông báo lỗi, bỏ opacity, chặn khi chỉ xem, chỉ đồng bộ khi chưa sửa |
| Thấp | `.part` chung giữa process, CTD ngưỡng thấp sinh bóng rác, nửa khối CTD ở mép tile, tooltip không focus được, `step` chặt hơn server, focus mất sau Nhận/Bỏ, nhãn trang khi trang mất | Đã sửa hết |

Không sửa (ghi lại): pin model ModelScope theo tag `v3.10.0` (sha256 vẫn bảo vệ); migration 0014 đổi CHECK trên `jobs`
khoá bảng ngắn (như các migration trước); giá fallback model lạ giờ cao hơn ~6× (đã ghi vào checklist deploy).

## Quyết định tự chốt

1. **Model**: dùng bản ONNX cộng đồng sẵn có thay vì convert / kéo torch: lama-manga (`mayocream/lama-manga-onnx`),
   manga-ocr (`mayocream/manga-ocr-onnx`), PaddleOCR (ONNX của RapidOCR). Không thêm dependency Python. Không cần
   script convert trong `worker/scripts/` (không có checkpoint torch phải chuyển).
2. **PaddleOCR**: tự port tiền/hậu xử lý (DB + unclip chữ nhật + CTC) thay vì thêm package `rapidocr` (kéo
   pyclipper/shapely/omegaconf…). Rec đa ngữ PP-OCRv6 small cho zh/ja/en, PP-OCRv5 korean cho ko. Chữ dọc `rtl` tách
   cột theo hình chiếu mực (det PP-OCR gom nhầm thành hàng ngang).
3. **MangaOCR** giải mã greedy (gốc dùng beam 4) — nhanh hơn, kết quả gần như trùng trên crop bóng thoại.
4. **Model mới là `optional`**: worker cũ/không dùng không phải tải ~700MB; tải lazy khi job cần, `fetch_models.py`
   mặc định vẫn tải đủ (khuyến nghị nạp sẵn vào volume Modal).
5. **Detector CTD**: khối chữ từ CTD, bóng thoại vẫn từ RT-DETR (typeset cần bóng); ngưỡng cài đặt chỉ áp cho khối CTD.
6. **`inpaint_size`**: model LaMa ONNX cố định 512 → hiểu là cạnh tối đa cửa sổ gom (mặc định 512 = cũ), dải 256–1024.
   `mask_dilation` `null` = tự động 2–6px như cũ, dải 0–24.
7. **OCR local không nhận SFX** (`is_sfx` false) — ghi giới hạn ở README / docs.
8. **Kill-switch**: `page.prepare` OCR local được claim cả khi breaker LLM bật / vượt ngân sách (SQL theo payload);
   dispatcher Modal vẫn dừng hẳn khi vượt ngân sách (GPU là tiền thật) — chỉ bỏ chặn khi breaker.
9. **input_rev**: chỉ trộn hash tuỳ chọn pipeline khi khác mặc định → page/job cũ không bị coi là lỗi thời.
10. **AI hiệu đính**: mỗi trang 1 call; ảnh gốc thu rộng 640, cắt khúc ≤ 1280px, tối đa 6; ngữ cảnh 8 dòng cuối trang
    trước. Gợi ý lưu bảng riêng, lượt mới thay toàn bộ gợi ý cũ của chương. Trạng thái Chờ / Đã nhận / Lỗi thời suy từ
    bản dịch hiện tại (không lưu "accepted") → hoàn tác tự đưa gợi ý về Chờ duyệt. "Nhận tất cả" giới hạn **trang đang
    mở** (editor chỉ sửa 1 trang mỗi lúc; nhận cả chương cần đổi trang liên tục). Panel rộng 560px như Bản dịch / Tìm.
    Chạy lại / Bỏ chỉ chặn ở client khi chỉ xem (route chỉ cần là thành viên).
11. **Premium**: `gemini-2.5-pro` (thinking budget 128 — không tắt được) / `claude-sonnet-5-5`; giá niêm yết thêm vào
    bảng giá API + worker.
12. **Tab "Pipeline"** qua `?tab=pipeline` ở `/w/$ws/settings` (tab Font giữ mặc định).

## Checklist deploy

Chi tiết: `docs/deployment-guide.md` mục 4 "Checklist release pipeline-settings-local-ocr-proofread".

1. Worker trước: `uv sync && uv run python scripts/fetch_models.py` (thêm ~710MB model optional, sha256 theo lock) →
   worker Mac 0.6.0 → `modal volume put mtl-models models/ /` + `modal deploy modal_app.py`.
2. (Tuỳ chọn) `MTL_GEMINI_PREMIUM_MODEL` / `MTL_ANTHROPIC_PREMIUM_MODEL`; kiểm lại giá Premium.
3. `.env` API không ghi đè `MIN_PIPELINE_VERSION` < 0.6.0 (`PIPELINE_VERSION` giữ 0.4.0).
4. Deploy API: `pnpm db:migrate` chạy `0013_workspace_pipeline_settings` + `0014_proofread_suggestions` (down tay có sẵn).
5. Smoke tay: lưu Pipeline; chương JA với MangaOCR không ghi `llm_tokens_*` cho `page.prepare`; Hiệu đính + Nhận 1 gợi ý.
6. Rollback API được nếu worker giữ 0.6.0.

## Câu hỏi còn mở

1. Có cần chặn ở **server** việc chạy lại hiệu đính / Bỏ gợi ý khi người gọi không giữ khoá chương (hiện chỉ chặn ở
   client; lượt mới thay toàn bộ gợi ý + lượt Bỏ)?
2. Nhận gợi ý có nên tự đánh dấu đã xử lý phía server (hiện "Đã nhận" vẫn nằm trong danh sách tới lượt sau)?
3. OCR local trên **Modal** khi vượt ngân sách: có muốn cho dispatcher chạy riêng job OCR local (GPU vẫn tốn tiền)?
4. Sonnet 5.5 có nhận `thinking: disabled` + `effort: low` như Haiku không — cần 1 call thật để xác nhận; token
   thinking thật của Gemini 2.5 Pro trên trang dày (guard 3328) chưa đo.
5. Token worker tạo với danh sách capability tường minh (không có `chapter.proofread`) sẽ bị 400
   `capability_not_allowed` khi worker 0.6.0 khai capability mới — production có token như vậy không? (cần
   `--capabilities` hoặc cấp lại token).
6. Đo thật còn thiếu: CER trên golden set KO/JA, chất lượng + chi phí AI hiệu đính với LLM thật, LaMa manga trên nền
   screentone thật, thời gian/trang trên Modal GPU.
