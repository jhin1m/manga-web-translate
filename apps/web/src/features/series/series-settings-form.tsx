/**
 * Cài đặt dịch của series (modal): luôn hiện Tên, Dịch từ, Sang, Định dạng, Font thoại; Giọng văn, Kính ngữ, Xưng hô,
 * Font khác, Chữ bỏ qua và Ảnh tự bỏ thu gọn kèm tóm tắt một dòng. Nút Lưu dính đáy modal. "Ảnh tự bỏ" tự lưu từng
 * thao tác (không thuộc form, không cần bấm Lưu). Lỗi nhập nằm trong nhóm đang thu gọn thì nhóm đó tự mở và trường
 * lỗi được focus. "Xoá series" là link đỏ dưới đáy; bấm mới hiện ô gõ tên xác nhận. Server tăng settings_rev khi
 * trường ảnh hưởng dịch đổi. Dùng ở `?tab=settings` của màn series.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Drawer } from "../../app/drawer.tsx";
import { InfoTip } from "../../app/info-tip.tsx";
import { errorMessage } from "../../lib/api.ts";
import { fontPreview, loadFonts } from "../editor/fonts.ts";
import {
  FONT_ACCEPT,
  fontKeys,
  fontLabel,
  ownFonts,
  type UserFont,
  uploadCheckedFont,
  useBundledFonts,
  useUserFonts,
} from "../fonts/api.ts";
import { fetchGlossary, glossaryKey } from "../glossary/api.ts";
import {
  deleteSeries,
  type FontSlot,
  fetchSkipImages,
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
import { countSummary, firstMissingRuleField, rulesSummary, styleSummary } from "./settings-summary.ts";
import { SkipImagesSection } from "./skip-images-section.tsx";

// Không có ô SFX: SFX giữ nguyên chữ gốc (không dịch / đặt chữ). Khoá `sfx` đã lưu vẫn được giữ khi lưu form.
const OTHER_FONT_SLOTS: { slot: FontSlot; label: string; empty: string }[] = [
  { slot: "narration", label: "Dẫn truyện", empty: "Giống font thoại" },
  { slot: "thought", label: "Suy nghĩ", empty: "Như thoại/dẫn truyện" },
  { slot: "note", label: "Ghi chú", empty: "Như thoại/dẫn truyện" },
];

/** Giá trị option "Tải font lên…" — không phải font id (font của bạn là `custom-…`, font gói sẵn là tên file). */
const UPLOAD_OPTION = "__upload__";

type GroupId = "style" | "honorific" | "pronouns" | "fonts" | "ignore" | "skip";
const ALL_CLOSED: Record<GroupId, boolean> = {
  style: false,
  honorific: false,
  pronouns: false,
  fonts: false,
  ignore: false,
  skip: false,
};

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
});

/** Nhóm thu gọn: tên + tóm tắt (đỏ khi `invalid`); `open` do cha điều khiển để mở tự động khi có lỗi. */
function Fold(props: {
  title: string;
  summary: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="settings-fold" open={props.open} onToggle={(e) => props.onOpen(e.currentTarget.open)}>
      <summary>
        <span className="fold-title">{props.title}</span>
        <span className="fold-sum" data-invalid={props.invalid || undefined}>
          {props.summary}
        </span>
        <svg
          className="fold-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="fold-body">{props.children}</div>
    </details>
  );
}

/** Nhãn + ⓘ (hint dài nằm trong tooltip thay vì dòng chữ dưới trường). */
function FieldLabel(props: { htmlFor: string; children: ReactNode; tip: ReactNode; tipLabel: string }) {
  return (
    <div className="field-head">
      <label htmlFor={props.htmlFor}>{props.children}</label>
      <InfoTip label={props.tipLabel}>{props.tip}</InfoTip>
    </div>
  );
}

export function SeriesSettingsDialog({
  series,
  onClose,
}: {
  series: Series & { chapters?: unknown[] };
  onClose(): void;
}) {
  const qc = useQueryClient();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
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
  const skipImages = useQuery({
    queryKey: seriesKeys.skipImages(series.id),
    queryFn: () => fetchSkipImages(series.id),
    staleTime: 10 * 60_000,
  });
  const langWarning = langChangeWarning(series, f, glossary.data?.entries.length);

  // Nhóm nào đang mở; lỗi nhập → mở nhóm chứa lỗi rồi focus đúng trường (effect chạy sau khi <details> đã mở).
  const [open, setOpen] = useState(ALL_CLOSED);
  const setGroup = (id: GroupId) => (o: boolean) => setOpen((cur) => (cur[id] === o ? cur : { ...cur, [id]: o }));
  const [rulesChecked, setRulesChecked] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const missing = firstMissingRuleField(f.pronoun_rules);
  const rulesInvalid = rulesChecked && missing !== null;
  useEffect(() => {
    if (focusErr > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);
  // Lỗi "Chữ bỏ qua" chặn lưu: mở nhóm để thấy lý do ngay khi lỗi xuất hiện.
  useEffect(() => {
    if (ignore.error) setOpen((cur) => (cur.ignore ? cur : { ...cur, ignore: true }));
  }, [ignore.error]);

  const save = useMutation({
    mutationFn: () => patchSeries(series.id, { ...f, ignore_text: ignore.list }),
    onSuccess: (s) => {
      setSaved(
        s.settings_rev !== series.settings_rev || s.glossary_rev !== series.glossary_rev
          ? "Đã lưu. Lần dịch sau dùng cài đặt mới (chương đã dịch không tự chạy lại)."
          : "Đã lưu.",
      );
      // Giá trị server đã chuẩn hoá (trim, gộp mục trùng) → đưa lại vào form; các nhóm đang mở giữ nguyên.
      setF(toForm(s));
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
    mutationFn: ({ file }: { file: File; slot: FontSlot }) => uploadCheckedFont(file, ownFonts(custom.data).length),
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
    if (missing) {
      setRulesChecked(true);
      setOpen((cur) => ({ ...cur, pronouns: true }));
      setFocusErr((n) => n + 1);
      return;
    }
    save.mutate();
  };
  const invalidRule = (i: number, field: "speaker" | "listener" | "address") =>
    rulesChecked && !f.pronoun_rules[i]?.[field].trim() ? true : undefined;

  const fontSelect = (slot: FontSlot, id: string, empty: string) => (
    <select
      id={id}
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
      {(bundled.data?.ids(f.target_lang) ?? []).map((fid) => (
        <option key={fid} value={fid} style={fontPreview(fid)}>
          {fid}
        </option>
      ))}
      {[
        { label: "Font hệ thống", list: (custom.data ?? []).filter((font) => font.system) },
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

  const otherFonts = OTHER_FONT_SLOTS.filter(({ slot }) => f.default_fonts[slot]);
  const fontsSummary = otherFonts.length
    ? otherFonts.map(({ slot, label }) => `${label}: ${fontLabel(f.default_fonts[slot], custom.data)}`).join(" · ")
    : "Như font thoại";
  const [deleting, setDeleting] = useState(false);

  return (
    <Drawer
      variant="modal"
      title="Cài đặt dịch"
      onClose={onClose}
      footer={
        <div className="settings-foot">
          {deleting && <DeleteSeriesBox series={series} onCancel={() => setDeleting(false)} />}
          <div className="settings-foot-row">
            <button
              type="button"
              className="link-danger"
              aria-expanded={deleting}
              onClick={() => setDeleting((d) => !d)}
            >
              Xoá series
            </button>
            <span className="spacer" />
            {saved && (
              <span className="small muted" role="status">
                {saved}
              </span>
            )}
            {save.error && <span className="small error">{errorMessage(save.error)}</span>}
            {ignore.error && <span className="small error">Sửa lỗi ở “Chữ bỏ qua” trước khi lưu.</span>}
            {rulesInvalid && <span className="small error">Điền đủ người nói, người nghe, xưng/gọi.</span>}
            <button
              type="submit"
              form={formId}
              className="btn-primary"
              disabled={save.isPending || !f.title.trim() || !!ignore.error}
            >
              {save.isPending ? "Đang lưu…" : "Lưu"}
            </button>
          </div>
        </div>
      }
    >
      <div className="settings-dialog">
        <form id={formId} ref={formRef} onSubmit={submit} className="settings-form">
          <div>
            <label htmlFor="s-title">Tên series</label>
            <input id="s-title" required value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="settings-grid">
            <div>
              <label htmlFor="s-src">Dịch từ</label>
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
              <label htmlFor="s-tgt">Sang</label>
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
              <FieldLabel htmlFor="s-fmt" tipLabel="Giải thích Định dạng" tip="Áp dụng cho chương upload sau khi lưu.">
                Định dạng
              </FieldLabel>
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
            </div>
            <div>
              <label htmlFor="s-font-dialogue">Font thoại</label>
              {fontSelect("dialogue", "s-font-dialogue", "Mặc định hệ thống")}
            </div>
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
              {upload.data.vi_complete ? "" : " (thiếu một số dấu tiếng Việt)"}. Bấm Lưu để dùng làm mặc định.
            </span>
          )}

          <div className="settings-folds">
            <Fold title="Giọng văn" summary={styleSummary(f.style_prompt)} open={open.style} onOpen={setGroup("style")}>
              <FieldLabel
                htmlFor="s-style"
                tipLabel="Giải thích Giọng văn"
                tip="Mô tả ngắn gửi kèm cho AI ở mọi lần dịch."
              >
                Giọng văn
              </FieldLabel>
              <textarea
                id="s-style"
                maxLength={1000}
                placeholder="VD: giọng trẻ, đời thường; giữ tên riêng phiên âm"
                value={f.style_prompt}
                onChange={(e) => set("style_prompt", e.target.value)}
              />
            </Fold>

            <Fold
              title="Kính ngữ"
              summary={f.honorific_policy === "keep" ? "Giữ nguyên" : "Chuyển sang cách gọi đích"}
              open={open.honorific}
              onOpen={setGroup("honorific")}
            >
              <label htmlFor="s-hon">Kính ngữ ({HONORIFIC_EXAMPLES[f.source_lang]})</label>
              <select
                id="s-hon"
                value={f.honorific_policy}
                onChange={(e) => set("honorific_policy", e.target.value as Form["honorific_policy"])}
              >
                <option value="translate">Chuyển sang cách gọi của ngôn ngữ đích</option>
                <option value="keep">Giữ nguyên kính ngữ (phiên âm)</option>
              </select>
            </Fold>

            <Fold
              title="Xưng hô"
              summary={rulesInvalid ? "Thiếu thông tin" : rulesSummary(f.pronoun_rules)}
              invalid={rulesInvalid}
              open={open.pronouns}
              onOpen={setGroup("pronouns")}
            >
              <div className="field-head">
                <span>Cách xưng hô / gọi nhau</span>
                <InfoTip label="Giải thích Xưng hô">
                  Người nói → người nghe: cách xưng / gọi. VD: Minjun → Seoyeon: {addressPlaceholder(f.target_lang)}.
                </InfoTip>
              </div>
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
                            aria-invalid={invalidRule(i, "speaker")}
                            value={r.speaker}
                            onChange={(e) => setRule(i, { speaker: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="Người nghe"
                            aria-invalid={invalidRule(i, "listener")}
                            value={r.listener}
                            onChange={(e) => setRule(i, { listener: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="Xưng / gọi"
                            aria-invalid={invalidRule(i, "address")}
                            placeholder={addressPlaceholder(f.target_lang)}
                            value={r.address}
                            onChange={(e) => setRule(i, { address: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="Ghi chú"
                            value={r.note}
                            onChange={(e) => setRule(i, { note: e.target.value })}
                          />
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
            </Fold>

            <Fold title="Font khác" summary={fontsSummary} open={open.fonts} onOpen={setGroup("fonts")}>
              <div className="settings-grid">
                {OTHER_FONT_SLOTS.map(({ slot, label, empty }) => (
                  <div key={slot}>
                    <FieldLabel
                      htmlFor={`s-font-${slot}`}
                      tipLabel={`Giải thích font ${label}`}
                      tip={
                        slot === "narration"
                          ? "Áp dụng cho chữ ngoài bóng."
                          : slot === "thought"
                            ? "Chữ trong ngoặc, độc thoại, nói thầm."
                            : "Chữ viết tay, chú thích nhỏ."
                      }
                    >
                      {label}
                    </FieldLabel>
                    {fontSelect(slot, `s-font-${slot}`, empty)}
                  </div>
                ))}
              </div>
            </Fold>

            <Fold
              title="Chữ bỏ qua"
              summary={ignore.error ? "Có lỗi" : countSummary(ignore.list.length, "mục")}
              invalid={!!ignore.error}
              open={open.ignore}
              onOpen={setGroup("ignore")}
            >
              <FieldLabel
                htmlFor="s-ignore"
                tipLabel="Giải thích Chữ bỏ qua"
                tip={
                  <>
                    Mỗi dòng 1 mục. Vùng chữ chứa mục nào thì không dịch, không chèn chữ (chương đã dịch không đổi).
                    Dùng URL hoặc tên nhóm cụ thể — mục chung chung dễ bỏ nhầm thoại. Bỏ qua dấu cách khi so khớp; bọc
                    mục trong dấu / {"(vd /discord\\s*\\.\\s*gg/)"} để dùng regex, không phân biệt hoa/thường.
                  </>
                }
              >
                Chữ bỏ qua (watermark)
              </FieldLabel>
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
              {ignore.error && <span className="small error">{ignore.error}</span>}
              {series.ignore_text.length > 0 && (
                <IgnoreApplySection
                  seriesId={series.id}
                  disabledReason={
                    ignoreRaw !== series.ignore_text.join("\n") ? "Bấm Lưu trước để áp danh sách mới." : null
                  }
                />
              )}
            </Fold>
          </div>
        </form>

        <Fold
          title="Ảnh tự bỏ"
          summary={`${skipImages.data ? countSummary(skipImages.data.images.length, "ảnh") : "…"} · tự lưu, không cần bấm Lưu`}
          open={open.skip}
          onOpen={setGroup("skip")}
        >
          <SkipImagesSection seriesId={series.id} />
        </Fold>
      </div>
    </Drawer>
  );
}

/** Ô xác nhận xoá series (chỉ hiện sau khi bấm "Xoá series"): gõ đúng tên để mở khoá nút, không hoàn tác. */
function DeleteSeriesBox({ series, onCancel }: { series: Series & { chapters?: unknown[] }; onCancel(): void }) {
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
    <section className="danger-zone" aria-label="Xác nhận xoá series">
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
          // biome-ignore lint/a11y/noAutofocus: vừa bấm "Xoá series" → gõ tên ngay
          autoFocus
          onChange={(e) => setTyped(e.target.value)}
        />
        <button
          type="button"
          className="btn-danger-solid"
          disabled={typed.trim() !== series.title.trim() || del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? "Đang xoá…" : "Xoá vĩnh viễn"}
        </button>
        <button type="button" disabled={del.isPending} onClick={onCancel}>
          Huỷ
        </button>
      </div>
      {del.error && <span className="small error">{errorMessage(del.error)}</span>}
    </section>
  );
}
