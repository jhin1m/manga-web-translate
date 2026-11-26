/**
 * Cài đặt dịch của series (modal ở `?tab=settings`): bốn nhóm có icon — Series (tên, ảnh bìa, cặp ngôn ngữ, định dạng),
 * Hướng dẫn cho AI (Giọng văn, Kính ngữ, Xưng hô, dòng Glossary mở modal glossary; gập sẵn mỗi lần mở modal vì AI ghi
 * thêm theo từng chương nên dài dần, khi gập hiện tóm tắt; cả đầu thẻ bấm được), Font chữ, Bỏ qua khi dịch (Chữ bỏ qua, Ảnh tự bỏ). Không có nút Lưu: mỗi trường tự lưu (`use-settings-autosave.ts`), trạng thái "Đang lưu… /
 * Đã lưu / lỗi" ở đáy cạnh link đỏ "Xoá series" (bấm mới hiện ô gõ tên). Ô chữ lưu khi rời ô, hàng xưng hô lưu khi rời
 * hàng (hàng thiếu ô tô đỏ, không lưu). Ảnh bìa / Ảnh tự bỏ gọi API riêng ngay khi thao tác. Mục AI ghi có chip "AI";
 * bản series mới (AI vừa ghi khi dịch) hiện vào trường người dùng không đang sửa.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AiTag } from "../../app/ai-tag.tsx";
import { Drawer } from "../../app/drawer.tsx";
import { BookIcon, EyeOffIcon, SparklesIcon, TypeIcon } from "../../app/settings-icons.tsx";
import { t, tNode, tp, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { SaveStatus, SetGroup } from "../admin/settings-ui.tsx";
import { fetchGlossary, glossaryKey } from "../glossary/api.ts";
import { deleteSeries, type PronounRuleInput, type Series, seriesKeys } from "./api.ts";
import { CoverSection } from "./cover-section.tsx";
import { IgnoreApplySection } from "./ignore-apply-section.tsx";
import { parseIgnoreText } from "./ignore-text-input.ts";
import {
  addressPlaceholder,
  HONORIFIC_EXAMPLES,
  LANG_NAMES,
  langChangeWarning,
  PAGE_FORMAT_LABELS,
  PAGE_FORMATS,
  SOURCE_LANGS,
  TARGET_LANGS,
} from "./lang-labels.ts";
import { PronounRulesTable } from "./pronoun-rules-table.tsx";
import { SeriesFontFields } from "./series-font-fields.tsx";
import { aiGuideSummary, type Draft, ruleComplete } from "./settings-draft.ts";
import { SettingsRow } from "./settings-row.tsx";
import { SkipImagesSection } from "./skip-images-section.tsx";
import { useSettingsAutosave } from "./use-settings-autosave.ts";
import "../admin/admin.css";

export function SeriesSettingsDialog({
  series,
  onClose,
}: {
  series: Series & { chapters?: unknown[] };
  onClose(): void;
}) {
  useT();
  const { draft: f, set, commit, leave, rulesChecked, setRulesChecked, status } = useSettingsAutosave(series);
  const glossaryScope = { seriesId: series.id };
  const glossary = useQuery({ queryKey: glossaryKey(glossaryScope), queryFn: () => fetchGlossary(glossaryScope) });
  const terms = glossary.data?.entries.length;
  // Cảnh báo so với cặp lúc mở modal: cặp mới lưu ngay nên so với bản server thì cảnh báo biến mất tức thì.
  const opened = useRef({ source_lang: series.source_lang, target_lang: series.target_lang });
  const langWarning = langChangeWarning(opened.current, f, terms);
  const ignore = parseIgnoreText(f.ignore_text);
  const rulesInvalid = rulesChecked && !f.pronoun_rules.every(ruleComplete);
  const [deleting, setDeleting] = useState(false);

  const select =
    <K extends "source_lang" | "target_lang" | "page_format" | "honorific_policy">(k: K) =>
    (e: { target: { value: string } }) =>
      set(k, e.target.value as Draft[K], "now");
  // Sửa hàng = người dùng xác nhận → bỏ chip AI ngay (server tính lại `origin` khi lưu).
  const editRule = (i: number, patch: Partial<PronounRuleInput>) =>
    set(
      "pronoun_rules",
      f.pronoun_rules.map((r, j) => (j === i ? { ...r, ...patch, origin: "user" as const } : r)),
      "later",
    );

  return (
    <Drawer
      variant="modal"
      title={t("series.settingsForm.title")}
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
              {t("series.settingsForm.deleteSeries")}
            </button>
            <span className="spacer" />
            <SaveStatus {...status} />
          </div>
        </div>
      }
    >
      <div className="settings-dialog">
        <SetGroup title="Series" icon={<BookIcon />}>
          <SettingsRow label={t("series.settingsForm.name")} htmlFor="s-title">
            <input
              id="s-title"
              data-field="title"
              required
              aria-invalid={f.title.trim() ? undefined : true}
              value={f.title}
              onChange={(e) => set("title", e.target.value, "later")}
              onBlur={() => leave("title")}
            />
            {!f.title.trim() && <span className="small error">{t("series.settingsForm.nameRequired")}</span>}
          </SettingsRow>
          <SettingsRow label={t("series.settingsForm.cover")}>
            <CoverSection series={series} />
          </SettingsRow>
          <SettingsRow label={t("series.settingsForm.languages")}>
            <div className="lang-pair">
              <select
                aria-label={t("series.settingsForm.source")}
                value={f.source_lang}
                onChange={select("source_lang")}
              >
                {SOURCE_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l]}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">→</span>
              <select
                aria-label={t("series.settingsForm.target")}
                value={f.target_lang}
                onChange={select("target_lang")}
              >
                {TARGET_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l]}
                  </option>
                ))}
              </select>
            </div>
            {langWarning && (
              <p className="notice small" role="status">
                {langWarning}
              </p>
            )}
          </SettingsRow>
          <SettingsRow
            label={t("series.settingsForm.format")}
            htmlFor="s-fmt"
            tip={t("series.settingsForm.formatTip")}
            tipLabel={t("series.settingsForm.formatTipLabel")}
          >
            <select id="s-fmt" value={f.page_format} onChange={select("page_format")}>
              {PAGE_FORMATS.map((p) => (
                <option key={p} value={p}>
                  {PAGE_FORMAT_LABELS[p]}
                </option>
              ))}
            </select>
          </SettingsRow>
        </SetGroup>

        <SetGroup
          title={t("series.settingsForm.aiGuide")}
          icon={<SparklesIcon />}
          collapsible
          summary={aiGuideSummary(f, terms)}
          tip={t("series.settingsForm.aiGuideTip")}
        >
          <SettingsRow
            label={t("series.settingsForm.style")}
            htmlFor="s-style"
            stack
            // Chip khi Giọng văn đang hiện đúng là bản AI ghi (chưa sửa).
            tag={series.style_origin === "ai" && f.style_prompt === series.style_prompt && <AiTag />}
            tip={t("series.settingsForm.styleTip")}
            tipLabel={t("series.settingsForm.styleTipLabel")}
          >
            <textarea
              id="s-style"
              data-field="style_prompt"
              maxLength={1000}
              placeholder={t("series.settingsForm.stylePlaceholder")}
              value={f.style_prompt}
              onChange={(e) => set("style_prompt", e.target.value, "later")}
              onBlur={() => leave("style_prompt")}
            />
          </SettingsRow>
          <SettingsRow
            label={t("series.settingsForm.honorifics")}
            htmlFor="s-hon"
            tip={t("series.settingsForm.honorificsTip", { examples: HONORIFIC_EXAMPLES[f.source_lang] })}
            tipLabel={t("series.settingsForm.honorificsTipLabel")}
          >
            <select id="s-hon" value={f.honorific_policy} onChange={select("honorific_policy")}>
              <option value="translate">{t("series.settingsForm.honorificsTranslate")}</option>
              <option value="keep">{t("series.settingsForm.honorificsKeep")}</option>
            </select>
          </SettingsRow>
          <SettingsRow
            label={t("series.settingsForm.address")}
            stack
            tip={t("series.settingsForm.addressTip", { example: addressPlaceholder(f.target_lang) })}
            tipLabel={t("series.settingsForm.addressTipLabel")}
          >
            <PronounRulesTable
              rules={f.pronoun_rules}
              targetLang={f.target_lang}
              invalid={rulesInvalid}
              onEdit={editRule}
              onRemove={(i) =>
                set(
                  "pronoun_rules",
                  f.pronoun_rules.filter((_, j) => j !== i),
                  "now",
                )
              }
              onAdd={() => {
                setRulesChecked(false);
                set(
                  "pronoun_rules",
                  [...f.pronoun_rules, { speaker: "", listener: "", address: "", note: "", origin: "user" }],
                  "later",
                );
              }}
              onRowLeave={() => commit("pronoun_rules")}
              onLeave={() => leave("pronoun_rules")}
            />
          </SettingsRow>
          <SettingsRow label="Glossary">
            <span className="glossary-line">
              {terms === undefined ? "…" : tp("series.settingsDraft.terms", terms)} ·{" "}
              <Link to="/s/$seriesId" params={{ seriesId: series.id }} search={{ tab: "glossary" }}>
                {t("series.settingsForm.openGlossary")}
              </Link>
            </span>
          </SettingsRow>
        </SetGroup>

        <SetGroup title={t("series.settingsForm.fonts")} icon={<TypeIcon />}>
          <SeriesFontFields
            fonts={f.default_fonts}
            targetLang={f.target_lang}
            onChange={(next) => set("default_fonts", next, "now")}
          />
        </SetGroup>

        <SetGroup title={t("series.settingsForm.skip")} icon={<EyeOffIcon />}>
          <SettingsRow
            label={t("series.settingsForm.ignore")}
            htmlFor="s-ignore"
            stack
            tipLabel={t("series.settingsForm.ignoreTipLabel")}
            tip={t("series.settingsForm.ignoreTip", { example: "/discord\\s*\\.\\s*gg/" })}
          >
            <textarea
              id="s-ignore"
              data-field="ignore_text"
              placeholder={t("series.settingsForm.ignorePlaceholder")}
              value={f.ignore_text}
              aria-invalid={ignore.error ? true : undefined}
              onChange={(e) => set("ignore_text", e.target.value, "later")}
              onBlur={() => leave("ignore_text")}
            />
            {ignore.error && <span className="small error">{ignore.error}</span>}
            {series.ignore_text.length > 0 && (
              <IgnoreApplySection
                seriesId={series.id}
                disabledReason={
                  ignore.list.join("\n") === series.ignore_text.join("\n") ? null : t("series.settingsForm.waitSave")
                }
              />
            )}
          </SettingsRow>
          <SettingsRow
            label={t("series.settingsForm.skipImages")}
            stack
            tipLabel={t("series.settingsForm.skipImagesTipLabel")}
            tip={t("series.settingsForm.skipImagesTip")}
          >
            <SkipImagesSection seriesId={series.id} />
          </SettingsRow>
        </SetGroup>
      </div>
    </Drawer>
  );
}

/** Ô xác nhận xoá series (chỉ hiện sau khi bấm "Xoá series"): gõ đúng tên để mở khoá nút, không hoàn tác. */
function DeleteSeriesBox({ series, onCancel }: { series: Series & { chapters?: unknown[] }; onCancel(): void }) {
  useT();
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
    <section className="danger-zone" aria-label={t("series.settingsForm.confirmDelete")}>
      <p className="small">
        {n > 0
          ? tNode("series.settingsForm.deleteWarn", {
              title: <b>{series.title}</b>,
              chapters: tp("series.ignoreApplyModel.chapters", n),
            })
          : tNode("series.settingsForm.deleteWarnEmpty", { title: <b>{series.title}</b> })}
      </p>
      <label htmlFor="s-delete">{t("series.settingsForm.typeName")}</label>
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
          {del.isPending ? t("series.settingsForm.deleting") : t("series.settingsForm.deleteForever")}
        </button>
        <button type="button" disabled={del.isPending} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
      {del.error && <span className="small error">{errorMessage(del.error)}</span>}
    </section>
  );
}
