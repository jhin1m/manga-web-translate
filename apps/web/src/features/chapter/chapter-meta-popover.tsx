/**
 * Tên chương trên thanh trên bấm được → popover đổi series (select) / số chương (input) → PATCH chương. Thả file tự
 * tạo chương theo series/số đoán được; sai thì sửa ở đây. Đổi series → URL màn chương đổi theo (route chứa seriesId).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { fetchSeriesList, seriesKeys } from "../series/api.ts";
import { type ChapterDetail, chapterKeys, patchChapter } from "./api.ts";

const NUMBER_RE = /^\d+(\.\d+)?$/;

export function ChapterMetaPopover(props: {
  detail: ChapterDetail | undefined;
  /** Series đổi → điều hướng sang URL mới. */
  onMoved(seriesId: string): void;
}) {
  const { detail } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = `Chương ${detail?.number ?? "…"}${detail?.title ? ` · ${detail.title}` : ""}`;

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
          title="Đổi series / số chương"
          disabled={!detail}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
        </button>
      </h1>
      {open && detail && <MetaForm detail={detail} onClose={() => setOpen(false)} onMoved={props.onMoved} />}
    </div>
  );
}

function MetaForm(props: { detail: ChapterDetail; onClose(): void; onMoved(seriesId: string): void }) {
  const { detail } = props;
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: seriesKeys.list(), queryFn: () => fetchSeriesList() });
  const [seriesId, setSeriesId] = useState(detail.series.id);
  const [number, setNumber] = useState(detail.number);
  const save = useMutation({
    mutationFn: () =>
      patchChapter(detail.id, {
        number,
        ...(seriesId !== detail.series.id ? { series_id: seriesId } : {}),
      }),
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !save.isPending) save.mutate();
  };

  return (
    <form
      className="cw-meta-pop"
      role="dialog"
      aria-label="Đổi series / số chương"
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
      {!valid && <span className="small error">Số chương phải là số, VD 13 hoặc 13.5.</span>}
      {save.error && <span className="small error">{errorMessage(save.error)}</span>}
      <div className="row">
        <button type="button" onClick={props.onClose}>
          Huỷ
        </button>
        <button type="submit" className="btn-primary" disabled={!valid || save.isPending}>
          Lưu
        </button>
      </div>
    </form>
  );
}
