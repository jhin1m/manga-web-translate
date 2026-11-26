/**
 * Cài đặt dịch — nhóm "Font chữ": font mặc định theo loại chữ (thoại, dẫn truyện, suy nghĩ, ghi chú). Ô chọn xem trước
 * bằng chính font; "+ Tải font lên…" mở chọn file cho đúng ô, tải xong chọn luôn font mới (cha tự lưu khi đổi). Không
 * có ô SFX: SFX giữ nguyên chữ gốc; khoá `sfx` đã lưu được giữ nguyên.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { type MessageKey, t, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { fontPreview, loadFonts } from "../editor/fonts.ts";
import {
  FONT_ACCEPT,
  fontKeys,
  ownFonts,
  type UserFont,
  uploadCheckedFont,
  useBundledFonts,
  useFontLimit,
  useUserFonts,
} from "../fonts/api.ts";
import { fontDisplayName, recommendedFirst } from "../fonts/font-names.ts";
import type { FontSlot } from "./api.ts";
import { langShort, type TargetLang } from "./lang-labels.ts";
import { SettingsRow } from "./settings-row.tsx";

type Fonts = Partial<Record<FontSlot, string>>;

const OTHER_FONT_SLOTS: { slot: FontSlot; label: MessageKey; empty: MessageKey; tip: MessageKey }[] = [
  {
    slot: "narration",
    label: "series.fontFields.slot.narration",
    empty: "series.fontFields.empty.narration",
    tip: "series.fontFields.tip.narration",
  },
  {
    slot: "thought",
    label: "series.fontFields.slot.thought",
    empty: "series.fontFields.empty.inherit",
    tip: "series.fontFields.tip.thought",
  },
  {
    slot: "note",
    label: "series.fontFields.slot.note",
    empty: "series.fontFields.empty.inherit",
    tip: "series.fontFields.tip.note",
  },
];

/** Giá trị option "Tải font lên…" — không phải font id (font của bạn là `custom-…`, font gói sẵn là tên file). */
const UPLOAD_OPTION = "__upload__";

export function SeriesFontFields(props: { fonts: Fonts; targetLang: TargetLang; onChange(next: Fonts): void }) {
  const { fonts, targetLang } = props;
  useT();
  const qc = useQueryClient();
  const bundled = useBundledFonts();
  const custom = useUserFonts();
  // Nạp font gói sẵn + font của bạn vào trình duyệt để dropdown xem trước được (lỗi → chỉ mất preview).
  const customFonts = custom.data;
  useEffect(() => {
    loadFonts(customFonts && (() => Promise.resolve(customFonts))).catch(() => {});
  }, [customFonts]);

  const setFont = (slot: FontSlot, id: string) => {
    const next = { ...fonts };
    if (id) next[slot] = id;
    else delete next[slot];
    props.onChange(next);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSlot = useRef<FontSlot>("dialogue");
  const fontLimit = useFontLimit();
  const upload = useMutation({
    mutationFn: ({ file }: { file: File; slot: FontSlot }) =>
      uploadCheckedFont(file, ownFonts(custom.data).length, fontLimit),
    onSuccess: (font, { slot }) => {
      // Thêm ngay vào danh sách để select có option khớp giá trị mới trước khi refetch xong.
      qc.setQueryData<UserFont[]>(fontKeys.list(), (cur) => [...(cur ?? []), font]);
      void qc.invalidateQueries({ queryKey: fontKeys.list() });
      setFont(slot, font.id);
    },
  });

  const fontSelect = (slot: FontSlot, id: string, empty: string) => {
    const cur = fonts[slot] ?? "";
    return (
      <select
        id={id}
        className="font-select"
        style={cur ? fontPreview(cur) : undefined}
        value={cur}
        disabled={upload.isPending}
        onChange={(e) => {
          if (e.target.value !== UPLOAD_OPTION) return setFont(slot, e.target.value);
          uploadSlot.current = slot;
          fileInput.current?.click();
        }}
      >
        <option value="">{empty}</option>
        {/* Font đã chọn nhưng thiếu chữ ngôn ngữ đích (vừa đổi ngôn ngữ) → vẫn hiện để không mất giá trị. */}
        {bundled.data?.has(cur) && !bundled.data.ids(targetLang).includes(cur) && (
          <option value={cur}>
            {t("series.fontFields.missingGlyphs", { font: fontDisplayName(cur), lang: langShort(targetLang) })}
          </option>
        )}
        {recommendedFirst(bundled.data?.ids(targetLang) ?? []).map((fid) => (
          <option key={fid} value={fid} style={fontPreview(fid)}>
            {fontDisplayName(fid)}
          </option>
        ))}
        {[
          { label: t("series.fontFields.shared"), list: (custom.data ?? []).filter((font) => font.system) },
          { label: t("series.fontFields.own"), list: ownFonts(custom.data) },
        ].map(
          ({ label, list }) =>
            list.length > 0 && (
              <optgroup key={label} label={label}>
                {list.map((font) => (
                  <option key={font.id} value={font.id} style={fontPreview(font.id)}>
                    {font.name}
                  </option>
                ))}
              </optgroup>
            ),
        )}
        <option value={UPLOAD_OPTION}>{t("series.fontFields.uploadOption")}</option>
      </select>
    );
  };

  return (
    <>
      <SettingsRow label={t("series.fontFields.dialogue")} htmlFor="s-font-dialogue">
        {fontSelect(
          "dialogue",
          "s-font-dialogue",
          bundled.data?.defaultId
            ? t("series.fontFields.defaultNamed", { font: fontDisplayName(bundled.data.defaultId) })
            : t("series.fontFields.default"),
        )}
      </SettingsRow>
      {OTHER_FONT_SLOTS.map(({ slot, label, empty, tip }) => (
        <SettingsRow
          key={slot}
          label={t(label)}
          htmlFor={`s-font-${slot}`}
          tip={t(tip)}
          tipLabel={t("series.fontFields.tipLabel", { label: t(label) })}
        >
          {fontSelect(slot, `s-font-${slot}`, t(empty))}
        </SettingsRow>
      ))}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept={FONT_ACCEPT}
        aria-label={t("series.fontFields.pickFile")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate({ file, slot: uploadSlot.current });
        }}
      />
      {(upload.isPending || upload.error || upload.isSuccess) && (
        <p className="set-card-note small" role={upload.error ? "alert" : "status"}>
          {upload.isPending ? (
            <span className="muted">{t("series.fontFields.uploading")}</span>
          ) : upload.error ? (
            <span className="error">{errorMessage(upload.error)}</span>
          ) : (
            upload.data && (
              <span className="muted">
                {t(upload.data.vi_complete ? "series.fontFields.added" : "series.fontFields.addedMissingVi", {
                  name: upload.data.name,
                })}
              </span>
            )
          )}
        </p>
      )}
    </>
  );
}
