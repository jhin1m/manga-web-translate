# Code review — Phase 2 (màu chữ gốc) + Phase 6 (font tuỳ chỉnh workspace)

Ngày: 2026-10-23 · Nhánh `feat/small-features-batch` (chưa commit) · Reviewer phạm vi worker/fonts.

## Phạm vi
- Worker: `mtl_pipeline/{textcolor,textmask,typeset,schema,pipeline,fonts,render}.py`, `mtl_worker/{runner,job_fonts,__init__}.py`, test `test_textcolor.py`, `test_job_fonts.py`, `test_font_coverage.py`.
- Shared: `page-state.ts`, `worker-protocol.ts` (`JobFonts`), `storage-keys.ts`, `vietnamese-chars.ts`, JSON schema emit.
- API: migration 0012 + down, `lib/{fonts,font-metrics}.ts`, `routes/fonts.ts`, `routes/series.ts` (default_fonts), `jobs/claim-inputs.ts`, `env.ts`, `storage.ts`.
- Web: `editor/{actions,fonts}.ts`, `panels/Properties.tsx`, `use-chapter-session.ts`, `features/fonts/*`, `routes/workspace-settings.tsx`, series form/sidebar.
- Docs: `typeset-layout-contract.md`, `job-queue-worker.md`, `deployment-guide.md`.

## Kiểm chứng đã chạy
- `cd worker && uv run pytest`: 184 passed; `ruff check`: sạch.
- `pnpm typecheck`: sạch (4 package). `pnpm lint` (biome): sạch.
- `pnpm --filter @mtl/shared test`: 28 passed (gồm test drift JSON schema ↔ zod). `pnpm --filter @mtl/web test`: 190 passed.
- Không chạy test API / e2e (theo yêu cầu).
- Kiểm thực nghiệm: validate input translate mới bằng schema của HEAD (0.4.2) → `Additional properties are not allowed ('outline_color', 'text_color')`; `font_path('/System/Library/Fonts/Supplemental/Arial')` → trả file hệ thống; ngưỡng snap: `#202020` (ΔE 12.2) không về đen.

## Đánh giá chung
Hai phase làm gọn, đúng hướng plan, test có ý nghĩa (ảnh tổng hợp, parity metrics fontkit ↔ manifest cả hai nhánh `OS/2.typo` và `hhea`, registry khôi phục sau job, cache theo file). Không thấy lỗi chặn ship. Các điểm chính: lý do version trong docs Phase 2 sai (worker cũ thực tế KHÔNG đọc được input có màu → rollback worker là cửa một chiều), worker coi 4xx khi tải font như lỗi mạng (trái yêu cầu "không lỗi job"), và một số điểm cứng hoá phòng thủ.

**Điểm: 8/10.**

## Critical
Không có.

## High
Không có.

## Medium

### M1. Docs nói Phase 2 không cần tăng MIN vì "trường optional" — sai; worker < 0.5.0 không đọc nổi input có màu
- `docs/job-queue-worker.md:131-134`: "Trường optional nên `MIN_PIPELINE_VERSION` giữ nguyên 0.4.2: worker cũ chỉ không có màu". Plan cũng ghi như vậy.
- Thực tế: `ocr_result.regions[]` trong `inputs-chapter-translate` và `partial.regions[]` trong `inputs-page-prepare` có `additionalProperties: false`. Đã kiểm thử: schema HEAD (0.4.2) từ chối region có `text_color`/`outline_color`.
- Nếu xảy ra: (a) có người ship riêng 0.5.0 mà giữ MIN 0.4.2, worker 0.4.2 còn chạy sẽ nhận translate của trang đã prepare bằng 0.5.x → `ContractError` → `JobFailure("internal")`, tốn attempt cho tới khi job `failed`. (b) Rollback worker xuống < 0.5.0 sau khi đã có trang prepare bằng 0.5.x: mọi lần dịch/thử lại prepare (partial) của các trang đó đều hỏng, kể cả khi hạ MIN. Hiện MIN 0.5.1 che được (a) nhưng (b) là cửa một chiều mà `deployment-guide.md:79-84` không nhắc.
- Cách sửa: sửa đoạn docs (lý do đúng: phải ≥ 0.5.0 vì schema strict), thêm vào deployment guide "không rollback worker < 0.5.0 sau khi đã prepare bằng 0.5.x". Comment `mtl_worker/__init__.py:7` cũng nên nêu điều này.

### M2. Font bị xoá/hết hạn giữa lúc claim và lúc tải → cả job lỗi thay vì fallback
- `worker/mtl_worker/job_fonts.py:44` `data = download(f["url"])` → `client.download` gọi `raise_for_status()` (`client.py:188`). 403/404 bị coi như lỗi mạng, ném ra, `run_job` biến thành `JobFailure("internal")`.
- Tình huống: export đã claim (inputs có URL font) → admin xoá font (API xoá row + object, `routes/fonts.ts` DELETE) → worker tải 404 → job export lỗi, mất 1 attempt; lần claim sau API bỏ font (row đã xoá) nên mới chạy được. Trường hợp row còn mà object mất (dọn tay, xem L1) → job lỗi lặp lại tới hết attempt. Yêu cầu Phase 6 là "box dùng font bị xoá → render fallback (không lỗi job)".
- Cách sửa: bắt `httpx.HTTPStatusError` có status 4xx → log + bỏ font (fallback như sai hash); chỉ để lỗi kết nối/5xx ném lên để thử lại.

## Low

### L1. Object font đã kiểm vẫn ghi đè được bằng presigned POST còn hạn
- `routes/fonts.ts:69` ký POST cho key cố định (TTL 10'); `routes/fonts.ts:115` giữ chính key đó làm `file_key`. Sau commit, ai giữ form POST vẫn ghi được byte tuỳ ý (≤10MB, content-type cố định) đè lên font đã kiểm cho tới khi POST hết hạn. Gửi lại commit trên key đó (sha mới) còn tạo được row thứ 2 dùng chung object → xoá 1 font làm hỏng font kia (dẫn tới M2).
- Tác động hẹp: chỉ admin của chính workspace, trong 10'; worker có kiểm sha256 nên an toàn (fallback), nhưng editor sẽ nạp file khác → lệch parity. Cùng pattern "validate in place" với upload chương (đã có sẵn).
- Cách sửa: sau khi kiểm, `copyObject` sang key cuối (VD `ws/<ws>/fonts/<font_id>`) rồi xoá key upload; hoặc chặn commit khi đã có row cùng `file_key`.

### L2. Parse font không tin cậy bằng fontkit chạy đồng bộ trên event loop của API
- `routes/fonts.ts:106` `readFontInfo(bytes)` (đồng bộ, tối đa 10MB). Ngoại lệ đã được bắt (400 `corrupt_font`); `RangeError` do đệ quy sâu cũng bắt được. Còn lại là rủi ro CPU: một font dị dạng làm parser chạy lâu sẽ chặn mọi request của tiến trình API. Chỉ admin workspace gọi được, và workspace do nền tảng cấp (`auth.ts:73` `allowUserToCreateOrganization: false`), nên khả năng khai thác thấp. Không giới hạn tần suất commit (font bị từ chối không tính vào trần 20).
- Cách sửa (khi cần): chạy `readFontInfo` trong `worker_threads` có timeout, hoặc rate-limit route commit.

### L3. `font_family` tuỳ ý → worker nạp được file .ttf/.otf bất kỳ trên máy worker (đã có từ trước)
- `worker/mtl_pipeline/fonts.py:89` `FONTS_DIR / f"{font_id}{ext}"`: id tuyệt đối (`/System/Library/Fonts/Supplemental/Arial`) hoặc có `../` thoát khỏi `FONTS_DIR` (đã kiểm thử). `TextBox.font_family` là chuỗi tự do từ editor → export vẽ bằng font hệ thống của worker. Không lộ dữ liệu đáng kể, nhưng diff đang sửa đúng hàm này.
- Cách sửa: chỉ nhận id có trong manifest (`load_manifest()["fonts"]`) hoặc `font_id` không chứa `/`, `\`, `..`.
- Tương tự (phòng thủ thêm): `JobFonts.id` chỉ là `z.string().min(1)` (`worker-protocol.ts:109`). API chỉ gửi `custom-*`, nhưng worker đăng ký mọi id nhận được trước `FONTS_DIR`, nên một id trùng tên font gói sẵn sẽ thay font đó trong job. Nên thêm regex `^custom-[0-9a-f]{8}$` vào zod.

### L4. Docs quy trình thêm font gói sẵn đã lỗi thời
- `docs/typeset-layout-contract.md:84`: "→ thêm id vào `FONT_IDS` (API + web)". `FONT_IDS` đã bỏ; API lấy từ manifest (`lib/fonts.ts:18`), web đọc `/fonts/manifest.json`. Nên xoá bước này.

### L5. Ngưỡng snap đen/trắng hẹp → chữ đen trên bản scan/JPEG có thể ra xám đậm
- `textcolor.py:18` `SNAP_DELTA_E = 12`: `#1a1a1a` về đen, nhưng `#202020`, `#2a2a2a` thì giữ nguyên. Median nét chữ đen của trang scan/JPEG hay rơi vào khoảng 0x20–0x30, nên box dịch có thể là xám đậm thay vì `#000000` như trước (vẫn đọc được vì qua kiểm tương phản). Tiêu chí "soi mắt ≥ 3 trang thật" chưa tick nên chưa đo được tần suất.
- Gợi ý: snap theo chroma thấp + L* < ~25 (hoặc nâng ngưỡng ΔE tới đen lên ~20) sau khi soi trang thật.

### L6. Lặt vặt
- `claim-inputs.ts:273`: export gửi cả font mặc định của series dù export chỉ vẽ box có sẵn. Worker tải thêm file thừa nhưng không sai.
- `routes/fonts.ts:99`: kiểm trần 20 font không nằm trong transaction → 2 commit song song lúc đang 19 font ra 21. Chấp nhận được.
- `apps/web/src/features/editor/fonts.ts:144`: nếu `fetchCustom` lỗi, `loadedCustom` (module-global) còn giữ font của workspace mở trước → panel "Font của nhóm" có thể hiện font của workspace khác. Chọn font đó thì box `custom-*` không thuộc workspace hiện tại, export rơi về font mặc định. Hiếm gặp; nên xoá `loadedCustom` khi đổi workspace.
- `fonts.py:102` `_warned` lớn dần theo số id lạ trong một tiến trình (id do người dùng điều khiển). Không đáng kể.
- `page-state.ts:37-39`: thêm `text_color`/`outline_color` vào `Region` của PageState chỉ để `OcrRegion` (omit) kế thừa; `build_page_state` (`handlers.py:~170`) không ghi hai trường này vào `ai_state`. Không sai, nhưng hợp đồng PageState có trường mà không ai ghi.

## Đối chiếu câu hỏi cụ thể

**(a) Tiêu chí chấp nhận**
- P2: 6 test plan đều có (đỏ/trắng, trắng viền đen trên art, vàng nhạt → đen, gần đen → snap, không màu → cực tính, zod optional/sai định dạng). "Soi mắt ≥3 trang thật" chưa làm (report đã nêu).
- P6: magic bytes, 10MB, 20 font, trùng sha256, member 403, xoá đang dùng 409, tenant isolation (4 route), parity metrics, fallback font đã xoá, e2e upload → mặc định series → editor: có (theo test/report; không chạy API/e2e). Phần còn lệch yêu cầu là M2 (fallback chưa trọn).

**(b) Hồi quy**
- Trang cũ không có `text_color`: `typeset_region` chỉ tính `bg` khi có màu; `style_for` trả đúng quy tắc cực tính cũ (`test_region_without_colors_matches_polarity_rule` + test typeset cũ không đổi). OK.
- Font gói sẵn: `font_path` → `_registered` (rỗng ngoài job) → `_bundled_path` như cũ. Editor: `metricsOf` ưu tiên custom rồi manifest như cũ; `canvasFont` thêm family dự phòng là `manifest.defaults[0]` (= `DEFAULT_FONT` worker `Bangers-Regular`) → font thiếu đo/vẽ cùng font fallback hai phía. OK.
- Export trang cũ: box gói sẵn không đổi đường đi. Một thay đổi hành vi có chủ ý: id lạ trước đây ném `FileNotFoundError` (job lỗi), giờ fallback + log.
- Cache `load_font`: chuyển sang `_load(path, size)` khoá theo đường dẫn; `_metrics_of(path)` cũng vậy; file cache tên = sha256 (nội dung bất biến) → không giữ nhầm font giữa các job. Không còn cache nào khác khoá theo font id (`line_advance` không cache). `test_render_with_registered_font_matches_bundled_original` kiểm đúng chuyện này. OK.

**(c) Thay đổi hợp đồng**
- `inputs.fonts` optional ở translate/export; schema `additionalProperties: false` → worker < 0.5.1 không đọc được → MIN 0.5.1 là đúng; thứ tự deploy worker trước, API sau (docs đúng). Prepare/partial cũng đổi hợp đồng thực tế (M1).
- API `PIPELINE_VERSION` (muối input_rev) giữ 0.4.0 → không chạy lại job đã xong. Hệ quả: trang đã prepare trước đó không có màu cho tới khi chạy lại Bước 1 thủ công. Plan ghi "input_rev đổi theo version", implementation giữ nguyên muối (report có nêu). Nên chốt với user.
- Trong khoảng worker 0.5.1 + API cũ: zod API mặc định strip trường lạ → màu bị bỏ âm thầm, không lỗi.
- `contrastStroke` (editor, `actions.ts:195-201`): đổi từ "`#ffffff` → viền đen, còn lại trắng" sang luma Rec.601 > 128. Hiện chỉ có 2 chỗ gọi (`actions.ts:222` với `#000000`, `actions.ts:248` với `#000000`/`#ffffff`) → **người dùng hiện không thấy khác gì**. Box đã lưu giữ nguyên `stroke` (không tính lại). Khác biệt chỉ lộ ra nếu sau này truyền màu khác: đỏ `#ff0000` → trắng (như cũ), vàng/sáng → đen (cũ là trắng), `#fff` dạng ngắn → đen (cũ là trắng, vốn là bug). Đây là thay đổi hợp đồng có chủ ý, ngược với câu "giữ ngưỡng editor" trong plan; đã ghi trong contract doc và có test parity giá trị. Chấp nhận được.

**(d) Theo pattern có sẵn**: route dùng `requireWorkspace(role)`, `sdb` scoped, `parseJson`, `HTTPException` JSON, presignPost/head như upload chương, migration + down viết tay, emit JSON schema + test drift. OK.

**(e) Bảo mật**
- Magic bytes: `sniffFont` chỉ nhận `00010000`/`true`/`OTTO` (loại WOFF/WOFF2/TTC/HTML). Kích thước: policy POST `content-length-range` + `head` + kiểm lại sau `readObject`. OK.
- fontkit trong API: L2.
- Phạm vi key: commit yêu cầu `ws/<ws>/fonts/` + `keyBelongsToWorkspace` (chặn `..`); `fontView` không trả `file_key`; `resolveCustomFonts` dùng `scoped(tx, ws)` nên font workspace khác bị loại (có test). OK. Ghi đè sau commit: L1.
- TTL presigned: danh sách 10', translate 10', export 15' (trần `MAX_GET_TTL_S`). Editor nạp `FontFace` một lần, lỗi thì lấy URL mới 1 lần. CORS MinIO đã có cho origin app. OK.
- Phân quyền: GET cho member; upload-url/commit/delete cần admin (`ROLES` có thứ bậc, owner ⊇ admin). `default_fonts` của series cho member sửa (như cũ) nhưng bắt buộc là font gói sẵn hoặc font của chính workspace. OK.
- Worker: chỉ tải URL trong `inputs.fonts`; sha256 kiểm theo pattern schema `^[0-9a-f]{64}$` **trước** khi `job_fonts` chạy (`runner.py:259` trước `:262`) → dùng làm tên file không có path traversal. Ghi nguyên tử (`mkstemp` + `os.replace`). Sai hash/hỏng → bỏ. OK (trừ M2, L3).
- Registry: `_registered` toàn cục, đổi bằng cách gán dict mới và khôi phục trong `finally`. Worker chạy tuần tự từng job (`main.py:227`); thread heartbeat không đụng font; `prepare_dir` (CLI, có ThreadPool) không dùng registry. Không rò giữa các job (có test). OK.
- Parity metrics editor ↔ worker: cùng quy tắc, test parity 9 font cả 2 nhánh metrics; field `useTypoMetrics` của fontkit 2.0.4 là bit 7 (đã kiểm source). Advance: canvas ↔ raqm như hợp đồng cũ. Lệch còn lại: font tuỳ chỉnh thiếu dấu → trình duyệt lấy glyph từ font dự phòng, worker vẽ tofu bằng font tuỳ chỉnh (UI đã cảnh báo "Thiếu dấu"). Nhỏ.

## Edge case từ scout
- bbox vùng chữ sát mép trang: crop `img_rgb[b.y:b.y2, b.x:b.x2]` và `local` bị cắt cùng biên → cùng shape. OK.
- Patch rỗng ở `assign_colors`: có guard `patch.size == 0`. `typeset_region` không có guard nhưng rect lấy từ bbox/lòng bóng hợp lệ → không gặp trong thực tế.
- Retry prepare dùng partial: `region_to_shared` mang màu, `region_from_shared` đọc lại → không mất màu.

## Hành động đề xuất (theo thứ tự)
1. M2: worker bỏ qua font khi tải bị 4xx (fallback), chỉ ném lỗi kết nối/5xx.
2. M1: sửa `job-queue-worker.md:131-134` + deployment guide (không rollback worker < 0.5.0 sau khi đã prepare bằng 0.5.x).
3. L3: giới hạn `font_id` trong manifest/không chứa ký tự đường dẫn; regex `custom-` cho `JobFonts.id`.
4. L1: copy sang key cuối sau khi kiểm (hoặc chặn `file_key` trùng).
5. L4: xoá bước `FONT_IDS` trong contract doc.
6. L5: soi trang thật rồi chỉnh ngưỡng snap.

## Theo dõi plan
- P2: phần code + test xong; còn "soi mắt ≥3 trang thật". P6: 6a + 6b xong; còn soi parity Konva ↔ render.py thủ công. Đề xuất giữ hai tiêu chí thủ công ở trạng thái mở. Reviewer không sửa plan.

## Câu hỏi còn mở
- Có muốn tăng muối `PIPELINE_VERSION` của API để "Bước 1" của các trang cũ chạy lại được (lấy màu), hay chấp nhận trang cũ mãi theo cực tính cho tới khi người dùng tự chạy lại?
- Font sai hash: giữ fallback âm thầm (hiện tại) hay báo lỗi cho người dùng?
