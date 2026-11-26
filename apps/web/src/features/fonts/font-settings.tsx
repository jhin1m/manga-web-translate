/**
 * Mục Font của trang Cài đặt (`/settings?section=fonts`, mọi người dùng) — chỗ duy nhất quản lý font:
 * - Thêm font: một hàng nút — chọn từ font cài trong máy (Chrome / Edge) hoặc tải file TTF/OTF. Admin bản nhiều người
 *   bật "Cho mọi người dùng" để thêm thành font dùng chung.
 * - Font đã thêm: font riêng + font dùng chung (nhãn "Dùng chung"), cảnh báo thiếu dấu tiếng Việt (vẫn dùng được), xoá
 *   (bị chặn khi series còn dùng làm font mặc định; font dùng chung chỉ admin xoá).
 * - Font có sẵn: font gói sẵn của app, xem trước bằng chính font đó.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useMe } from "../../app/app-shell.tsx";
import { InfoTip } from "../../app/info-tip.tsx";
import { PackageIcon, TypeIcon, UploadIcon } from "../../app/settings-icons.tsx";
import { t, tp, useT } from "../../i18n/t.ts";
import { ApiError, api, errorMessage, useLocalMode } from "../../lib/api.ts";
import { SectionHead, SetGroup } from "../admin/settings-ui.tsx";
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
    if (Array.isArray(e.body.series)) return t("fonts.fontSettings.inUseSeries", { series: e.body.series.join(", ") });
    if (e.body.series_count !== undefined)
      return tp("fonts.fontSettings.inUseCount", Number(e.body.series_count), { count: String(e.body.series_count) });
  }
  return errorMessage(e);
}

/** Một font cần thêm: tên để báo kết quả + cách lấy file (đọc font trong máy có thể lỗi riêng từng font). */
type AddItem = { name: string; file: () => Promise<File> };
type AddResult = { added: string[]; failed: { name: string; message: string }[] };

export function FontLibrary() {
  useT();
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
  const fileInput = useRef<HTMLInputElement>(null);
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
          ? t("fonts.fontSettings.permissionDenied")
          : errorMessage(e),
      );
    }
  };

  const remaining = sharedTarget ? Number.POSITIVE_INFINITY : Math.max(0, limit - own.length);

  return (
    <div className="set-section">
      <SectionHead
        title={t("admin.adminSections.label.fonts")}
        icon={<TypeIcon />}
        desc={t("fonts.fontSettings.sectionDesc")}
      />
      <SetGroup
        title={t("fonts.fontSettings.addTitle")}
        icon={<UploadIcon />}
        desc={t("fonts.fontSettings.addDesc")}
        tip={t("fonts.fontSettings.addTip")}
      >
        <div className="font-add-row">
          {localFontsSupported() ? (
            <button
              type="button"
              title={t("fonts.fontSettings.pickLocalTitle")}
              onClick={() => void openPicker()}
              disabled={add.isPending}
            >
              {t("fonts.fontSettings.pickLocal")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary"
            disabled={add.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {t("fonts.fontSettings.uploadFile")}
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            accept={FONT_ACCEPT}
            aria-label={t("fonts.fontSettings.fileInputLabel")}
            disabled={add.isPending}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) add.mutate(files.map((f) => ({ name: f.name, file: async () => f })));
            }}
          />
          {add.isPending && <span className="muted small">{t("fonts.fontSettings.adding")}</span>}
          {canShare && (
            <span className="font-share">
              <label className="set-switch-label">
                <input
                  type="checkbox"
                  role="switch"
                  className="set-switch"
                  aria-checked={toShared}
                  checked={toShared}
                  onChange={(e) => setToShared(e.target.checked)}
                />
                {t("fonts.fontSettings.shareSwitch")}
              </label>
              <InfoTip label={t("fonts.fontSettings.shareTipLabel")}>{t("fonts.fontSettings.shareTip")}</InfoTip>
            </span>
          )}
        </div>
        {!localFontsSupported() && (
          <p className="muted small set-card-note">{t("fonts.fontSettings.localUnsupported")}</p>
        )}
      </SetGroup>

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
      {add.data && !add.isPending && <AddReport result={add.data} />}
      {add.error && (
        <p className="error" role="alert">
          {errorMessage(add.error)}
        </p>
      )}

      <SetGroup
        title={t("fonts.fontSettings.addedTitle")}
        icon={<TypeIcon />}
        desc={
          shared.length
            ? tp("fonts.fontSettings.addedDescShared", shared.length, { own: own.length, limit })
            : t("fonts.fontSettings.addedDesc", { own: own.length, limit })
        }
      >
        {q.error && <p className="error">{errorMessage(q.error)}</p>}
        {!q.data && !q.error && <p className="muted set-empty">{t("common.loading")}</p>}
        {q.data && all.length === 0 && <p className="muted set-empty">{t("fonts.fontSettings.empty")}</p>}
        {all.length > 0 && (
          <table className="data set-table" aria-label={t("fonts.fontSettings.tableLabel")}>
            <thead>
              <tr>
                <th>{t("fonts.fontSettings.colName")}</th>
                <th>{t("fonts.fontSettings.colSize")}</th>
                <th>{t("fonts.fontSettings.colVietnamese")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shared.map((f) => (
                <FontRow
                  key={f.id}
                  font={f}
                  tag={t("fonts.fontSettings.sharedTag")}
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
  useT();
  return (
    <>
      {result.added.length > 0 && (
        <p className="notice info" role="status">
          {tp("fonts.fontSettings.added", result.added.length, { names: result.added.join(", ") })}
        </p>
      )}
      {result.failed.length > 0 && (
        <div className="notice danger" role="alert">
          {tp("fonts.fontSettings.failed", result.failed.length)}
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
  useT();
  const kit = useQuery({
    queryKey: ["fonts", "faces"],
    queryFn: () => loadFonts(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const ids = kit.data?.ids ?? [];
  return (
    <SetGroup
      title={
        ids.length
          ? t("fonts.fontSettings.bundledTitleCount", { count: ids.length })
          : t("fonts.fontSettings.bundledTitle")
      }
      label={t("fonts.fontSettings.bundledTitle")}
      icon={<PackageIcon />}
      desc={t("fonts.fontSettings.bundledDesc")}
    >
      {kit.error && <p className="error set-empty">{errorMessage(kit.error)}</p>}
      {!kit.data && !kit.error && <p className="muted set-empty">{t("common.loading")}</p>}
      {ids.length > 0 && (
        <ul className="font-grid" aria-label={t("fonts.fontSettings.bundledListLabel")}>
          {ids.map((id) => {
            const entry = kit.data?.manifest.fonts[id];
            return (
              <li key={id}>
                <span className="font-grid-name">
                  {fontDisplayName(id)}
                  {entry && !entry.viComplete && (
                    <span className="warn-text"> · {t("fonts.fontSettings.missingMarksShort")}</span>
                  )}
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
  useT();
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
          <span className="muted">{t("fonts.fontSettings.viComplete")}</span>
        ) : (
          <span className="warn-text" title={t("fonts.fontSettings.missingTitle")}>
            {t("fonts.fontSettings.missing", { chars: shown })}
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
              aria-label={t("fonts.fontSettings.confirmDeleteLabel", { name: font.name })}
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              {t("fonts.fontSettings.confirmDelete")}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="icon-btn"
            data-danger
            aria-label={t("fonts.fontSettings.deleteLabel", { name: font.name })}
            title={t("fonts.fontSettings.deleteTitle")}
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
