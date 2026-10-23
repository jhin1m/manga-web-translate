/**
 * Màn series: đầu trang + thanh tab (Chương / Glossary / Cài đặt, `?tab=`) dùng chung cho cả 3 tab.
 * Tab Chương: vùng thả "Chương {next}", lọc chip Cần làm/Đã xuất/Tất cả, danh sách chương (bấm cả hàng hoặc icon
 * Sửa để mở — dịch/xuất/chạy lại làm trong màn chương; icon Xoá), cột phải tóm tắt cài đặt dịch + glossary.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { timeAgo } from "../../lib/format.ts";
import { needsWork, nextAction } from "../chapter/next-action.ts";
import { fetchGlossary, glossaryKey } from "../glossary/api.ts";
import { GlossaryEditor } from "../glossary/glossary-editor.tsx";
import { useDropToTranslate } from "../home/drop-to-translate.ts";
import { NewChapterConfirmRow } from "../home/new-chapter-confirm-row.tsx";
import { PencilIcon, TrashIcon } from "../home/row-icons.tsx";
import { resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { DropZone, useDropTarget, usePageDrop } from "../upload/drop-zone.tsx";
import { uploadManager, useUploads } from "../upload/upload-manager.ts";
import {
  type ChapterRow,
  deleteChapter,
  fetchSeries,
  fetchSeriesList,
  nextChapterNumber,
  type SeriesDetail,
  seriesKeys,
} from "./api.ts";
import { langShort, pairLabel } from "./lang-labels.ts";
import { DeleteSeries, SeriesSettingsForm } from "./series-settings-form.tsx";
import { SeriesSidebar } from "./series-sidebar.tsx";
import { SkipImagesSection } from "./skip-images-section.tsx";
import "../home/home.css";

export type SeriesTab = "chapters" | "glossary" | "settings";
type Filter = "todo" | "exported" | "all";

const useSeries = (ws: string, seriesId: string) =>
  useQuery({
    queryKey: seriesKeys.detail(ws, seriesId),
    queryFn: () => fetchSeries(ws, seriesId),
    // Trạng thái chương đổi theo worker — làm mới chậm khi còn chương đang chạy.
    refetchInterval: (query) =>
      query.state.data?.chapters.some((c) => c.status === "ingesting" || c.status === "processing") ? 5000 : false,
  });

export function SeriesPage(props: { ws: string; seriesId: string; tab?: SeriesTab; canDeleteSeries: boolean }) {
  const { ws, seriesId, tab = "chapters" } = props;
  const q = useSeries(ws, seriesId);
  const s = q.data;
  return (
    <div className="series-layout">
      <main className="series-main">
        <div className="crumbs">
          <Link to="/">Trang chủ</Link> / {s?.title ?? "…"}
        </div>
        {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}
        {s && (
          <>
            <SeriesHead series={s} />
            <SeriesTabs ws={ws} series={s} />
            {tab === "chapters" && <ChapterList ws={ws} series={s} />}
            {/* key: dựng lại form khi dữ liệu server đổi rev (sau khi lưu). */}
            {tab === "settings" && (
              <div className="tab-panel">
                <SeriesSettingsForm key={`${s.id}:${s.settings_rev}`} ws={ws} series={s} />
                <SkipImagesSection ws={ws} seriesId={s.id} />
                {props.canDeleteSeries && <DeleteSeries ws={ws} series={s} />}
              </div>
            )}
            {tab === "glossary" && (
              <section aria-label="Glossary của series (đầy đủ)" className="tab-panel">
                <GlossaryEditor ws={ws} scope={{ seriesId }} inheritedLabel={`từ glossary chung (${pairLabel(s)})`} />
              </section>
            )}
          </>
        )}
      </main>
      {s && tab === "chapters" && <SeriesSidebar ws={ws} series={s} />}
    </div>
  );
}

function SeriesHead({ series }: { series: SeriesDetail }) {
  const exported = series.chapters.filter((c) => !needsWork(c)).length;
  return (
    <div className="series-head">
      <div className="cover lg" aria-hidden="true">
        {series.title.trim().charAt(0).toUpperCase()}
      </div>
      <div className="series-head-text">
        <h1 title={series.title}>{series.title}</h1>
        <span className="muted">
          {langShort(series.source_lang)} → {langShort(series.target_lang)} · {series.chapters.length} chương ·{" "}
          {exported} đã xuất
        </span>
      </div>
    </div>
  );
}

/** Tab đang mở do router đánh dấu (`aria-current`), so cả `?tab`. */
function SeriesTabs({ ws, series }: { ws: string; series: SeriesDetail }) {
  const scope = { seriesId: series.id };
  const glossary = useQuery({ queryKey: glossaryKey(ws, scope), queryFn: () => fetchGlossary(ws, scope) });
  const terms = glossary.data?.entries.length;
  const tabs: [SeriesTab, string][] = [
    ["chapters", `Chương · ${series.chapters.length}`],
    ["glossary", terms === undefined ? "Glossary" : `Glossary · ${terms}`],
    ["settings", "Cài đặt dịch"],
  ];
  return (
    <nav className="tabs" aria-label="Mục của series">
      {tabs.map(([t, label]) => (
        <Link
          key={t}
          to="/w/$ws/s/$seriesId"
          params={{ ws, seriesId: series.id }}
          search={t === "chapters" ? {} : { tab: t }}
          // So cả `?tab` (mặc định router chỉ so path → tab Chương luôn "active").
          activeOptions={{ exact: true, includeSearch: true }}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function ChapterList({ ws, series }: { ws: string; series: SeriesDetail }) {
  const listQ = useQuery({ queryKey: seriesKeys.list(ws), queryFn: () => fetchSeriesList(ws) });
  const uploads = useUploads();
  const [filter, setFilter] = useState<Filter>("todo");
  const [pending, setPending] = useState<{ files: File[]; seq: number } | null>(null);
  const auto = useDropToTranslate(ws, (files) => setPending((p) => ({ files, seq: (p?.seq ?? 0) + 1 })));
  const drop = (files: File[]) => {
    setPending(null);
    auto.mutate({ files, seriesId: series.id });
  };
  usePageDrop(drop);

  const chapters = series.chapters;
  const next = nextChapterNumber(chapters);
  const exported = chapters.filter((c) => !needsWork(c)).length;
  const todo = chapters.length - exported;
  const shown = chapters.filter((c) => (filter === "all" ? true : filter === "todo" ? needsWork(c) : !needsWork(c)));

  return (
    <>
      <DropZone
        size="md"
        label="Thêm chương tiếp theo"
        title={`Thả strip của Chương ${next} vào đây`}
        hint="Thả ảnh/ZIP — tự tạo chương và dịch ngay; mỗi ZIP 1 chương, số chương tự tăng."
        onFiles={drop}
      />
      {auto.isPending && (
        <p className="small muted" role="status">
          Đang tạo chương…
        </p>
      )}
      {auto.error && <p className="notice danger">{errorMessage(auto.error)}</p>}
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
        {shown.map((c) => (
          <ChapterLine key={c.id} ws={ws} ch={c} upload={uploadManager.view(c.id, uploads[c.id])} />
        ))}
      </div>
      {filter === "todo" && exported > 0 && (
        <div className="small muted">{exported} chương đã xuất ẩn trong bộ lọc "Đã xuất".</div>
      )}
    </>
  );
}

function ChapterLine(props: { ws: string; ch: ChapterRow; upload: ReturnType<typeof uploadManager.view> }) {
  const { ws, ch } = props;
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
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
      <Link
        className="ch-open"
        to="/w/$ws/s/$seriesId/c/$chapterId"
        params={params}
        aria-label={`Mở chương ${ch.number}`}
      >
        <span className="ch-num">Ch.{ch.number}</span>
        <span className="ch-body">
          <span className="ch-line">
            <span className="dot" data-tone={a.tone} />
            <span style={{ fontWeight: 500 }}>{a.state}</span>
            <span className="small muted">· {timeAgo(ch.updated_at)}</span>
          </span>
          <span className="ch-line">
            <span className="bar">
              <span data-tone={a.tone} style={{ width: `${Math.round(a.progress * 100)}%` }} />
            </span>
            <span className="small muted">
              {a.detail}
              {a.kind === "resume" ? " · thả lại file vào hàng này để tải tiếp" : ""}
            </span>
          </span>
        </span>
      </Link>
      {confirming ? (
        <DeleteChapterConfirm
          ws={ws}
          ch={ch}
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
            to="/w/$ws/s/$seriesId/c/$chapterId"
            params={params}
            aria-label={`Sửa chương ${ch.number}`}
            title="Sửa chương"
          >
            <PencilIcon />
          </Link>
          <button
            type="button"
            className="icon-btn"
            data-danger
            aria-label={`Xoá chương ${ch.number}`}
            title="Xoá chương"
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

function DeleteChapterConfirm(props: {
  ws: string;
  ch: ChapterRow;
  onDone: () => void;
  onError: (text: string) => void;
}) {
  const { ws, ch } = props;
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteChapter(ws, ch.id),
    onSuccess: () => {
      props.onDone();
      void qc.invalidateQueries({ queryKey: ["series", ws] });
    },
    onError: (e) =>
      props.onError(
        e instanceof ApiError && e.status === 423
          ? `${String(e.body.holder_name ?? "Người khác")} đang mở sửa chương này — đợi họ đóng chương rồi xoá.`
          : errorMessage(e),
      ),
  });
  return (
    <div className="row delete-confirm" role="alertdialog" aria-label={`Xác nhận xoá chương ${ch.number}`}>
      <span className="small">Xoá hẳn chương {ch.number} (ảnh, bản dịch, lịch sử)?</span>
      <button
        type="button"
        className="btn-danger-solid"
        disabled={del.isPending}
        // biome-ignore lint/a11y/noAutofocus: vừa bấm xoá → Enter xác nhận, Esc/Tab sang Huỷ
        autoFocus
        onClick={() => del.mutate()}
      >
        {del.isPending ? "Đang xoá…" : "Xoá chương"}
      </button>
      <button type="button" disabled={del.isPending} onClick={props.onDone}>
        Huỷ
      </button>
    </div>
  );
}
