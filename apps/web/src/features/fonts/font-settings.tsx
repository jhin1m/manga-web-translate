/**
 * Cài đặt nhóm → tab Font: upload TTF/OTF (owner/admin), danh sách font của nhóm kèm cảnh báo thiếu dấu tiếng Việt
 * (vẫn dùng được), xoá (bị chặn khi series còn dùng làm font mặc định). Thành viên chỉ xem.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import {
  deleteFont,
  fontKeys,
  MAX_FONT_BYTES,
  MAX_WORKSPACE_FONTS,
  uploadFont,
  useWorkspaceFonts,
  type WorkspaceFont,
} from "./api.ts";

const FONT_EXT = /\.(ttf|otf)$/i;
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

/** Lỗi trước khi gửi: đuôi file, dung lượng, số font. */
function precheck(file: File, count: number): string | null {
  if (!FONT_EXT.test(file.name)) return "Chỉ nhận font .ttf hoặc .otf (không nhận WOFF/WOFF2).";
  if (file.size > MAX_FONT_BYTES) return "Font tối đa 10MB.";
  if (count >= MAX_WORKSPACE_FONTS) return `Mỗi nhóm tối đa ${MAX_WORKSPACE_FONTS} font. Xoá bớt font không dùng.`;
  return null;
}

export function FontSettings({ ws, canManage }: { ws: string; canManage: boolean }) {
  const qc = useQueryClient();
  const q = useWorkspaceFonts(ws);
  const refresh = () => qc.invalidateQueries({ queryKey: fontKeys.list(ws) });
  const fonts = q.data ?? [];

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const bad = precheck(file, fonts.length);
      if (bad) throw new Error(bad);
      return uploadFont(ws, file);
    },
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (id: string) => deleteFont(ws, id), onSuccess: refresh });

  return (
    <section className="section" aria-label="Font của nhóm">
      <h2>Font của nhóm</h2>
      <p className="muted small">
        Font TTF/OTF (tối đa 10MB, {MAX_WORKSPACE_FONTS} font) dùng được trong editor và làm font mặc định của series.
        Nhóm tự chịu trách nhiệm về bản quyền font.
      </p>
      {canManage ? (
        <p>
          <input
            id="font-file"
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
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
      ) : (
        <p className="muted small">Chỉ owner/admin tải lên hoặc xoá font.</p>
      )}
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
      {q.data && fonts.length === 0 && <p className="muted">Nhóm chưa có font riêng.</p>}
      {fonts.length > 0 && (
        <table className="data" aria-label="Danh sách font">
          <thead>
            <tr>
              <th>Tên font</th>
              <th>Dung lượng</th>
              <th>Tiếng Việt</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {fonts.map((f) => (
              <FontRow
                key={f.id}
                font={f}
                canManage={canManage}
                busy={del.isPending}
                onDelete={() => del.mutate(f.id)}
              />
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

function FontRow({
  font,
  canManage,
  busy,
  onDelete,
}: {
  font: WorkspaceFont;
  canManage: boolean;
  busy: boolean;
  onDelete(): void;
}) {
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
      {canManage && (
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
      )}
    </tr>
  );
}
