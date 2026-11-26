/**
 * Modal "Tạo series mới": Tên, Loại truyện (→ định dạng trang), Dịch từ, Sang. Giọng văn, xưng hô, font… chỉnh ở
 * Cài đặt dịch của series sau khi tạo. Nút "+ Series" ở Home: tạo xong → mở màn series. Dòng "Vừa thả" truyền
 * `onCreated`: tạo xong trả series về dòng đó (không điều hướng).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { Drawer } from "../../app/drawer.tsx";
import { type MessageKey, t, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { createSeries, type Series, seriesKeys } from "./api.ts";
import { ComicKindPicker } from "./comic-kind-picker.tsx";
import {
  COMIC_KIND_LABELS,
  COMIC_KIND_SETTINGS,
  type ComicKind,
  defaultTargetLang,
  LANG_NAMES,
  SOURCE_LANGS,
  type SourceLang,
  TARGET_LANGS,
  type TargetLang,
} from "./lang-labels.ts";

const FORMAT_HINT = {
  strip: "series.newSeriesDialog.formatHint.strip",
  pages: "series.newSeriesDialog.formatHint.pages",
} as const satisfies Record<string, MessageKey>;

export function NewSeriesDialog({ onClose, onCreated }: { onClose(): void; onCreated?: (s: Series) => void }) {
  const { locale } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const formId = useId();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ComicKind>("manhwa");
  const [src, setSrc] = useState<SourceLang>(COMIC_KIND_SETTINGS.manhwa.source_lang);
  // Đích mặc định = ngôn ngữ giao diện nếu dịch sang được, không thì tiếng Việt.
  const [tgt, setTgt] = useState<TargetLang>(() => defaultTargetLang(locale));
  const pageFormat = COMIC_KIND_SETTINGS[kind].page_format;
  const create = useMutation({
    mutationFn: () =>
      createSeries({ title: title.trim(), page_format: pageFormat, source_lang: src, target_lang: tgt }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: seriesKeys.list() });
      if (onCreated) onCreated(s);
      else void navigate({ to: "/s/$seriesId", params: { seriesId: s.id } });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() && !create.isPending) create.mutate();
  };

  return (
    <Drawer
      variant="modal"
      title={t("series.newSeriesDialog.title")}
      onClose={onClose}
      footer={
        <div className="settings-foot">
          <div className="settings-foot-row">
            {create.error && <span className="small error">{errorMessage(create.error)}</span>}
            <span className="spacer" />
            <button type="submit" form={formId} className="btn-primary" disabled={create.isPending || !title.trim()}>
              {create.isPending ? t("series.newSeriesDialog.creating") : t("series.newSeriesDialog.create")}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} className="settings-form new-series-dialog" onSubmit={submit}>
        <div>
          <label htmlFor="ns-title">{t("series.newSeriesDialog.name")}</label>
          <input
            id="ns-title"
            data-autofocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="new-series-grid">
          <div>
            <label htmlFor="ns-kind">{t("series.newSeriesDialog.kind")}</label>
            <ComicKindPicker id="ns-kind" value={kind} onChange={setKind} />
          </div>
          <div>
            <label htmlFor="ns-src">{t("series.newSeriesDialog.source")}</label>
            <select id="ns-src" value={src} onChange={(e) => setSrc(e.target.value as SourceLang)}>
              {SOURCE_LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ns-tgt">{t("series.newSeriesDialog.target")}</label>
            <select id="ns-tgt" value={tgt} onChange={(e) => setTgt(e.target.value as TargetLang)}>
              {TARGET_LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="hint">
          {t("series.newSeriesDialog.hint", { kind: COMIC_KIND_LABELS[kind], format: t(FORMAT_HINT[pageFormat]) })}
        </p>
      </form>
    </Drawer>
  );
}
