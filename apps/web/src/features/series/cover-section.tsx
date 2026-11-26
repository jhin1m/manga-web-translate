/**
 * Cài đặt series — "Ảnh bìa": xem trước bìa đang dùng, tải ảnh bìa riêng (png/jpg/webp), hoặc quay về ảnh tự động
 * (ảnh đầu của chương). Gọi API ngay, không đi qua nút Lưu của form; xong thì làm mới danh sách + chi tiết series.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { t, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { CoverImage, initialOf } from "../home/cover-image.tsx";
import { fetchSeriesList, resetSeriesCover, type Series, seriesKeys, uploadSeriesCover } from "./api.ts";

const COVER_ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_COVER_BYTES = 10 * 1024 * 1024;

/** Lỗi trước khi gửi (định dạng khi trình duyệt biết kiểu / dung lượng); server vẫn kiểm lại bằng nội dung ảnh. */
const coverFileError = (file: File) =>
  file.type && !COVER_ACCEPT.split(",").includes(file.type)
    ? t("series.coverSection.badType")
    : file.size > MAX_COVER_BYTES
      ? t("series.coverSection.tooLarge")
      : null;

export function CoverSection({ series }: { series: Pick<Series, "id" | "title" | "cover_custom"> }) {
  useT();
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
    <fieldset className="cover-section" aria-label={t("series.coverSection.label")}>
      <div className="cover-section-preview">
        <CoverImage src={src} fallback={initialOf(series.title)} />
      </div>
      <div className="cover-section-body">
        <span className="small muted">
          {series.cover_custom ? t("series.coverSection.usingCustom") : t("series.coverSection.usingAuto")}
        </span>
        <div className="cover-section-actions">
          <button type="button" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? t("series.coverSection.uploading") : t("series.coverSection.upload")}
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
              {reset.isPending ? t("series.coverSection.resetting") : t("series.coverSection.useAuto")}
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={COVER_ACCEPT}
          aria-label={t("series.coverSection.pick")}
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
