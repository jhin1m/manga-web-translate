/**
 * Màn series, một cột: đầu trang (‹ về home, tên, cặp ngôn ngữ, "Glossary · N", icon Cài đặt dịch), dải thả "Thả
 * Ch.{next}", toàn bộ danh sách chương (bấm cả hàng để mở — dịch/xuất/chạy lại làm trong màn chương; icon Xoá).
 * Glossary / Cài đặt dịch mở thành modal trên danh sách; `?tab=` giữ trạng thái modal (link sâu từ home / màn chương).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Drawer } from "../../app/drawer.tsx";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { timeAgo } from "../../lib/format.ts";
import { nextAction } from "../chapter/next-action.ts";
import { fetchGlossary, glossaryKey } from "../glossary/api.ts";
import { GlossaryEditor } from "../glossary/glossary-editor.tsx";
import { GlossarySuggestions } from "../glossary/glossary-suggestions.tsx";
import { useDropToTranslate } from "../home/drop-to-translate.ts";
import { NewChapterConfirmRow } from "../home/new-chapter-confirm-row.tsx";
import { BackIcon, SlidersIcon, TrashIcon } from "../home/row-icons.tsx";
import { resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { DropZone, useDropTarget, usePageDrop } from "../upload/drop-zone.tsx";
import { uploadManager, useUploads } from "../upload/upload-manager.ts";
import {
  type ChapterRow,
  deleteChapter,
  fetchSeries,
  fetchSeriesList,
  fetchSuggestions,
  nextChapterNumber,
  type SeriesDetail,
  seriesKeys,
} from "./api.ts";
import { pairLabel } from "./lang-labels.ts";
import { SeriesSettingsDialog } from "./series-settings-form.tsx";
import "../home/home.css";

export type SeriesTab = "chapters" | "glossary" | "settings";

const useSeries = (seriesId: string) =>
  useQuery({
    queryKey: seriesKeys.detail(seriesId),
    queryFn: () => fetchSeries(seriesId),
    // Trạng thái chương đổi theo worker — làm mới chậm khi còn chương đang chạy.
    refetchInterval: (query) =>
      query.state.data?.chapters.some((c) => c.status === "ingesting" || c.status === "processing") ? 5000 : false,
  });

export function SeriesPage(props: { seriesId: string; tab?: SeriesTab }) {
  const { seriesId, tab = "chapters" } = props;
  const q = useSeries(seriesId);
  const s = q.data;
  const navigate = useNavigate();
  const closeModal = () => void navigate({ to: "/s/$seriesId", params: { seriesId }, search: {} });
  return (
    <main className="series-main">
      {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}
      {s && (
        <>
          <SeriesHead series={s} />
          <ChapterList series={s} />
          {tab === "settings" && <SeriesSettingsDialog series={s} onClose={closeModal} />}
          {tab === "glossary" && (
            <Drawer variant="modal" title="Glossary của series" onClose={closeModal}>
              <GlossarySuggestions seriesId={seriesId} />
              <GlossaryEditor scope={{ seriesId }} inheritedLabel={`từ glossary chung (${pairLabel(s)})`} />
            </Drawer>
          )}
        </>
      )}
    </main>
  );
}

function SeriesHead({ series }: { series: SeriesDetail }) {
  const scope = { seriesId: series.id };
  const glossary = useQuery({ queryKey: glossaryKey(scope), queryFn: () => fetchGlossary(scope) });
  const terms = glossary.data?.entries.length;
  const suggestions = useQuery({
    queryKey: seriesKeys.suggestions(series.id),
    queryFn: () => fetchSuggestions(series.id),
  });
  const termHints = suggestions.data?.terms.length ?? 0;
  const pronounHints = suggestions.data?.pronouns.length ?? 0;
  return (
    <div className="series-head">
      <Link to="/" className="btn icon-btn" aria-label="Về trang chủ" title="Về trang chủ">
        <BackIcon />
      </Link>
      <h1 title={series.title}>{series.title}</h1>
      <span className="muted series-pair">{pairLabel(series)}</span>
      <Link className="btn" to="/s/$seriesId" params={{ seriesId: series.id }} search={{ tab: "glossary" }}>
        {terms === undefined ? "Glossary" : `Glossary · ${terms}`}
        {termHints > 0 && (
          <>
            <span className="sr-only"> · {termHints} gợi ý từ AI</span>
            <span
              className="count-badge"
              aria-hidden="true"
              title={`${termHints} gợi ý từ AI`}
              data-testid="glossary-hint-badge"
            >
              {termHints}
            </span>
          </>
        )}
      </Link>
      <Link
        className="btn icon-btn"
        to="/s/$seriesId"
        params={{ seriesId: series.id }}
        search={{ tab: "settings" }}
        aria-label={pronounHints > 0 ? `Cài đặt dịch · ${pronounHints} gợi ý xưng hô` : "Cài đặt dịch"}
        title="Cài đặt dịch"
      >
        <SlidersIcon />
        {pronounHints > 0 && (
          <span
            className="count-badge"
            aria-hidden="true"
            title={`${pronounHints} gợi ý xưng hô từ AI`}
            data-testid="settings-hint-badge"
          >
            {pronounHints}
          </span>
        )}
      </Link>
    </div>
  );
}

function ChapterList({ series }: { series: SeriesDetail }) {
  const listQ = useQuery({ queryKey: seriesKeys.list(), queryFn: () => fetchSeriesList() });
  const uploads = useUploads();
  const [pending, setPending] = useState<{ files: File[]; seq: number } | null>(null);
  const auto = useDropToTranslate((files) => setPending((p) => ({ files, seq: (p?.seq ?? 0) + 1 })));
  const drop = (files: File[]) => {
    setPending(null);
    auto.mutate({ files, seriesId: series.id });
  };
  usePageDrop(drop);

  const chapters = series.chapters;
  const next = nextChapterNumber(chapters);

  return (
    <>
      <DropZone label="Thêm chương tiếp theo" title={`Thả Ch.${next}`} onFiles={drop} />
      {auto.isPending && (
        <p className="small muted" role="status">
          Đang tạo chương…
        </p>
      )}
      {auto.error && <p className="notice danger">{errorMessage(auto.error)}</p>}
      {pending && listQ.data && (
        <NewChapterConfirmRow
          key={pending.seq}
          files={pending.files}
          series={listQ.data.series}
          fixedSeriesId={series.id}
          defaultNumber={next}
          onCancel={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      )}

      <div className="rows">
        {chapters.length === 0 && <div className="rows-empty">Chưa có chương nào — thả ảnh / ZIP ở trên.</div>}
        {chapters.map((c) => (
          <ChapterLine key={c.id} ch={c} upload={uploadManager.view(c.id, uploads[c.id])} />
        ))}
      </div>
    </>
  );
}

function ChapterLine(props: { ch: ChapterRow; upload: ReturnType<typeof uploadManager.view> }) {
  const { ch } = props;
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const a = nextAction(ch, props.upload);
  const params = { seriesId: ch.series_id, chapterId: ch.id };
  // Chương nháp upload dở: thả lại file thẳng vào hàng.
  const target = useDropTarget((files) => {
    setMsg(null);
    resumeFromFiles(ch.id, files).catch((e: unknown) => setMsg(errorMessage(e)));
  });
  const dropProps = a.kind === "resume" ? target.props : {};

  const running = a.tone === "busy";

  return (
    <div className="row-item" data-chapter={ch.id} data-drop={a.kind === "resume" && target.over} {...dropProps}>
      <Link
        className="ch-open"
        to="/s/$seriesId/c/$chapterId"
        params={params}
        aria-label={`Mở chương ${ch.number}`}
        title={a.detail}
      >
        <span className="ch-num">Ch.{ch.number}</span>
        <span className="ch-state">
          <span className="dot" data-tone={a.tone} />
          <span style={{ fontWeight: 500 }}>{a.state}</span>
          {a.kind === "resume" && <span className="small muted">· thả lại file vào hàng này để tải tiếp</span>}
        </span>
        <span className="small muted ch-time">{timeAgo(ch.updated_at)}</span>
      </Link>
      {confirming ? (
        <DeleteChapterConfirm
          ch={ch}
          onDone={() => setConfirming(false)}
          onError={(text) => {
            setConfirming(false);
            setMsg(text);
          }}
        />
      ) : (
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
      )}
      {msg && <div className="row-error">{msg}</div>}
      {running && (
        // Vạch 2px dưới hàng, chỉ khi chương đang chạy; trạng thái cũng đã có chữ ở trên nên không truyền chỉ bằng màu.
        <span
          className="row-progress"
          aria-hidden="true"
          style={{ width: `${Math.max(4, Math.round(a.progress * 100))}%` }}
        />
      )}
    </div>
  );
}

function DeleteChapterConfirm(props: { ch: ChapterRow; onDone: () => void; onError: (text: string) => void }) {
  const { ch } = props;
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteChapter(ch.id),
    onSuccess: () => {
      props.onDone();
      void qc.invalidateQueries({ queryKey: ["series"] });
    },
    onError: (e) =>
      props.onError(
        e instanceof ApiError && e.status === 423
          ? "Chương đang mở để sửa ở một tab — đóng tab đó rồi xoá."
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
