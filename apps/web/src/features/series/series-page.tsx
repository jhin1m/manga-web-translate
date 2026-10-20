/**
 * Màn series (design Series 20/10/2026): đầu trang, vùng thả "Chương {next}", lọc chip Cần làm/Đã xuất/Tất cả,
 * danh sách chương dạng hàng (1 nút bước tiếp theo), cột phải cài đặt dịch + glossary. `?tab=settings|glossary`
 * mở form cài đặt / glossary đầy đủ.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { timeAgo } from "../../lib/format.ts";
import { ChapterActionButton } from "../chapter/chapter-action-button.tsx";
import { needsWork, nextAction } from "../chapter/next-action.ts";
import { GlossaryEditor } from "../glossary/glossary-editor.tsx";
import { NewChapterConfirmRow } from "../home/new-chapter-confirm-row.tsx";
import { resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { DropZone, useDropTarget, usePageDrop } from "../upload/drop-zone.tsx";
import { uploadManager, useUploads } from "../upload/upload-manager.ts";
import {
  type ChapterRow,
  fetchSeries,
  fetchSeriesList,
  nextChapterNumber,
  type SeriesDetail,
  seriesKeys,
} from "./api.ts";
import { SeriesSettingsForm } from "./series-settings-form.tsx";
import { SeriesSidebar } from "./series-sidebar.tsx";
import "../home/home.css";

export type SeriesTab = "chapters" | "glossary" | "settings";
type Filter = "todo" | "exported" | "all";

const LANG: Record<string, string> = { ko: "Hàn", ja: "Nhật", zh: "Trung", en: "Anh", vi: "Việt" };

const useSeries = (ws: string, seriesId: string) =>
  useQuery({
    queryKey: seriesKeys.detail(ws, seriesId),
    queryFn: () => fetchSeries(ws, seriesId),
    // Trạng thái chương đổi theo worker — làm mới chậm khi còn chương đang chạy.
    refetchInterval: (query) =>
      query.state.data?.chapters.some((c) => c.status === "ingesting" || c.status === "processing") ? 5000 : false,
  });

export function SeriesPage({ ws, seriesId, tab }: { ws: string; seriesId: string; tab?: SeriesTab }) {
  const q = useSeries(ws, seriesId);
  const s = q.data;
  if (tab === "settings" || tab === "glossary") {
    return (
      <div className="page page-narrow">
        <div className="crumbs">
          <Link to="/">Trang chủ</Link> /{" "}
          <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId }}>
            {s?.title ?? "…"}
          </Link>
        </div>
        <div className="page-head">
          <h1>{tab === "settings" ? "Cài đặt series" : "Glossary của series"}</h1>
          {s && tab === "settings" && (
            <span className="muted small mono">
              settings_rev {s.settings_rev} · glossary_rev {s.glossary_rev}
            </span>
          )}
          <span className="spacer" />
          <Link
            className="btn"
            to="/w/$ws/s/$seriesId"
            params={{ ws, seriesId }}
            search={{ tab: tab === "settings" ? "glossary" : "settings" }}
          >
            {tab === "settings" ? "Glossary" : "Cài đặt dịch"}
          </Link>
        </div>
        {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}
        {/* key: dựng lại form khi dữ liệu server đổi rev (sau khi lưu). */}
        {tab === "settings" && s && <SeriesSettingsForm key={`${s.id}:${s.settings_rev}`} ws={ws} series={s} />}
        {tab === "glossary" && <GlossaryEditor ws={ws} seriesId={seriesId} />}
      </div>
    );
  }
  return (
    <div className="series-layout">
      <main className="series-main">
        <div className="crumbs">
          <Link to="/">Trang chủ</Link> / {s?.title ?? "…"}
        </div>
        {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}
        {s && <ChapterList ws={ws} series={s} />}
      </main>
      {s && <SeriesSidebar ws={ws} series={s} />}
    </div>
  );
}

function ChapterList({ ws, series }: { ws: string; series: SeriesDetail }) {
  const listQ = useQuery({ queryKey: seriesKeys.list(ws), queryFn: () => fetchSeriesList(ws) });
  const uploads = useUploads();
  const [filter, setFilter] = useState<Filter>("todo");
  const [pending, setPending] = useState<{ files: File[]; seq: number } | null>(null);
  const drop = (files: File[]) => setPending((p) => ({ files, seq: (p?.seq ?? 0) + 1 }));
  usePageDrop(drop);

  const chapters = series.chapters;
  const next = nextChapterNumber(chapters);
  const exported = chapters.filter((c) => !needsWork(c)).length;
  const todo = chapters.length - exported;
  const shown = chapters.filter((c) => (filter === "all" ? true : filter === "todo" ? needsWork(c) : !needsWork(c)));

  return (
    <>
      <div className="series-head">
        <div className="cover lg" />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1>{series.title}</h1>
          <span className="muted">
            {LANG[series.source_lang]} → {LANG[series.target_lang]} · {chapters.length} chương · {exported} đã xuất
          </span>
        </div>
      </div>

      <DropZone
        size="md"
        label="Thêm chương tiếp theo"
        title={`Thả strip của Chương ${next} vào đây`}
        hint="Số chương tự tăng; thả nhiều file = nhiều chương liên tiếp."
        onFiles={drop}
      />
      {pending && listQ.data && (
        <NewChapterConfirmRow
          key={pending.seq}
          ws={ws}
          files={pending.files}
          series={listQ.data.series}
          fixedSeriesId={series.id}
          defaultNumber={next}
          onCancel={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      )}

      <fieldset className="chips" aria-label="Lọc chương">
        {(
          [
            ["todo", `Cần làm · ${todo}`],
            ["exported", `Đã xuất · ${exported}`],
            ["all", `Tất cả · ${chapters.length}`],
          ] as const
        ).map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </fieldset>

      <div className="rows">
        {shown.length === 0 && (
          <div className="rows-empty">
            {chapters.length === 0 ? "Chưa có chương nào — thả strip ở trên." : "Không có chương nào trong bộ lọc này."}
          </div>
        )}
        {shown.map((c, i) => (
          <ChapterLine key={c.id} ws={ws} ch={c} first={i === 0} upload={uploadManager.view(c.id, uploads[c.id])} />
        ))}
      </div>
      {filter === "todo" && exported > 0 && (
        <div className="small muted">{exported} chương đã xuất ẩn trong bộ lọc "Đã xuất".</div>
      )}
    </>
  );
}

function ChapterLine(props: {
  ws: string;
  ch: ChapterRow;
  first: boolean;
  upload: ReturnType<typeof uploadManager.view>;
}) {
  const { ws, ch } = props;
  const [msg, setMsg] = useState<string | null>(null);
  const a = nextAction(ch, props.upload);
  const params = { ws, seriesId: ch.series_id, chapterId: ch.id };
  // Chương nháp upload dở: thả lại file thẳng vào hàng.
  const target = useDropTarget((files) => {
    setMsg(null);
    resumeFromFiles(ws, ch.id, files).catch((e: unknown) => setMsg(errorMessage(e)));
  });
  const dropProps = a.kind === "resume" ? target.props : {};

  return (
    <div className="row-item" data-chapter={ch.id} data-drop={a.kind === "resume" && target.over} {...dropProps}>
      <div className="ch-num">Ch.{ch.number}</div>
      <div className="ch-body">
        <div className="ch-line">
          <span className="dot" data-tone={a.tone} />
          <span style={{ fontWeight: 500 }}>{a.state}</span>
          <span className="small muted">· {timeAgo(ch.updated_at)}</span>
        </div>
        <div className="ch-line">
          <div className="bar">
            <span data-tone={a.tone} style={{ width: `${Math.round(a.progress * 100)}%` }} />
          </div>
          <span className="small muted">
            {a.detail}
            {a.kind === "resume" ? " · hoặc thả file vào hàng này" : ""}
          </span>
        </div>
      </div>
      <ChapterActionButton ws={ws} chapter={ch} action={a} primary={props.first} onMessage={setMsg} />
      <Link className="small muted" to="/w/$ws/s/$seriesId/c/$chapterId" params={params}>
        Mở
      </Link>
      {msg && <div className="row-error">{msg}</div>}
    </div>
  );
}
