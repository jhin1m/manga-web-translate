/**
 * Cài đặt chung → tab Font: upload TTF/OTF, danh sách font của bạn kèm cảnh báo thiếu dấu tiếng Việt (vẫn dùng
 * được), xoá (bị chặn khi series còn dùng làm font mặc định).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import {
  deleteFont,
  FONT_ACCEPT,
  fontKeys,
  MAX_USER_FONTS,
  type UserFont,
  uploadCheckedFont,
  useUserFonts,
} from "./api.ts";

const MISSING_SHOWN = 12;

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Lỗi xoá: font đang là mặc định của series nào thì nêu tên các series đó. */
function deleteError(e: unknown): string {
  if (e instanceof ApiError && e.body.error === "in_use" && Array.isArray(e.body.series)) {
    return `Font đang là mặc định của series: ${e.body.series.join(", ")}. Đổi font mặc định của series trước.`;
  }
  return errorMessage(e);
}

export function FontSettings() {
  const qc = useQueryClient();
  const q = useUserFonts();
  const refresh = () => qc.invalidateQueries({ queryKey: fontKeys.list() });
  const fonts = q.data ?? [];

  const upload = useMutation({
    mutationFn: (file: File) => uploadCheckedFont(file, fonts.length),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (id: string) => deleteFont(id), onSuccess: refresh });

  return (
    <section className="section" aria-label="Font của bạn">
      <h2>Font của bạn</h2>
      <p className="muted small">
        Font TTF/OTF (tối đa 10MB, {MAX_USER_FONTS} font) dùng được trong editor và làm font mặc định của series. Bạn tự
        chịu trách nhiệm về bản quyền font.
      </p>
      <p>
        <input
          id="font-file"
          type="file"
          accept={FONT_ACCEPT}
          aria-label="Chọn file font"
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
        {upload.isPending && <span className="muted small"> Đang tải lên…</span>}
      </p>
      {upload.error && (
        <p className="error" role="alert">
          {errorMessage(upload.error)}
        </p>
      )}
      {upload.isSuccess && !upload.isPending && (
        <p className="notice info" role="status">
          Đã thêm font {upload.data.name}.
        </p>
      )}
      {q.error && <p className="error">{errorMessage(q.error)}</p>}
      {q.data && fonts.length === 0 && <p className="muted">Bạn chưa có font riêng.</p>}
      {fonts.length > 0 && (
        <table className="data" aria-label="Danh sách font">
          <thead>
            <tr>
              <th>Tên font</th>
              <th>Dung lượng</th>
              <th>Tiếng Việt</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fonts.map((f) => (
              <FontRow key={f.id} font={f} busy={del.isPending} onDelete={() => del.mutate(f.id)} />
            ))}
          </tbody>
        </table>
      )}
      {del.error && (
        <p className="error" role="alert">
          {deleteError(del.error)}
        </p>
      )}
    </section>
  );
}

function FontRow({ font, busy, onDelete }: { font: UserFont; busy: boolean; onDelete(): void }) {
  const shown = font.missing.slice(0, MISSING_SHOWN).join(" ");
  const more = font.missing.length - MISSING_SHOWN;
  return (
    <tr>
      <td>{font.name}</td>
      <td className="muted">{sizeLabel(font.bytes)}</td>
      <td>
        {font.vi_complete ? (
          <span className="muted">Đủ dấu</span>
        ) : (
          <span className="warn-text" title="Font thiếu glyph tiếng Việt: chữ thiếu dấu sẽ hiện sai/rơi về font khác">
            Thiếu dấu: {shown}
            {more > 0 ? ` … (+${more})` : ""}
          </span>
        )}
      </td>
      <td>
        <button
          type="button"
          className="icon-btn"
          data-danger
          aria-label={`Xoá font ${font.name}`}
          title="Xoá font"
          disabled={busy}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      </td>
    </tr>
  );
}
