/**
 * Cài đặt dịch — nhóm "Font chữ": font mặc định theo loại chữ (thoại, dẫn truyện, suy nghĩ, ghi chú). Ô chọn xem trước
 * bằng chính font; "+ Tải font lên…" mở chọn file cho đúng ô, tải xong chọn luôn font mới (cha tự lưu khi đổi). Không
 * có ô SFX: SFX giữ nguyên chữ gốc; khoá `sfx` đã lưu được giữ nguyên.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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

const OTHER_FONT_SLOTS: { slot: FontSlot; label: string; empty: string; tip: string }[] = [
  { slot: "narration", label: "Dẫn truyện", empty: "Giống font thoại", tip: "Chữ ngoài bóng." },
  { slot: "thought", label: "Suy nghĩ", empty: "Như thoại/dẫn truyện", tip: "Chữ trong ngoặc, độc thoại, nói thầm." },
  { slot: "note", label: "Ghi chú", empty: "Như thoại/dẫn truyện", tip: "Chữ viết tay, chú thích nhỏ." },
];

/** Giá trị option "Tải font lên…" — không phải font id (font của bạn là `custom-…`, font gói sẵn là tên file). */
const UPLOAD_OPTION = "__upload__";

export function SeriesFontFields(props: { fonts: Fonts; targetLang: TargetLang; onChange(next: Fonts): void }) {
  const { fonts, targetLang } = props;
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
            {fontDisplayName(cur)} (thiếu chữ tiếng {langShort(targetLang)})
          </option>
        )}
        {recommendedFirst(bundled.data?.ids(targetLang) ?? []).map((fid) => (
          <option key={fid} value={fid} style={fontPreview(fid)}>
            {fontDisplayName(fid)}
          </option>
        ))}
        {[
          { label: "Font dùng chung", list: (custom.data ?? []).filter((font) => font.system) },
          { label: "Font của bạn", list: ownFonts(custom.data) },
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
        <option value={UPLOAD_OPTION}>+ Tải font lên…</option>
      </select>
    );
  };

  return (
    <>
      <SettingsRow label="Font thoại" htmlFor="s-font-dialogue">
        {fontSelect(
          "dialogue",
          "s-font-dialogue",
          bundled.data?.defaultId ? `Mặc định (${fontDisplayName(bundled.data.defaultId)})` : "Mặc định",
        )}
      </SettingsRow>
      {OTHER_FONT_SLOTS.map(({ slot, label, empty, tip }) => (
        <SettingsRow
          key={slot}
          label={label}
          htmlFor={`s-font-${slot}`}
          tip={tip}
          tipLabel={`Giải thích font ${label}`}
        >
          {fontSelect(slot, `s-font-${slot}`, empty)}
        </SettingsRow>
      ))}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept={FONT_ACCEPT}
        aria-label="Chọn file font"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate({ file, slot: uploadSlot.current });
        }}
      />
      {(upload.isPending || upload.error || upload.isSuccess) && (
        <p className="set-card-note small" role={upload.error ? "alert" : "status"}>
          {upload.isPending ? (
            <span className="muted">Đang tải font lên…</span>
          ) : upload.error ? (
            <span className="error">{errorMessage(upload.error)}</span>
          ) : (
            upload.data && (
              <span className="muted">
                Đã thêm font {upload.data.name}
                {upload.data.vi_complete ? "" : " (thiếu một số dấu tiếng Việt)"}.
              </span>
            )
          )}
        </p>
      )}
    </>
  );
}
