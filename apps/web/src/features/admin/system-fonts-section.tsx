/**
 * Hệ thống › Font hệ thống: TTF/OTF dùng chung cho mọi người dùng (hiện ở nhóm "Font hệ thống" của editor và font
 * mặc định series). List kèm đủ / thiếu chữ Việt, upload, xoá bằng icon. Trần 20 font hoặc 100MB do API kiểm.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { FONT_ACCEPT, fontKeys, fontUploadError, type UserFont, uploadFont } from "../fonts/api.ts";
import { FontRow } from "../fonts/font-settings.tsx";

const BASE = "/api/admin/fonts";
const fontsKey = ["admin", "fonts"] as const;

function deleteError(e: unknown): string {
  if (e instanceof ApiError && e.body.error === "in_use") {
    return `${String(e.body.series_count)} series của người dùng đang dùng font này làm mặc định. Chỉ xoá được khi không còn series nào dùng.`;
  }
  return errorMessage(e);
}

export function SystemFontsSection() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: fontsKey, queryFn: () => api<{ fonts: UserFont[] }>(BASE) });
  // Danh sách font của người dùng (editor, picker series) cũng phải thấy thay đổi.
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: fontsKey }), qc.invalidateQueries({ queryKey: fontKeys.list() })]);

  const fonts = list.data?.fonts ?? [];

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const bad = fontUploadError(file, 0); // đuôi + dung lượng; trần số font / tổng dung lượng do API kiểm
      if (bad) throw new Error(bad);
      const font = await uploadFont(file, BASE);
      return { font, existed: fonts.some((f) => f.id === font.id) };
    },
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: (id: string) => api<void>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <div className="section-plain">
      <div className="page-head">
        <h2>Font hệ thống</h2>
      </div>
      <p className="muted small">
        Font TTF/OTF (mỗi file tối đa 10MB; tối đa 20 font hoặc 100MB) hiện cho mọi người dùng trong editor và làm font
        mặc định của series. Bạn chịu trách nhiệm về bản quyền font.
      </p>
      <p>
        <input
          type="file"
          accept={FONT_ACCEPT}
          aria-label="Chọn file font hệ thống"
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
          {upload.data.existed ? `Font ${upload.data.font.name} đã có sẵn.` : `Đã thêm font ${upload.data.font.name}.`}
        </p>
      )}
      {list.error && <p className="error">{errorMessage(list.error)}</p>}
      {!list.data && !list.error && <p className="muted">Đang tải…</p>}
      {list.data && fonts.length === 0 && <p className="muted">Chưa có font hệ thống.</p>}
      {fonts.length > 0 && (
        <table className="data" aria-label="Danh sách font hệ thống">
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
              <FontRow key={f.id} font={f} busy={del.isPending} confirm onDelete={() => del.mutate(f.id)} />
            ))}
          </tbody>
        </table>
      )}
      {del.error && (
        <p className="error" role="alert">
          {deleteError(del.error)}
        </p>
      )}
    </div>
  );
}
