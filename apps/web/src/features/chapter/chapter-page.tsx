/**
 * Màn chương: tiến độ (polling 2.5s khi chương chưa ổn định, red team #13), lưới thumbnail, các thao tác
 * chạy lại trang lỗi / dịch lại / huỷ / commit chương nháp, và trạng thái khoá ("đang được X sửa").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { ApplyGlossaryDialog } from "../glossary/ApplyGlossary.tsx";
import { seriesKeys } from "../series/api.ts";
import {
  cancelChapter,
  chapterKeys,
  commitChapter,
  fetchChapter,
  fetchPages,
  fetchProgress,
  type PageImage,
  type ProgressPage,
  REJECT_REASON,
  retranslate,
  retryFailed,
} from "./api.ts";
import { ExportDialog } from "./ExportDialog.tsx";
import { FindReplaceDialog } from "./FindReplace.tsx";
import { CHAPTER_STATUS, isChapterSettled, PAGE_STATUS } from "./status.ts";

export const PROGRESS_POLL_MS = 2500;
const LOCK_POLL_MS = 15_000;

export function ChapterPage({ ws, seriesId, chapterId }: { ws: string; seriesId: string; chapterId: string }) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [dialog, setDialog] = useState<"export" | "find" | "glossary" | null>(null);

  const detailQ = useQuery({
    queryKey: chapterKeys.detail(ws, chapterId),
    queryFn: () => fetchChapter(ws, chapterId),
    refetchInterval: LOCK_POLL_MS,
  });
  const progressQ = useQuery({
    queryKey: chapterKeys.progress(ws, chapterId),
    queryFn: () => fetchProgress(ws, chapterId),
    // Dừng khi chương ổn định hoặc request lỗi (refetch lại khi người dùng thao tác/focus tab).
    refetchInterval: (q) =>
      q.state.status === "error" || isChapterSettled(q.state.data?.chapter.status) ? false : PROGRESS_POLL_MS,
    refetchIntervalInBackground: false,
  });
  // URL ảnh ký 15': lấy lại danh sách khi tập page/clean_rev đổi hoặc gần hết hạn.
  const pagesSig = (progressQ.data?.pages ?? []).map((p) => `${p.id}:${p.clean_rev ?? "o"}`).join(",");
  const pagesQ = useQuery({
    queryKey: chapterKeys.pages(ws, chapterId, pagesSig),
    queryFn: () => fetchPages(ws, chapterId),
    enabled: (progressQ.data?.pages.length ?? 0) > 0,
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
    placeholderData: (prev) => prev,
  });
  const images = useStableImages(pagesQ.data?.pages);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["chapter", ws, chapterId] });
    void qc.invalidateQueries({ queryKey: seriesKeys.detail(ws, seriesId) });
  };
  const action = useMutation({
    mutationFn: async (kind: "retry" | "translate" | "cancel" | "commit") => {
      if (kind === "retry") {
        const r = await retryFailed(ws, chapterId);
        return r.jobs.length ? `Đã xếp lại ${r.jobs.length} job cho trang lỗi.` : "Không có trang lỗi.";
      }
      if (kind === "translate") {
        await retranslate(ws, chapterId);
        return "Đã xếp dịch lại cả chương (chỉnh sửa tay được giữ nguyên).";
      }
      if (kind === "cancel") return `Đã huỷ ${(await cancelChapter(ws, chapterId)).cancelled} job.`;
      const r = await commitChapter(ws, chapterId);
      return r.rejected.length
        ? `Đã commit ${r.accepted} file; loại ${r.rejected.length}: ${r.rejected
            .map((x) => `#${x.ord + 1} ${REJECT_REASON[x.reason]}`)
            .join(", ")}.`
        : `Đã commit ${r.accepted} file.`;
    },
    onSuccess: (text) => setNotice({ tone: "info", text }),
    onError: (e) => setNotice({ tone: "danger", text: errorMessage(e) }),
    onSettled: refresh,
  });

  const ch = detailQ.data;
  const prog = progressQ.data;
  const status = prog?.chapter.status ?? ch?.status;
  const st = status ? CHAPTER_STATUS[status] : null;
  const pages = prog?.pages ?? [];
  const counts = prog?.counts ?? {};
  const busy = status === "ingesting" || status === "processing";
  const lockedByOther = ch?.lock && !ch.lock.is_me ? ch.lock : null;
  const error = detailQ.error ?? progressQ.error;

  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/">Series</Link> /{" "}
        <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId }}>
          {ch?.series.title ?? "…"}
        </Link>
      </div>
      <div className="page-head">
        <h1>
          Chương {ch?.number ?? "…"}
          {ch?.title ? ` · ${ch.title}` : ""}
        </h1>
        {st && (
          <span className="status" data-tone={st.tone}>
            {st.label}
          </span>
        )}
        <span className="spacer" />
        {status === "draft" && (ch?.source_files.length ?? 0) > 0 && (
          <button
            type="button"
            className="btn-primary"
            disabled={action.isPending}
            onClick={() => action.mutate("commit")}
          >
            Xử lý {ch?.source_files.length} file đã upload
          </button>
        )}
        {status === "partial_failed" && (
          <button
            type="button"
            className="btn-primary"
            disabled={action.isPending}
            onClick={() => action.mutate("retry")}
          >
            Chạy lại trang lỗi
          </button>
        )}
        {(status === "review" || status === "partial_failed" || status === "done") && pages.length > 0 && (
          <button type="button" disabled={action.isPending} onClick={() => action.mutate("translate")}>
            Dịch lại cả chương
          </button>
        )}
        {pages.length > 0 && !busy && (
          <button type="button" onClick={() => setDialog("export")}>
            Xuất chương
          </button>
        )}
        {(status === "review" || status === "partial_failed" || status === "done") && pages.length > 0 && (
          <>
            <button type="button" onClick={() => setDialog("find")}>
              Tìm &amp; thay
            </button>
            <button type="button" onClick={() => setDialog("glossary")}>
              Áp glossary
            </button>
          </>
        )}
        {busy && (
          <button
            type="button"
            className="btn-danger"
            disabled={action.isPending}
            onClick={() => action.mutate("cancel")}
          >
            Huỷ xử lý
          </button>
        )}
      </div>

      {error && <p className="notice danger">{errorMessage(error)}</p>}
      {notice && <p className={`notice ${notice.tone}`}>{notice.text}</p>}
      {lockedByOther && (
        <p className="notice">
          Đang được <strong>{lockedByOther.holder_name ?? "thành viên khác"}</strong> sửa — khoá tự hết hạn lúc{" "}
          {new Date(lockedByOther.expires_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} nếu
          không có thao tác.
        </p>
      )}

      {pages.length > 0 && (
        <p className="muted small" style={{ marginTop: 0 }}>
          {pages.length} trang · sẵn sàng {counts.ready ?? 0} · giai đoạn 1{" "}
          {(counts.pending ?? 0) + (counts.preparing ?? 0)} · giai đoạn 2{" "}
          {(counts.prepared ?? 0) + (counts.translating ?? 0)} · lỗi {counts.failed ?? 0}
          {busy && ` · cập nhật mỗi ${PROGRESS_POLL_MS / 1000}s`}
        </p>
      )}
      {status === "ingesting" && <p className="muted">Đang ghép và cắt trang theo bóng thoại…</p>}
      {status === "draft" && pages.length === 0 && (
        <p className="muted">
          Chương nháp: {ch?.source_files.length ?? 0} file đã khai báo.{" "}
          <Link to="/w/$ws/series/$seriesId/upload" params={{ ws, seriesId }}>
            Upload chương mới
          </Link>
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        {pages.map((p) => (
          <PageCard key={p.id} ws={ws} seriesId={seriesId} chapterId={chapterId} page={p} image={images.get(p.id)} />
        ))}
      </div>
      {dialog === "export" && <ExportDialog ws={ws} chapterId={chapterId} onClose={() => setDialog(null)} />}
      {dialog === "find" && (
        <FindReplaceDialog ws={ws} seriesId={seriesId} chapterId={chapterId} onClose={() => setDialog(null)} />
      )}
      {dialog === "glossary" && (
        <ApplyGlossaryDialog ws={ws} seriesId={seriesId} chapterId={chapterId} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

const URL_REUSE_MS = 10 * 60_000;

/**
 * Giữ nguyên URL ảnh của page khi ảnh không đổi (cùng clean_rev) — mỗi lần ký lại cho URL mới khiến trình
 * duyệt tải lại cả ảnh. Chỉ thay URL khi clean_rev đổi hoặc URL cũ sắp hết hạn (ký 15').
 */
function useStableImages(list: PageImage[] | undefined): Map<string, PageImage> {
  const cache = useRef(new Map<string, { img: PageImage; at: number }>());
  const out = new Map<string, PageImage>();
  for (const p of list ?? []) {
    const key = `${p.id}:${p.clean_rev ?? "o"}`;
    const hit = cache.current.get(key);
    if (hit && Date.now() - hit.at < URL_REUSE_MS) out.set(p.id, hit.img);
    else {
      cache.current.set(key, { img: p, at: Date.now() });
      out.set(p.id, p);
    }
  }
  return out;
}

function PageCard(props: {
  ws: string;
  seriesId: string;
  chapterId: string;
  page: ProgressPage;
  image: PageImage | undefined;
}) {
  const { page: p, image } = props;
  const st = PAGE_STATUS[p.status];
  const job = p.job;
  const running = job?.status === "running";
  return (
    <Link
      to="/w/$ws/series/$seriesId/chapters/$chapterId/edit/$pageId"
      params={{ ws: props.ws, seriesId: props.seriesId, chapterId: props.chapterId, pageId: p.id }}
      style={{ color: "inherit", textDecoration: "none" }}
      title={job?.error ?? undefined}
    >
      <div
        style={{
          aspectRatio: "2 / 3",
          border: "1px solid var(--c-line)",
          borderRadius: "var(--radius)",
          background: "var(--c-surface)",
          overflow: "hidden",
        }}
      >
        {image && (
          <img
            src={image.image.url}
            alt={`Trang ${p.ord + 1}`}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
          />
        )}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <span className="small" style={{ fontWeight: 500 }}>
          {p.ord + 1}
        </span>
        <span className="status" data-tone={st.tone}>
          {st.label}
        </span>
      </div>
      {running && (
        <div className="bar" title={job?.stage ?? ""}>
          <span style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
        </div>
      )}
      {p.status === "failed" && job?.error_class && (
        <div className="small error" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {job.error_class}: {job.error}
        </div>
      )}
      {(p.ai_update_available || p.cut_flag || image?.image.kind === "original") && (
        <div className="small muted">
          {[
            p.ai_update_available && "có bản AI mới",
            p.cut_flag && "cắt ở trần chiều cao",
            image?.image.kind === "original" && p.status !== "failed" && "ảnh gốc",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </Link>
  );
}
