/**
 * Home, từ trên xuống: vùng thả lớn (thả bất kỳ đâu trên trang cũng được; đoán được series → tạo
 * chương + tự dịch + mở màn chương, không thì dòng xác nhận inline) → danh sách series (tìm, "+ Series mới"; bấm
 * hàng để mở series, icon Sửa → cài đặt series, icon Xoá → xác nhận tại chỗ rồi xoá cả series).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { needsWork, nextAction } from "../chapter/next-action.ts";
import { createSeries, deleteSeries, fetchSeriesList, type SeriesListItem, seriesKeys } from "../series/api.ts";
import { ComicKindPicker } from "../series/comic-kind-picker.tsx";
import { COMIC_KIND_SETTINGS, type ComicKind } from "../series/lang-labels.ts";
import { DropZone, usePageDrop } from "../upload/drop-zone.tsx";
import { normalizeName } from "../upload/parse-chapter-filename.ts";
import { useDropToTranslate } from "./drop-to-translate.ts";
import { NewChapterConfirmRow } from "./new-chapter-confirm-row.tsx";
import { PencilIcon, TrashIcon } from "./row-icons.tsx";
import "./home.css";

type Pending = { files: File[]; seriesId?: string; seq: number };

export function HomePage() {
  const seriesQ = useQuery({ queryKey: seriesKeys.list(), queryFn: () => fetchSeriesList() });
  const [pending, setPending] = useState<Pending | null>(null);
  const auto = useDropToTranslate((files, seriesId) =>
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
          files={pending.files}
          series={series}
          fixedSeriesId={pending.seriesId}
          onCancel={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      )}
      <SeriesRows series={series} error={seriesQ.error} />
    </main>
  );
}

function SeriesRows(props: { series: SeriesListItem[] | undefined; error: unknown }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ComicKind>("manhwa");
  const create = useMutation({
    mutationFn: () => createSeries({ title: title.trim(), ...COMIC_KIND_SETTINGS[kind] }),
    onSuccess: (s) => {
      setTitle("");
      setAdding(false);
      void qc.invalidateQueries({ queryKey: seriesKeys.list() });
      void navigate({ to: "/s/$seriesId", params: { seriesId: s.id } });
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
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}>
            + Series mới
          </button>
        )}
      </div>
      {adding && (
        // Khối riêng dưới tiêu đề (không chen vào hàng tìm kiếm): tên → loại truyện → Tạo. Esc ở bất kỳ ô nào = Huỷ.
        <form
          className="new-series"
          aria-label="Tạo series mới"
          onSubmit={submit}
          onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
        >
          <label className="new-series-field">
            Tên series
            <input
              placeholder="VD: Solo Leveling"
              // biome-ignore lint/a11y/noAutofocus: vừa bấm "+ Series mới" → gõ tên ngay
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="new-series-field">
            Loại truyện
            <ComicKindPicker value={kind} onChange={setKind} />
          </div>
          <div className="new-series-actions">
            <button type="submit" className="btn-primary" disabled={create.isPending || !title.trim()}>
              {create.isPending ? "Đang tạo…" : "Tạo series"}
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Huỷ
            </button>
          </div>
        </form>
      )}
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
          <SeriesRow key={s.id} s={s} />
        ))}
      </div>
    </section>
  );
}

function SeriesRow({ s }: { s: SeriesListItem }) {
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const latest = s.latest_chapter;
  const a = latest ? nextAction(latest) : null;
  const state =
    !latest || !a ? "Chưa có chương" : needsWork(latest) ? `Ch.${latest.number} · ${a.state}` : "Đã xuất hết";
  const tone = !latest || !a ? "idle" : needsWork(latest) ? a.tone : "ok";
  return (
    <div className="row-item" data-series={s.id}>
      <Link className="row-open" to="/s/$seriesId" params={{ seriesId: s.id }}>
        <span className="cover" aria-hidden="true">
          {s.title.trim().charAt(0).toUpperCase()}
        </span>
        <span className="row-title">
          <span className="row-name" title={s.title}>
            {s.title}
          </span>
          <span className="row-sub">
            {s.chapter_count} chương · {s.exported_count ?? 0} đã xuất
          </span>
        </span>
        <span className="grow row small">
          <span className="dot" data-tone={tone} />
          {state}
        </span>
      </Link>
      {confirming ? (
        <DeleteSeriesConfirm
          s={s}
          onDone={() => setConfirming(false)}
          onError={(text) => {
            setConfirming(false);
            setMsg(text);
          }}
        />
      ) : (
        <>
          <Link
            className="btn icon-btn"
            to="/s/$seriesId"
            params={{ seriesId: s.id }}
            search={{ tab: "settings" }}
            aria-label={`Sửa series ${s.title}`}
            title="Sửa series"
          >
            <PencilIcon />
          </Link>
          <button
            type="button"
            className="icon-btn"
            data-danger
            aria-label={`Xoá series ${s.title}`}
            title="Xoá series"
            onClick={() => {
              setMsg(null);
              setConfirming(true);
            }}
          >
            <TrashIcon />
          </button>
        </>
      )}
      {msg && <div className="row-error">{msg}</div>}
    </div>
  );
}

/** Xác nhận tại chỗ: xoá series cùng mọi chương + glossary riêng (không hoàn tác). */
function DeleteSeriesConfirm(props: { s: SeriesListItem; onDone: () => void; onError: (text: string) => void }) {
  const { s } = props;
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteSeries(s.id),
    onSuccess: () => {
      props.onDone();
      qc.removeQueries({ queryKey: seriesKeys.detail(s.id) });
      void qc.invalidateQueries({ queryKey: seriesKeys.list() });
    },
    onError: (e) =>
      props.onError(
        e instanceof ApiError && e.status === 423
          ? "Một chương của series này đang mở để sửa ở một tab — đóng tab đó rồi xoá."
          : errorMessage(e),
      ),
  });
  return (
    <div className="row delete-confirm" role="alertdialog" aria-label={`Xác nhận xoá series ${s.title}`}>
      <span className="small">
        Xoá hẳn series <b>{s.title}</b>
        {s.chapter_count > 0 ? ` cùng ${s.chapter_count} chương (ảnh, bản dịch, lịch sử)` : ""} và glossary riêng?
      </span>
      <button
        type="button"
        className="btn-danger-solid"
        disabled={del.isPending}
        // biome-ignore lint/a11y/noAutofocus: vừa bấm xoá → Enter xác nhận, Esc/Tab sang Huỷ
        autoFocus
        onClick={() => del.mutate()}
      >
        {del.isPending ? "Đang xoá…" : "Xoá series"}
      </button>
      <button type="button" disabled={del.isPending} onClick={props.onDone}>
        Huỷ
      </button>
    </div>
  );
}
