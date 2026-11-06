/**
 * Tên chương ("Ch.12") trên thanh trên bấm được → popover đổi series (select) / số chương (input) / ngôn ngữ gốc +
 * đích của series → PATCH chương và/hoặc series. Thả file tự tạo chương theo series/số đoán được; sai thì sửa ở đây.
 * Đổi series → URL màn chương đổi theo (route chứa seriesId). Ô ngôn ngữ chỉ hiện khi series chưa bị đổi (nó thuộc
 * series hiện tại).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { fetchSeriesList, patchSeries, type Series, seriesKeys } from "../series/api.ts";
import { pairLabel, type SourceLang, type TargetLang } from "../series/lang-labels.ts";
import { type ChapterDetail, chapterKeys, patchChapter } from "./api.ts";
import { LangPairFields } from "./lang-pair-fields.tsx";

const NUMBER_RE = /^\d+(\.\d+)?$/;

export function ChapterMetaPopover(props: {
  detail: ChapterDetail | undefined;
  /** Chi tiết series (ngôn ngữ gốc → đích); chưa tải → popover không có ô ngôn ngữ. */
  series: Series | undefined;
  /** Series đổi → điều hướng sang URL mới. */
  onMoved(seriesId: string): void;
}) {
  const { detail } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = `${detail?.number ?? "…"}${detail?.title ? ` · ${detail.title}` : ""}`;

  // Bấm ra ngoài → đóng.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="cw-meta" ref={ref}>
      <h1 className="cw-title">
        <button
          type="button"
          className="cw-meta-toggle"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Chương ${name}`}
          title={`Chương ${name} — đổi series / số chương / ngôn ngữ${props.series ? ` (${pairLabel(props.series)})` : ""}`}
          disabled={!detail}
          onClick={() => setOpen((o) => !o)}
        >
          Ch.{name}
        </button>
      </h1>
      {open && detail && (
        <MetaForm detail={detail} series={props.series} onClose={() => setOpen(false)} onMoved={props.onMoved} />
      )}
    </div>
  );
}

function MetaForm(props: {
  detail: ChapterDetail;
  series: Series | undefined;
  onClose(): void;
  onMoved(seriesId: string): void;
}) {
  const { detail, series } = props;
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: seriesKeys.list(), queryFn: () => fetchSeriesList() });
  const [seriesId, setSeriesId] = useState(detail.series.id);
  const [number, setNumber] = useState(detail.number);
  const [src, setSrc] = useState<SourceLang | undefined>(series?.source_lang);
  const [tgt, setTgt] = useState<TargetLang | undefined>(series?.target_lang);
  const moving = seriesId !== detail.series.id;
  const chapterChanged = moving || number !== detail.number;
  const langChanged = !!series && !moving && (src !== series.source_lang || tgt !== series.target_lang);
  const save = useMutation({
    mutationFn: async () => {
      if (langChanged && series && src && tgt) {
        await patchSeries(series.id, { source_lang: src, target_lang: tgt });
        // Chi tiết series (editor + màn series) nằm dưới ["series"]; glossary chung theo cặp → làm mới luôn.
        void qc.invalidateQueries({ queryKey: ["series"] });
        void qc.invalidateQueries({ queryKey: ["glossary"] });
      }
      return chapterChanged ? patchChapter(detail.id, { number, ...(moving ? { series_id: seriesId } : {}) }) : null;
    },
    onSuccess: (ch) => {
      if (!ch) return props.onClose();
      const title = listQ.data?.series.find((s) => s.id === ch.series_id)?.title ?? detail.series.title;
      qc.setQueryData<ChapterDetail>(chapterKeys.detail(detail.id), (d) =>
        d ? { ...d, number: ch.number, series_id: ch.series_id, series: { id: ch.series_id, title } } : d,
      );
      // Danh sách series, chi tiết series (cũ + mới) và "Việc cần làm" đều dưới khoá ["series"].
      void qc.invalidateQueries({ queryKey: seriesKeys.list() });
      props.onClose();
      if (ch.series_id !== detail.series.id) props.onMoved(ch.series_id);
    },
  });
  const valid = NUMBER_RE.test(number);
  const changed = chapterChanged || langChanged;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && changed && !save.isPending) save.mutate();
  };

  return (
    <form
      className="cw-meta-pop"
      role="dialog"
      aria-label="Đổi series / số chương / ngôn ngữ"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <label>
        Series
        <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
          {(listQ.data?.series ?? [detail.series]).map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Chương số
        <input
          className="num"
          inputMode="decimal"
          // biome-ignore lint/a11y/noAutofocus: vừa mở popover → sửa số ngay
          autoFocus
          value={number}
          onChange={(e) => setNumber(e.target.value.trim())}
        />
      </label>
      {series && !moving && src && tgt && <LangPairFields src={src} tgt={tgt} onSrc={setSrc} onTgt={setTgt} />}
      {!valid && <span className="small error">Số chương phải là số, VD 13 hoặc 13.5.</span>}
      {save.error && <span className="small error">{errorMessage(save.error)}</span>}
      <div className="row">
        <button type="button" onClick={props.onClose}>
          Huỷ
        </button>
        <button type="submit" className="btn-primary" disabled={!valid || !changed || save.isPending}>
          Lưu
        </button>
      </div>
    </form>
  );
}
