/**
 * Cài đặt series — "Ảnh tự bỏ": ảnh credit đã học từ "Luôn bỏ ở series này". Chương tạo sau có ảnh giống được bỏ qua
 * sẵn (khôi phục được ở rail). Xoá ảnh khỏi danh sách không đổi chương đã tạo. Mỗi lần xoá gọi API ngay. Dải mép đã
 * cắt ("Luôn cắt ở series này") hiện chỉ đúng dải đó. Nhãn + ⓘ do hàng chứa nó (modal Cài đặt dịch) vẽ.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import { deleteSkipImage, fetchSkipImages, seriesKeys } from "./api.ts";

type Edge = "top" | "bottom";
const bandLabel = (edge: Edge) =>
  edge === "top" ? t("series.skipImagesSection.bandTop") : t("series.skipImagesSection.bandBottom");
const deleteLabel = (edge: Edge | null, n: number) =>
  edge === "top"
    ? t("series.skipImagesSection.deleteBandTop", { n })
    : edge === "bottom"
      ? t("series.skipImagesSection.deleteBandBottom", { n })
      : t("series.skipImagesSection.deleteImage", { n });

export function SkipImagesSection({ seriesId }: { seriesId: string }) {
  useT();
  const qc = useQueryClient();
  const key = seriesKeys.skipImages(seriesId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchSkipImages(seriesId), staleTime: 10 * 60_000 });
  const del = useMutation({
    mutationFn: (id: string) => deleteSkipImage(seriesId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const images = q.data?.images ?? [];
  return (
    <fieldset aria-label={t("series.skipImagesSection.label")} className="skip-images">
      {q.error && <p className="small error">{errorMessage(q.error)}</p>}
      {q.data && images.length === 0 && <p className="small muted">{t("series.skipImagesSection.empty")}</p>}
      {images.length > 0 && (
        <ul className="skip-images-grid">
          {images.map((img, i) => (
            <li key={img.id} data-band={img.edge ? "" : undefined}>
              {img.edge ? (
                <>
                  <div
                    className="skip-band"
                    data-edge={img.edge}
                    style={{ aspectRatio: `${img.width} / ${img.height}` }}
                  >
                    <img src={img.url} alt={bandLabel(img.edge)} loading="lazy" decoding="async" />
                  </div>
                  <span className="skip-band-label small">{bandLabel(img.edge)}</span>
                </>
              ) : (
                <img
                  src={img.url}
                  alt={t("series.skipImagesSection.alt", { n: i + 1 })}
                  loading="lazy"
                  decoding="async"
                />
              )}
              <button
                type="button"
                className="icon-btn"
                data-danger
                aria-label={deleteLabel(img.edge, i + 1)}
                title={t("series.skipImagesSection.removeTitle")}
                disabled={del.isPending}
                onClick={() => del.mutate(img.id)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      {del.error && <p className="small error">{errorMessage(del.error)}</p>}
    </fieldset>
  );
}
