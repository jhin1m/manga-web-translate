/**
 * Tên chương ("Ch.12") trên thanh trên bấm được → popover đổi series (select) / số chương (input) → PATCH chương.
 * Thả file tự tạo chương theo series/số đoán được; sai thì sửa ở đây. Đổi series → URL màn chương đổi theo (route chứa
 * seriesId). Chip ngôn ngữ ("🌐 Hàn → Việt") cạnh tên là nút riêng → popover chỉ có ngôn ngữ gốc + đích của series
 * (PATCH series) — tách khỏi form tên chương cho dễ thấy: ngôn ngữ gốc sai làm OCR bỏ trống khối có chữ.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { fetchSeriesList, patchSeries, type Series, seriesKeys } from "../series/api.ts";
import { pairLabel } from "../series/lang-labels.ts";
import { type ChapterDetail, chapterKeys, patchChapter } from "./api.ts";
import { LangPairFields } from "./lang-pair-fields.tsx";
import { GlobeIcon } from "./tool-icons.tsx";

const NUMBER_RE = /^\d+(\.\d+)?$/;

type PopKind = "meta" | "lang";

export function ChapterMetaPopover(props: {
  detail: ChapterDetail | undefined;
  /** Chi tiết series (ngôn ngữ gốc → đích); chưa tải → không có chip ngôn ngữ. */
  series: Series | undefined;
  /** Series đổi → điều hướng sang URL mới. */
  onMoved(seriesId: string): void;
}) {
  const { detail, series } = props;
  const [open, setOpen] = useState<PopKind | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const name = `${detail?.number ?? "…"}${detail?.title ? ` · ${detail.title}` : ""}`;
  const toggle = (k: PopKind) => setOpen((o) => (o === k ? null : k));
  const close = () => setOpen(null);

  // Bấm ra ngoài → đóng.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
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
          aria-expanded={open === "meta"}
          aria-haspopup="dialog"
          aria-label={`Chương ${name}`}
          title={`Chương ${name} — đổi series / số chương`}
          disabled={!detail}
          onClick={() => toggle("meta")}
        >
          Ch.{name}
        </button>
      </h1>
      {series && detail && (
        <button
          type="button"
          className="cw-lang-chip"
          aria-expanded={open === "lang"}
          aria-haspopup="dialog"
          aria-label={`Ngôn ngữ ${pairLabel(series)} — đổi ngôn ngữ`}
          title="Ngôn ngữ gốc (chữ trên ảnh) → ngôn ngữ dịch của series — bấm để đổi"
          onClick={() => toggle("lang")}
        >
          <GlobeIcon size={14} />
          {pairLabel(series)}
        </button>
      )}
      {open === "meta" && detail && <MetaForm detail={detail} onClose={close} onMoved={props.onMoved} />}
      {open === "lang" && series && <LangForm series={series} onClose={close} />}
    </div>
  );
}

/** Khung popover chung: form + Esc đóng + hàng Huỷ / Lưu. */
function PopForm(props: {
  label: string;
  canSave: boolean;
  error: unknown;
  onSubmit(): void;
  onClose(): void;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (props.canSave) props.onSubmit();
  };
  return (
    <form
      className="cw-meta-pop"
      role="dialog"
      aria-label={props.label}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      {props.children}
      {props.error ? <span className="small error">{errorMessage(props.error)}</span> : null}
      <div className="row">
        <button type="button" onClick={props.onClose}>
          Huỷ
        </button>
        <button type="submit" className="btn-primary" disabled={!props.canSave}>
          Lưu
        </button>
      </div>
    </form>
  );
}

function MetaForm(props: { detail: ChapterDetail; onClose(): void; onMoved(seriesId: string): void }) {
  const { detail } = props;
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: seriesKeys.list(), queryFn: () => fetchSeriesList() });
  const [seriesId, setSeriesId] = useState(detail.series.id);
  const [number, setNumber] = useState(detail.number);
  const moving = seriesId !== detail.series.id;
  const changed = moving || number !== detail.number;
  const save = useMutation({
    mutationFn: () => patchChapter(detail.id, { number, ...(moving ? { series_id: seriesId } : {}) }),
    onSuccess: (ch) => {
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

  return (
    <PopForm
      label="Đổi series / số chương"
      canSave={valid && changed && !save.isPending}
      error={save.error}
      onSubmit={() => save.mutate()}
      onClose={props.onClose}
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
      {!valid && <span className="small error">Số chương phải là số, VD 13 hoặc 13.5.</span>}
    </PopForm>
  );
}

function LangForm(props: { series: Series; onClose(): void }) {
  const { series } = props;
  const qc = useQueryClient();
  const [src, setSrc] = useState(series.source_lang);
  const [tgt, setTgt] = useState(series.target_lang);
  const changed = src !== series.source_lang || tgt !== series.target_lang;
  const save = useMutation({
    mutationFn: () => patchSeries(series.id, { source_lang: src, target_lang: tgt }),
    onSuccess: () => {
      // Chi tiết series (editor + màn series) nằm dưới ["series"]; glossary chung theo cặp → làm mới luôn.
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["glossary"] });
      props.onClose();
    },
  });

  return (
    <PopForm
      label="Đổi ngôn ngữ"
      canSave={changed && !save.isPending}
      error={save.error}
      onSubmit={() => save.mutate()}
      onClose={props.onClose}
    >
      <LangPairFields src={src} tgt={tgt} onSrc={setSrc} onTgt={setTgt} autoFocus />
    </PopForm>
  );
}
