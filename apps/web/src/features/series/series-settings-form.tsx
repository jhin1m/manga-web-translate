/**
 * Form cài đặt dịch của series (chia nhóm Chung / Dịch / Font / Xưng hô): ngôn ngữ, định dạng truyện, kính ngữ, tier
 * model, giọng văn, chữ bỏ qua (watermark),
 * font mặc định (tải font của bạn ngay trong dropdown), quy tắc xưng hô theo cặp nhân vật. Server tăng settings_rev khi trường ảnh hưởng dịch đổi. Kèm vùng
 * xoá series. Dùng ở `?tab=settings` của màn series.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { loadFonts } from "../editor/fonts.ts";
import {
  FONT_ACCEPT,
  fontKeys,
  type UserFont,
  uploadCheckedFont,
  useBundledFonts,
  useUserFonts,
} from "../fonts/api.ts";
import { fetchGlossary, glossaryKey } from "../glossary/api.ts";
import {
  deleteSeries,
  type FontSlot,
  type PronounRule,
  patchSeries,
  type Series,
  type SeriesSettings,
  seriesKeys,
} from "./api.ts";
import { IgnoreApplySection } from "./ignore-apply-section.tsx";
import { parseIgnoreText } from "./ignore-text-input.ts";
import {
  addressPlaceholder,
  HONORIFIC_EXAMPLES,
  LANG_NAMES,
  langChangeWarning,
  langShort,
  PAGE_FORMAT_LABELS,
  PAGE_FORMATS,
  SOURCE_LANGS,
  TARGET_LANGS,
} from "./lang-labels.ts";

// Không có ô SFX: SFX giữ nguyên chữ gốc (không dịch / đặt chữ). Khoá `sfx` đã lưu vẫn được giữ khi lưu form.
const FONT_SLOTS: { slot: FontSlot; label: string; empty: string; hint?: string }[] = [
  { slot: "dialogue", label: "Thoại", empty: "Mặc định hệ thống" },
  { slot: "narration", label: "Dẫn truyện", empty: "Giống font thoại", hint: "Áp dụng cho chữ ngoài bóng." },
];

/** Giá trị option "Tải font lên…" — không phải font id (font của bạn là `custom-…`, font gói sẵn là tên file). */
const UPLOAD_OPTION = "__upload__";

/** Vẽ tên font bằng chính font đó (FontFace family = font id); chưa nạp xong → font giao diện. */
const fontPreview = (id: string): CSSProperties => ({ fontFamily: `"${id}", var(--font-ui)` });

/** Chữ bỏ qua sửa ở ô riêng (chuỗi nhiều dòng), ghép vào lúc lưu. */
type Form = Omit<SeriesSettings, "ignore_text"> & { title: string };

const toForm = (s: Series): Form => ({
  title: s.title,
  source_lang: s.source_lang,
  target_lang: s.target_lang,
  page_format: s.page_format,
  honorific_policy: s.honorific_policy,
  pronoun_rules: s.pronoun_rules,
  style_prompt: s.style_prompt,
  default_fonts: s.default_fonts,
  llm_tier: s.llm_tier,
});

export function SeriesSettingsForm({ series }: { series: Series }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => toForm(series));
  const bundled = useBundledFonts();
  const custom = useUserFonts();
  // Nạp font gói sẵn + font của bạn vào trình duyệt để dropdown xem trước được (lỗi → chỉ mất preview).
  const customFonts = custom.data;
  useEffect(() => {
    loadFonts(customFonts && (() => Promise.resolve(customFonts))).catch(() => {});
  }, [customFonts]);
  const [saved, setSaved] = useState<string | null>(null);
  const [ignoreRaw, setIgnoreRaw] = useState(() => series.ignore_text.join("\n"));
  const ignore = parseIgnoreText(ignoreRaw);
  const glossaryScope = { seriesId: series.id };
  const glossary = useQuery({
    queryKey: glossaryKey(glossaryScope),
    queryFn: () => fetchGlossary(glossaryScope),
  });
  const langWarning = langChangeWarning(series, f, glossary.data?.entries.length);
  const save = useMutation({
    mutationFn: () => patchSeries(series.id, { ...f, ignore_text: ignore.list }),
    onSuccess: (s) => {
      setSaved(
        s.settings_rev !== series.settings_rev || s.glossary_rev !== series.glossary_rev
          ? "Đã lưu. Lần dịch sau dùng cài đặt mới (chương đã dịch không tự chạy lại)."
          : "Đã lưu.",
      );
      setIgnoreRaw(s.ignore_text.join("\n"));
      void qc.invalidateQueries({ queryKey: ["series"] });
      // Key glossary series không chứa cặp → làm mới để mục kế thừa / Áp glossary theo cặp mới.
      if (s.source_lang !== series.source_lang || s.target_lang !== series.target_lang) {
        void qc.invalidateQueries({ queryKey: ["glossary"] });
      }
    },
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(null);
    setF((cur) => ({ ...cur, [k]: v }));
  };
  const setFont = (slot: FontSlot, id: string) => {
    const next = { ...f.default_fonts };
    if (id) next[slot] = id;
    else delete next[slot];
    set("default_fonts", next);
  };
  // Tải font từ dropdown: chọn "Tải font lên…" → mở chọn file cho đúng ô; xong thì chọn font mới (chưa lưu).
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSlot = useRef<FontSlot>("dialogue");
  const upload = useMutation({
    mutationFn: ({ file }: { file: File; slot: FontSlot }) => uploadCheckedFont(file, custom.data?.length ?? 0),
    onSuccess: (font, { slot }) => {
      // Thêm ngay vào danh sách để select có option khớp giá trị mới trước khi refetch xong.
      qc.setQueryData<UserFont[]>(fontKeys.list(), (cur) => [...(cur ?? []), font]);
      void qc.invalidateQueries({ queryKey: fontKeys.list() });
      setFont(slot, font.id);
    },
  });
  const setRule = (i: number, patch: Partial<PronounRule>) =>
    set(
      "pronoun_rules",
      f.pronoun_rules.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const rulesValid = f.pronoun_rules.every((r) => r.speaker.trim() && r.listener.trim() && r.address.trim());

  return (
    <form onSubmit={submit} className="settings-form">
      <fieldset className="settings-group">
        <legend>Chung</legend>
        <label htmlFor="s-title">Tên series</label>
        <input id="s-title" required value={f.title} onChange={(e) => set("title", e.target.value)} />
      </fieldset>

      <fieldset className="settings-group">
        <legend>Dịch</legend>
        <div className="grid-pairs">
          <div>
            <label htmlFor="s-src">Ngôn ngữ gốc</label>
            <select
              id="s-src"
              value={f.source_lang}
              onChange={(e) => set("source_lang", e.target.value as Form["source_lang"])}
            >
              {SOURCE_LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]} ({l})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="s-tgt">Ngôn ngữ đích</label>
            <select
              id="s-tgt"
              value={f.target_lang}
              onChange={(e) => set("target_lang", e.target.value as Form["target_lang"])}
            >
              {TARGET_LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]} ({l})
                </option>
              ))}
            </select>
          </div>
          {langWarning && (
            <p className="notice" role="status" style={{ gridColumn: "1 / -1" }}>
              {langWarning}
            </p>
          )}
          <div>
            <label htmlFor="s-fmt">Định dạng truyện</label>
            <select
              id="s-fmt"
              value={f.page_format}
              onChange={(e) => set("page_format", e.target.value as Form["page_format"])}
            >
              {PAGE_FORMATS.map((p) => (
                <option key={p} value={p}>
                  {PAGE_FORMAT_LABELS[p]}
                </option>
              ))}
            </select>
            <span className="hint">Áp dụng cho chương upload sau khi lưu.</span>
          </div>
          <div>
            <label htmlFor="s-hon">Kính ngữ ({HONORIFIC_EXAMPLES[f.source_lang]})</label>
            <select
              id="s-hon"
              value={f.honorific_policy}
              onChange={(e) => set("honorific_policy", e.target.value as Form["honorific_policy"])}
            >
              <option value="translate">Chuyển sang cách gọi của ngôn ngữ đích</option>
              <option value="keep">Giữ nguyên kính ngữ (phiên âm)</option>
            </select>
          </div>
          <div>
            <label htmlFor="s-tier">Model dịch</label>
            <select
              id="s-tier"
              value={f.llm_tier}
              onChange={(e) => set("llm_tier", e.target.value as Form["llm_tier"])}
            >
              <option value="standard">Standard (rẻ, nhanh)</option>
              <option value="premium">Premium (chất lượng cao hơn)</option>
            </select>
          </div>
        </div>
        <label htmlFor="s-style">Giọng văn</label>
        <textarea
          id="s-style"
          maxLength={1000}
          placeholder="VD: giọng trẻ, đời thường; giữ tên riêng phiên âm"
          value={f.style_prompt}
          onChange={(e) => set("style_prompt", e.target.value)}
        />
        <span className="hint">Mô tả ngắn gửi kèm cho AI ở mọi lần dịch.</span>
        <label htmlFor="s-ignore">Chữ bỏ qua (watermark)</label>
        <textarea
          id="s-ignore"
          placeholder={"VD:\ndiscord.gg/nhomdich\nTên nhóm dịch"}
          value={ignoreRaw}
          aria-invalid={ignore.error ? true : undefined}
          onChange={(e) => {
            setSaved(null);
            setIgnoreRaw(e.target.value);
          }}
        />
        {ignore.error ? (
          <span className="small error">{ignore.error}</span>
        ) : (
          <span className="hint">
            Mỗi dòng 1 mục. Vùng chữ chứa mục nào thì không dịch, không chèn chữ (chương đã dịch không đổi). Dùng URL
            hoặc tên nhóm cụ thể — mục chung chung dễ bỏ nhầm thoại. Bỏ qua dấu cách khi so khớp; bọc mục trong dấu /
            {"(vd /discord\\s*\\.\\s*gg/)"} để dùng regex, không phân biệt hoa/thường.
          </span>
        )}
        {series.ignore_text.length > 0 && (
          <IgnoreApplySection
            seriesId={series.id}
            disabledReason={
              ignoreRaw !== series.ignore_text.join("\n") ? "Lưu cài đặt trước để áp danh sách mới." : null
            }
          />
        )}
      </fieldset>

      <fieldset className="settings-group">
        <legend>Font mặc định</legend>
        <div className="grid-2">
          {FONT_SLOTS.map(({ slot, label, empty, hint }) => (
            <div key={slot}>
              <label htmlFor={`s-font-${slot}`}>{label}</label>
              <select
                id={`s-font-${slot}`}
                className="font-select"
                style={f.default_fonts[slot] ? fontPreview(f.default_fonts[slot]) : undefined}
                value={f.default_fonts[slot] ?? ""}
                disabled={upload.isPending}
                onChange={(e) => {
                  if (e.target.value !== UPLOAD_OPTION) return setFont(slot, e.target.value);
                  uploadSlot.current = slot;
                  fileInput.current?.click();
                }}
              >
                <option value="">{empty}</option>
                {/* Font đã chọn nhưng thiếu chữ ngôn ngữ đích (vừa đổi ngôn ngữ) → vẫn hiện để không mất giá trị. */}
                {bundled.data?.has(f.default_fonts[slot] ?? "") &&
                  !bundled.data.ids(f.target_lang).includes(f.default_fonts[slot] ?? "") && (
                    <option value={f.default_fonts[slot]}>
                      {f.default_fonts[slot]} (thiếu chữ tiếng {langShort(f.target_lang)})
                    </option>
                  )}
                {(bundled.data?.ids(f.target_lang) ?? []).map((id) => (
                  <option key={id} value={id} style={fontPreview(id)}>
                    {id}
                  </option>
                ))}
                {(custom.data ?? []).length > 0 && (
                  <optgroup label="Font của bạn">
                    {(custom.data ?? []).map((font) => (
                      <option key={font.id} value={font.id} style={fontPreview(font.id)}>
                        {font.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={UPLOAD_OPTION}>+ Tải font lên…</option>
              </select>
              {hint && <span className="hint">{hint}</span>}
            </div>
          ))}
        </div>
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
        {upload.isPending && <span className="hint">Đang tải font lên…</span>}
        {upload.error && (
          <span className="small error" role="alert">
            {errorMessage(upload.error)}
          </span>
        )}
        {upload.isSuccess && (
          <span className="hint" role="status">
            Đã thêm font {upload.data.name} vào font của bạn
            {upload.data.vi_complete ? "" : " (thiếu một số dấu tiếng Việt)"}. Bấm Lưu cài đặt để dùng làm mặc định.
          </span>
        )}
      </fieldset>

      <fieldset className="settings-group">
        <legend>Cách xưng hô / gọi nhau</legend>
        <span className="hint">
          Người nói → người nghe: cách xưng / gọi. VD: Minjun → Seoyeon: {addressPlaceholder(f.target_lang)}.
        </span>
        {f.pronoun_rules.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>Người nói</th>
                <th>Người nghe</th>
                <th>Xưng / gọi</th>
                <th>Ghi chú</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {f.pronoun_rules.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: hàng chưa có id; thứ tự chỉ đổi khi xoá.
                <tr key={i}>
                  <td>
                    <input
                      aria-label="Người nói"
                      value={r.speaker}
                      onChange={(e) => setRule(i, { speaker: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Người nghe"
                      value={r.listener}
                      onChange={(e) => setRule(i, { listener: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Xưng / gọi"
                      placeholder={addressPlaceholder(f.target_lang)}
                      value={r.address}
                      onChange={(e) => setRule(i, { address: e.target.value })}
                    />
                  </td>
                  <td>
                    <input aria-label="Ghi chú" value={r.note} onChange={(e) => setRule(i, { note: e.target.value })} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost btn-danger"
                      onClick={() =>
                        set(
                          "pronoun_rules",
                          f.pronoun_rules.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="add-rule">
          <button
            type="button"
            onClick={() =>
              set("pronoun_rules", [...f.pronoun_rules, { speaker: "", listener: "", address: "", note: "" }])
            }
          >
            + Thêm quy tắc
          </button>
        </div>
      </fieldset>

      <div className="settings-save">
        <button
          type="submit"
          className="btn-primary"
          disabled={save.isPending || !rulesValid || !f.title.trim() || !!ignore.error}
        >
          {save.isPending ? "Đang lưu…" : "Lưu cài đặt"}
        </button>
        {!rulesValid && <span className="small error">Điền đủ người nói, người nghe, xưng/gọi cho mọi quy tắc.</span>}
        {saved && (
          <span className="small muted" role="status">
            {saved}
          </span>
        )}
        {save.error && <span className="small error">{errorMessage(save.error)}</span>}
      </div>
    </form>
  );
}

/** Xoá series: gõ đúng tên để mở khoá nút (xoá luôn mọi chương + glossary riêng, không hoàn tác). */
export function DeleteSeries({ series }: { series: Series & { chapters?: unknown[] } }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => deleteSeries(series.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: seriesKeys.detail(series.id) });
      void qc.invalidateQueries({ queryKey: seriesKeys.list() });
      void navigate({ to: "/" });
    },
  });
  const n = series.chapters?.length ?? 0;
  return (
    <section className="danger-zone" aria-label="Xoá series">
      <h2>Xoá series</h2>
      <p className="small">
        Xoá vĩnh viễn <b>{series.title}</b>
        {n > 0 ? ` cùng ${n} chương (ảnh, bản dịch, lịch sử)` : ""} và glossary riêng của series. Không hoàn tác được.
      </p>
      <label htmlFor="s-delete">Gõ tên series để xác nhận</label>
      <div className="row">
        <input
          id="s-delete"
          value={typed}
          placeholder={series.title}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <button
          type="button"
          className="btn-danger-solid"
          disabled={typed.trim() !== series.title.trim() || del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? "Đang xoá…" : "Xoá series"}
        </button>
      </div>
      {del.error && <span className="small error">{errorMessage(del.error)}</span>}
    </section>
  );
}
