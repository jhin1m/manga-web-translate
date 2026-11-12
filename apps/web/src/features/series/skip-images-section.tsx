/**
 * Cài đặt series — "Ảnh tự bỏ": ảnh credit đã học từ "Luôn bỏ ở series này". Chương tạo sau có ảnh giống được bỏ qua
 * sẵn (khôi phục được ở rail). Xoá ảnh khỏi danh sách không đổi chương đã tạo. Mỗi lần xoá gọi API ngay, không đi
 * qua nút Lưu của form. Dải mép đã cắt ("Luôn cắt ở series này") hiện chỉ đúng dải đó.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoTip } from "../../app/info-tip.tsx";
import { errorMessage } from "../../lib/api.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import { deleteSkipImage, fetchSkipImages, seriesKeys } from "./api.ts";

const bandLabel = (edge: "top" | "bottom") => (edge === "top" ? "Dải đầu ảnh" : "Dải cuối ảnh");

export function SkipImagesSection({ seriesId }: { seriesId: string }) {
  const qc = useQueryClient();
  const key = seriesKeys.skipImages(seriesId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchSkipImages(seriesId), staleTime: 10 * 60_000 });
  const del = useMutation({
    mutationFn: (id: string) => deleteSkipImage(seriesId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const images = q.data?.images ?? [];
  return (
    <fieldset aria-label="Ảnh tự bỏ" className="skip-images">
      <div className="field-head">
        <span className="small muted">Xoá ảnh ở đây có hiệu lực ngay, không cần bấm Lưu.</span>
        <InfoTip label="Giải thích Ảnh tự bỏ">
          Ảnh credit đã chọn "Luôn bỏ ở series này". Chương upload sau có ảnh giống sẽ được bỏ qua sẵn.
        </InfoTip>
      </div>
      {q.error && <p className="small error">{errorMessage(q.error)}</p>}
      {q.data && images.length === 0 && <p className="small muted">Chưa có ảnh nào.</p>}
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
                <img src={img.url} alt={`Ảnh tự bỏ ${i + 1}`} loading="lazy" decoding="async" />
              )}
              <button
                type="button"
                className="icon-btn"
                data-danger
                aria-label={img.edge ? `Xoá ${bandLabel(img.edge).toLowerCase()} ${i + 1}` : `Xoá ảnh tự bỏ ${i + 1}`}
                title="Xoá khỏi danh sách"
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
