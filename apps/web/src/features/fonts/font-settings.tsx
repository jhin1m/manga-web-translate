/**
 * Trang Font (`/fonts`, menu tài khoản) — chỗ duy nhất quản lý font:
 * - Thêm font: chọn từ font cài trong máy (Chrome / Edge) hoặc tải file TTF/OTF. Admin bản nhiều người tích "Cho mọi
 *   người dùng" để thêm thành font dùng chung.
 * - Font đã thêm: font riêng + font dùng chung (nhãn "Dùng chung"), cảnh báo thiếu dấu tiếng Việt (vẫn dùng được), xoá
 *   (bị chặn khi series còn dùng làm font mặc định; font dùng chung chỉ admin xoá).
 * - Font có sẵn: font gói sẵn của app, xem trước bằng chính font đó.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useMe } from "../../app/app-shell.tsx";
import { ApiError, api, errorMessage, useLocalMode } from "../../lib/api.ts";
import { SectionHead, SetGroup, SetRow } from "../admin/settings-ui.tsx";
import { fontPreview, loadFonts } from "../editor/fonts.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import {
  deleteFont,
  FONT_ACCEPT,
  fontKeys,
  fontUploadError,
  ownFonts,
  type UserFont,
  uploadCheckedFont,
  uploadFont,
  useFontLimit,
  useUserFonts,
} from "./api.ts";
import { fontDisplayName } from "./font-names.ts";
import { LocalFontPicker } from "./local-font-picker.tsx";
import { type LocalFont, localFontFile, localFontsSupported, queryLocalFonts } from "./local-fonts.ts";

const MISSING_SHOWN = 12;
const PREVIEW_TEXT = "Xin chào! Tiếng Việt";

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Lỗi xoá: font đang là mặc định của series nào thì nêu tên (font riêng) hoặc số series (font dùng chung). */
function deleteError(e: unknown): string {
  if (e instanceof ApiError && e.body.error === "in_use") {
    if (Array.isArray(e.body.series))
      return `Font đang là mặc định của series: ${e.body.series.join(", ")}. Đổi font mặc định của series trước.`;
    if (e.body.series_count !== undefined)
      return `${String(e.body.series_count)} series đang dùng font này làm mặc định. Chỉ xoá được khi không còn series nào dùng.`;
  }
  return errorMessage(e);
}

/** Một font cần thêm: tên để báo kết quả + cách lấy file (đọc font trong máy có thể lỗi riêng từng font). */
type AddItem = { name: string; file: () => Promise<File> };
type AddResult = { added: string[]; failed: { name: string; message: string }[] };

export function FontLibrary() {
  const me = useMe();
  const local = useLocalMode();
  const limit = useFontLimit();
  const qc = useQueryClient();
  const q = useUserFonts();
  const all = q.data ?? [];
  const own = ownFonts(all);
  const shared = all.filter((f) => f.system);
  // Bản local chỉ một người dùng: không có font dùng chung mới (font dùng chung cũ vẫn hiện, admin xoá được).
  const canShare = me.is_admin && !local;
  const [toShared, setToShared] = useState(false);
  const [picker, setPicker] = useState<LocalFont[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: fontKeys.list() });

  const sharedTarget = canShare && toShared;
  const add = useMutation({
    mutationFn: async (items: AddItem[]): Promise<AddResult> => {
      const out: AddResult = { added: [], failed: [] };
      let count = own.length;
      for (const item of items) {
        try {
          const file = await item.file();
          if (sharedTarget) {
            // Đuôi + dung lượng; trần font dùng chung (20 font / 100MB) do API kiểm.
            const bad = fontUploadError(file, 0, Number.POSITIVE_INFINITY);
            if (bad) throw new Error(bad);
            await uploadFont(file, "/api/admin/fonts");
          } else {
            await uploadCheckedFont(file, count, limit);
            count++;
          }
          out.added.push(item.name);
        } catch (e) {
          out.failed.push({ name: item.name, message: errorMessage(e) });
        }
      }
      return out;
    },
    onSettled: refresh,
    onSuccess: (r) => {
      if (r.added.length) setPicker(null);
    },
  });
  const delOwn = useMutation({ mutationFn: (id: string) => deleteFont(id), onSuccess: refresh });
  const delShared = useMutation({
    mutationFn: (id: string) => api<void>(`/api/admin/fonts/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const delError = delOwn.error ?? delShared.error;

  const openPicker = async () => {
    setPickError(null);
    try {
      setPicker(await queryLocalFonts());
    } catch (e) {
      setPickError(
        e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
          ? "Trình duyệt chưa cho phép đọc font trong máy. Bấm lại và chọn Cho phép (hoặc bật trong cài đặt trang)."
          : errorMessage(e),
      );
    }
  };

  const remaining = sharedTarget ? Number.POSITIVE_INFINITY : Math.max(0, limit - own.length);

  return (
    <div className="set-section">
      <SectionHead
        title="Thêm font"
        desc="Font TTF / OTF dùng được trong editor và làm font mặc định của series. Bạn tự chịu trách nhiệm về bản quyền font."
      />
      <div className="set-card">
        <SetRow
          label="Font trong máy"
          desc="Chọn từ các font đã cài trên máy này. Lần đầu trình duyệt sẽ hỏi quyền đọc font."
        >
          {localFontsSupported() ? (
            <button type="button" onClick={() => void openPicker()} disabled={add.isPending}>
              Chọn font trong máy
            </button>
          ) : (
            <span className="muted small">
              Trình duyệt này không đọc được font trong máy (cần Chrome hoặc Edge trên máy tính). Dùng ô tải file bên
              dưới.
            </span>
          )}
        </SetRow>
        <SetRow label="Tải file" htmlFor="font-file" desc="File .ttf hoặc .otf, mỗi file tối đa 10MB.">
          <input
            id="font-file"
            type="file"
            multiple
            accept={FONT_ACCEPT}
            aria-label="Chọn file font"
            disabled={add.isPending}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) add.mutate(files.map((f) => ({ name: f.name, file: async () => f })));
            }}
          />
        </SetRow>
        {canShare && (
          <SetRow
            label="Cho mọi người dùng"
            htmlFor="font-shared"
            desc="Bật: font thêm vào thành font dùng chung, mọi tài khoản đều thấy (chỉ admin)."
          >
            <input
              id="font-shared"
              type="checkbox"
              className="set-switch"
              checked={toShared}
              onChange={(e) => setToShared(e.target.checked)}
            />
          </SetRow>
        )}
      </div>

      {pickError && (
        <p className="error" role="alert">
          {pickError}
        </p>
      )}
      {picker && (
        <LocalFontPicker
          fonts={picker}
          added={new Set(all.map((f) => f.name))}
          remaining={remaining}
          busy={add.isPending}
          onAdd={(list) => add.mutate(list.map((f) => ({ name: f.fullName, file: () => localFontFile(f) })))}
          onClose={() => setPicker(null)}
        />
      )}
      {add.isPending && <p className="muted small">Đang thêm font…</p>}
      {add.data && !add.isPending && <AddReport result={add.data} />}
      {add.error && (
        <p className="error" role="alert">
          {errorMessage(add.error)}
        </p>
      )}

      <SetGroup
        title="Font đã thêm"
        desc={`${own.length} / ${limit} font riêng${shared.length ? ` · ${shared.length} font dùng chung` : ""}.`}
      >
        {q.error && <p className="error">{errorMessage(q.error)}</p>}
        {!q.data && !q.error && <p className="muted set-empty">Đang tải…</p>}
        {q.data && all.length === 0 && <p className="muted set-empty">Chưa thêm font nào.</p>}
        {all.length > 0 && (
          <table className="data set-table" aria-label="Danh sách font">
            <thead>
              <tr>
                <th>Tên font</th>
                <th>Dung lượng</th>
                <th>Tiếng Việt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shared.map((f) => (
                <FontRow
                  key={f.id}
                  font={f}
                  tag="Dùng chung"
                  busy={delShared.isPending}
                  confirm
                  onDelete={me.is_admin ? () => delShared.mutate(f.id) : undefined}
                />
              ))}
              {own.map((f) => (
                <FontRow key={f.id} font={f} busy={delOwn.isPending} onDelete={() => delOwn.mutate(f.id)} />
              ))}
            </tbody>
          </table>
        )}
      </SetGroup>
      {delError && (
        <p className="error" role="alert">
          {deleteError(delError)}
        </p>
      )}

      <BundledFonts />
    </div>
  );
}

function AddReport({ result }: { result: AddResult }) {
  return (
    <>
      {result.added.length > 0 && (
        <p className="notice info" role="status">
          Đã thêm {result.added.length} font: {result.added.join(", ")}.
        </p>
      )}
      {result.failed.length > 0 && (
        <div className="notice danger" role="alert">
          Không thêm được {result.failed.length} font:
          <ul className="font-fail-list">
            {result.failed.map((f) => (
              <li key={f.name}>
                {f.name}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Font gói sẵn của app (đã có trong editor, không cần thêm), xem trước bằng chính font đó. */
function BundledFonts() {
  const kit = useQuery({
    queryKey: ["fonts", "faces"],
    queryFn: () => loadFonts(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const ids = kit.data?.ids ?? [];
  return (
    <SetGroup
      title={`Font có sẵn${ids.length ? ` (${ids.length})` : ""}`}
      label="Font có sẵn"
      desc="Đi kèm ứng dụng, chọn được ngay trong editor."
    >
      {kit.error && <p className="error set-empty">{errorMessage(kit.error)}</p>}
      {!kit.data && !kit.error && <p className="muted set-empty">Đang tải…</p>}
      {ids.length > 0 && (
        <ul className="font-grid" aria-label="Danh sách font có sẵn">
          {ids.map((id) => {
            const entry = kit.data?.manifest.fonts[id];
            return (
              <li key={id}>
                <span className="font-grid-name">
                  {fontDisplayName(id)}
                  {entry && !entry.viComplete && <span className="warn-text"> · thiếu dấu</span>}
                </span>
                <span className="font-grid-preview" style={fontPreview(id)}>
                  {PREVIEW_TEXT}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SetGroup>
  );
}

/**
 * Một dòng font. `onDelete` thiếu = không xoá được (font dùng chung với người không phải admin). `confirm`: icon Xoá
 * hỏi lại tại chỗ (Xoá? / Huỷ) — cho thao tác ảnh hưởng mọi người dùng.
 */
export function FontRow({
  font,
  busy,
  onDelete,
  confirm = false,
  tag,
}: {
  font: UserFont;
  busy: boolean;
  onDelete?: () => void;
  confirm?: boolean;
  tag?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const shown = font.missing.slice(0, MISSING_SHOWN).join(" ");
  const more = font.missing.length - MISSING_SHOWN;
  return (
    <tr>
      <td>
        {font.name}
        {tag && <span className="font-tag">{tag}</span>}
      </td>
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
      <td className="rule-actions">
        {!onDelete ? null : confirming ? (
          <>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              aria-label={`Xác nhận xoá font ${font.name}`}
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              Xoá?
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Huỷ
            </button>
          </>
        ) : (
          <button
            type="button"
            className="icon-btn"
            data-danger
            aria-label={`Xoá font ${font.name}`}
            title="Xoá font"
            disabled={busy}
            onClick={confirm ? () => setConfirming(true) : onDelete}
          >
            <TrashIcon />
          </button>
        )}
      </td>
    </tr>
  );
}
