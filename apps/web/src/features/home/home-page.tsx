/**
 * Home của workspace, từ trên xuống: vùng thả lớn (thả bất kỳ đâu trên trang cũng được; đoán được series → tạo
 * chương + tự dịch + mở màn chương, không thì dòng xác nhận inline) → danh sách series (tìm, "+ Series mới"; bấm cả
 * hàng để mở series).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { needsWork, nextAction } from "../chapter/next-action.ts";
import { createSeries, fetchSeriesList, type SeriesListItem, seriesKeys } from "../series/api.ts";
import { DropZone, usePageDrop } from "../upload/drop-zone.tsx";
import { normalizeName } from "../upload/parse-chapter-filename.ts";
import { useDropToTranslate } from "./drop-to-translate.ts";
import { NewChapterConfirmRow } from "./new-chapter-confirm-row.tsx";
import "./home.css";

type Pending = { files: File[]; seriesId?: string; seq: number };

export function HomePage({ ws }: { ws: string }) {
  const seriesQ = useQuery({ queryKey: seriesKeys.list(ws), queryFn: () => fetchSeriesList(ws) });
  const [pending, setPending] = useState<Pending | null>(null);
  const auto = useDropToTranslate(ws, (files, seriesId) =>
    setPending((p) => ({ files, seriesId, seq: (p?.seq ?? 0) + 1 })),
  );
  const drop = (files: File[], seriesId?: string) => {
    setPending(null);
    auto.mutate({ files, seriesId });
  };
  usePageDrop((files) => drop(files));
  const series = seriesQ.data?.series;

  return (
    <main className="home">
      <DropZone
        label="Tạo chương mới"
        title="Thả strip hoặc ZIP của chương mới vào đây"
        hint="Thả ảnh/ZIP — tự tạo chương và dịch ngay (series, số chương đoán từ tên file; sửa được trên màn chương)."
        onFiles={(f) => drop(f)}
      />
      {auto.isPending && (
        <p className="small muted" role="status">
          Đang tạo chương…
        </p>
      )}
      {auto.error && <p className="notice danger">{errorMessage(auto.error)}</p>}
      {pending && series && (
        <NewChapterConfirmRow
          key={pending.seq}
          ws={ws}
          files={pending.files}
          series={series}
          fixedSeriesId={pending.seriesId}
          onCancel={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      )}
      <SeriesRows ws={ws} series={series} error={seriesQ.error} />
    </main>
  );
}

function SeriesRows(props: { ws: string; series: SeriesListItem[] | undefined; error: unknown }) {
  const { ws } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => createSeries(ws, { title: title.trim() }),
    onSuccess: (s) => {
      setTitle("");
      setAdding(false);
      void qc.invalidateQueries({ queryKey: seriesKeys.list(ws) });
      void navigate({ to: "/w/$ws/s/$seriesId", params: { ws, seriesId: s.id } });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };
  const needle = normalizeName(search);
  const list = (props.series ?? []).filter((s) => !needle || normalizeName(s.title).includes(needle));

  return (
    <section aria-label="Series" className="block">
      <div className="block-head">
        <h2>Series</h2>
        {props.series && <span className="muted small">{props.series.length}</span>}
        <span className="spacer" />
        <input
          type="search"
          aria-label="Tìm series"
          placeholder="Tìm series…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {adding ? (
          <form className="row" onSubmit={submit}>
            <input
              className="inline-new"
              aria-label="Tên series mới"
              placeholder="Tên series mới"
              // biome-ignore lint/a11y/noAutofocus: vừa bấm "+ Series mới" → gõ tên ngay
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            />
            <button type="submit" className="btn-primary" disabled={create.isPending || !title.trim()}>
              Tạo series
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Huỷ
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)}>
            + Series mới
          </button>
        )}
      </div>
      {(props.error || create.error) && <p className="notice danger">{errorMessage(props.error ?? create.error)}</p>}
      <div className="rows">
        {props.series && list.length === 0 && (
          <div className="rows-empty">
            {search
              ? "Không có series nào khớp."
              : "Chưa có series nào — bấm “+ Series mới”, hoặc thả ảnh ở trên rồi chọn series."}
          </div>
        )}
        {list.map((s) => (
          <SeriesRow key={s.id} ws={ws} s={s} />
        ))}
      </div>
    </section>
  );
}

function SeriesRow({ ws, s }: { ws: string; s: SeriesListItem }) {
  const latest = s.latest_chapter;
  const a = latest ? nextAction(latest) : null;
  const state =
    !latest || !a ? "Chưa có chương" : needsWork(latest) ? `Ch.${latest.number} · ${a.state}` : "Đã xuất hết";
  const tone = !latest || !a ? "idle" : needsWork(latest) ? a.tone : "ok";
  return (
    <Link className="row-item row-link" to="/w/$ws/s/$seriesId" params={{ ws, seriesId: s.id }}>
      <span className="cover" aria-hidden="true">
        {s.title.trim().charAt(0).toUpperCase()}
      </span>
      <span className="row-title">
        <span className="row-name">{s.title}</span>
        <span className="row-sub">
          {s.chapter_count} chương · {s.exported_count ?? 0} đã xuất
        </span>
      </span>
      <span className="grow row small">
        <span className="dot" data-tone={tone} />
        {state}
      </span>
      <Chevron />
    </Link>
  );
}

const Chevron = () => (
  <svg
    className="row-chevron"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);
