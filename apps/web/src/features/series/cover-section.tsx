/**
 * Cài đặt series — "Ảnh bìa": xem trước bìa đang dùng, tải ảnh bìa riêng (png/jpg/webp), hoặc quay về ảnh tự động
 * (ảnh đầu của chương). Gọi API ngay, không đi qua nút Lưu của form; xong thì làm mới danh sách + chi tiết series.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { errorMessage } from "../../lib/api.ts";
import { CoverImage, initialOf } from "../home/cover-image.tsx";
import { fetchSeriesList, resetSeriesCover, type Series, seriesKeys, uploadSeriesCover } from "./api.ts";

const COVER_ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_COVER_BYTES = 10 * 1024 * 1024;

/** Lỗi trước khi gửi (định dạng / dung lượng); server vẫn kiểm lại bằng nội dung ảnh. */
const coverFileError = (file: File) =>
  !COVER_ACCEPT.split(",").includes(file.type)
    ? "Chỉ nhận ảnh PNG, JPG hoặc WebP."
    : file.size > MAX_COVER_BYTES
      ? "Ảnh bìa tối đa 10 MB."
      : null;

export function CoverSection({ series }: { series: Pick<Series, "id" | "title" | "cover_custom"> }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const list = useQuery({ queryKey: seriesKeys.list(), queryFn: () => fetchSeriesList() });
  const src = list.data?.series.find((s) => s.id === series.id)?.cover_src ?? null;
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: seriesKeys.list() }),
      qc.invalidateQueries({ queryKey: seriesKeys.detail(series.id) }),
    ]);
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const bad = coverFileError(file);
      return bad ? Promise.reject(new Error(bad)) : uploadSeriesCover(series.id, file);
    },
    onSuccess: refresh,
  });
  const reset = useMutation({ mutationFn: () => resetSeriesCover(series.id), onSuccess: refresh });
  const busy = upload.isPending || reset.isPending;
  const error = upload.error ?? reset.error;

  return (
    <fieldset className="cover-section" aria-label="Ảnh bìa">
      <div className="cover-section-preview">
        <CoverImage src={src} fallback={initialOf(series.title)} />
      </div>
      <div className="cover-section-body">
        <span className="small muted">
          {series.cover_custom ? "Đang dùng ảnh bìa riêng." : "Đang dùng ảnh đầu của chương (tự động)."}
        </span>
        <div className="cover-section-actions">
          <button type="button" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? "Đang tải lên…" : "Tải ảnh bìa…"}
          </button>
          {series.cover_custom && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                upload.reset();
                reset.mutate();
              }}
            >
              {reset.isPending ? "Đang đổi…" : "Dùng ảnh tự động"}
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={COVER_ACCEPT}
          aria-label="Chọn ảnh bìa"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) {
              reset.reset();
              upload.mutate(file);
            }
          }}
        />
        {error && (
          <span className="small error" role="alert">
            {errorMessage(error)}
          </span>
        )}
      </div>
    </fieldset>
  );
}
