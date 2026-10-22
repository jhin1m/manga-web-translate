/**
 * Cài đặt series — "Ảnh tự bỏ": ảnh credit đã học từ "Luôn bỏ ở series này". Chương tạo sau có ảnh giống được bỏ qua
 * sẵn (khôi phục được ở rail). Xoá ảnh khỏi danh sách không đổi chương đã tạo.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../lib/api.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import { deleteSkipImage, fetchSkipImages, seriesKeys } from "./api.ts";

export function SkipImagesSection({ ws, seriesId }: { ws: string; seriesId: string }) {
  const qc = useQueryClient();
  const key = seriesKeys.skipImages(ws, seriesId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchSkipImages(ws, seriesId), staleTime: 10 * 60_000 });
  const del = useMutation({
    mutationFn: (id: string) => deleteSkipImage(ws, seriesId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const images = q.data?.images ?? [];
  return (
    <fieldset className="settings-group">
      <legend>Ảnh tự bỏ</legend>
      <span className="hint">
        Ảnh credit đã chọn "Luôn bỏ ở series này". Chương upload sau có ảnh giống sẽ được bỏ qua sẵn.
      </span>
      {q.error && <p className="small error">{errorMessage(q.error)}</p>}
      {q.data && images.length === 0 && <p className="small muted">Chưa có ảnh nào.</p>}
      {images.length > 0 && (
        <ul className="skip-images-grid">
          {images.map((img, i) => (
            <li key={img.id}>
              <img src={img.url} alt={`Ảnh tự bỏ ${i + 1}`} loading="lazy" decoding="async" />
              <button
                type="button"
                className="icon-btn"
                data-danger
                aria-label={`Xoá ảnh tự bỏ ${i + 1}`}
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
