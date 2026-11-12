/**
 * Modal "Tạo series mới": Tên, Loại truyện (→ định dạng trang), Dịch từ, Sang. Giọng văn, xưng hô, font… chỉnh ở
 * Cài đặt dịch của series sau khi tạo. Nút "+ Series" ở Home: tạo xong → mở màn series. Dòng "Vừa thả" truyền
 * `onCreated`: tạo xong trả series về dòng đó (không điều hướng).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { Drawer } from "../../app/drawer.tsx";
import { errorMessage } from "../../lib/api.ts";
import { createSeries, type Series, seriesKeys } from "./api.ts";
import { ComicKindPicker } from "./comic-kind-picker.tsx";
import {
  COMIC_KIND_LABELS,
  COMIC_KIND_SETTINGS,
  type ComicKind,
  LANG_NAMES,
  SOURCE_LANGS,
  type SourceLang,
  TARGET_LANGS,
  type TargetLang,
} from "./lang-labels.ts";

const FORMAT_HINT = { strip: "cuộn dọc, ảnh dài tự cắt thành trang", pages: "mỗi ảnh là một trang" } as const;

export function NewSeriesDialog({ onClose, onCreated }: { onClose(): void; onCreated?: (s: Series) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const formId = useId();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ComicKind>("manhwa");
  const [src, setSrc] = useState<SourceLang>(COMIC_KIND_SETTINGS.manhwa.source_lang);
  const [tgt, setTgt] = useState<TargetLang>("vi");
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
      title="Tạo series mới"
      onClose={onClose}
      footer={
        <div className="settings-foot">
          <div className="settings-foot-row">
            {create.error && <span className="small error">{errorMessage(create.error)}</span>}
            <span className="spacer" />
            <button type="submit" form={formId} className="btn-primary" disabled={create.isPending || !title.trim()}>
              {create.isPending ? "Đang tạo…" : "Tạo series"}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} className="settings-form new-series-dialog" onSubmit={submit}>
        <div>
          <label htmlFor="ns-title">Tên series</label>
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
            <label htmlFor="ns-kind">Loại truyện</label>
            <ComicKindPicker id="ns-kind" value={kind} onChange={setKind} />
          </div>
          <div>
            <label htmlFor="ns-src">Dịch từ</label>
            <select id="ns-src" value={src} onChange={(e) => setSrc(e.target.value as SourceLang)}>
              {SOURCE_LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ns-tgt">Sang</label>
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
          {COMIC_KIND_LABELS[kind]}: {FORMAT_HINT[pageFormat]}. Font, giọng văn, xưng hô chỉnh ở Cài đặt dịch của series
          sau khi tạo.
        </p>
      </form>
    </Drawer>
  );
}
