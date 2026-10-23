# Báo cáo triển khai: sắp xếp tay thứ tự ảnh trước Bước 1

## Đã làm
- API `PUT /w/:ws/chapters/:chapterId/source-files/order` `{ ids }` (`apps/api/src/routes/chapters.ts`): tx + `lockChapter` + `assertSourcesEditable` (cùng mẫu PATCH skip). `ids` phải đúng bộ source file của chương, lệch (thiếu/thừa/trùng/ảnh chương khác/rỗng) → 400 `source_set_mismatch`; id không phải uuid → 400 (zod). Ghi `ord = index`, chỉ UPDATE các hàng đổi chỗ. Trả `{ source_files }`.
- Web:
  - `setSourceOrder` (`api.ts`).
  - `moveItem` thuần (`source-rail-model.ts`).
  - `useReorderSources` (`use-source-images.ts`): lạc quan trên cả cache danh sách ảnh lẫn chi tiết chương, lỗi → trả thứ tự cũ (chỉ khi chưa có lần đổi mới hơn) + toast lỗi.
  - `source-rail.tsx`: kéo-thả HTML5 gốc trên `.cw-thumb-item` (vạch thả trước/sau theo nửa trên/dưới), menu "Đưa lên đầu / Lên 1 / Xuống 1 / Đưa xuống cuối" (vô hiệu ở đầu/cuối), Alt+↑/↓ trên thumbnail, focus trả lại ảnh vừa dời. Tắt hết khi không `editable`.
  - `chapter-workspace.tsx`: `moveSource` + toast "Đã đổi thứ tự." với "Hoàn tác" (theo mẫu toast xoá ảnh, key `reorder`).
  - CSS: vạch thả + ảnh đang kéo mờ.
- Docs: `docs/editor.md` (đoạn mới sau phần xoá ảnh), README (tách mục sắp xếp tay khỏi "thumbnail do server sinh"), phase file (status completed, tick tiêu chí đã kiểm).

## Test
- API (`chapters.test.ts`, 3 case mới): ok + ảnh skip giữ chỗ + job ingest nhận `sources` đúng thứ tự mới; 400 các kiểu tập sai và thứ tự không đổi; 423 khi người khác giữ khoá, 409 `chapter_not_draft` sau Bước 1 (cùng mã với PATCH skip). `tenant-isolation.test.ts`: thêm body + resource case cho route mới (403 chéo workspace, 404 chéo tài nguyên, đối chứng own không 403/404).
- Unit: `moveItem` (tiến/lùi/đầu/cuối, kẹp, no-op trả đúng mảng cũ, không mutate).
- E2E `apps/web/e2e/upload-chapter.spec.ts` (test luồng 10 trang): menu "Xuống 1" → thứ tự đổi → reload vẫn giữ → Alt+↑ đưa về, focus theo ảnh; kéo-thả bằng `dragTo` + Hoàn tác. E2E chạy được ở máy này (Playwright tự dựng API + Vite, dùng postgres/minio dev): 4/4 pass.
- Xanh: `pnpm --filter @mtl/api test` (186), `pnpm --filter @mtl/web test`, `pnpm typecheck`, `pnpm lint`.

## Lưu ý / lệch so với plan
- "Item chưa có id server": rail chỉ dựng từ danh sách source file của server (chương tạo xong mới hiện ảnh), nên mọi item đều có id; không cần guard riêng. Ảnh đang tải lên vẫn đổi chỗ được (chỉ đổi `ord`).
- Nhiều lần đổi liên tiếp rất nhanh: TanStack chỉ gọi callback `mutate` của lần cuối, nên toast Hoàn tác thuộc lần cuối (trả về thứ tự ngay trước lần cuối). Cache lạc quan vẫn đúng.
- Không sửa `plan.md` (ngoài phạm vi); bảng trạng thái ở đó còn "Pending".

## Chưa kiểm
- Kéo-thả trên Safari và độ mượt thủ công (chỉ Chrome qua Playwright); cảm ứng không hỗ trợ kéo (đã ghi docs, dùng menu).
- Bước 1 ghép bằng ảnh đánh số với worker thật (chỉ kiểm thứ tự input của job ingest ở test API).

## Câu hỏi còn mở
- Không.
