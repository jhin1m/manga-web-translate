/**
 * Drawer "Hoạt động": việc đang chạy/xong/lỗi gom 1 chỗ. Upload (mọi chương của tab, từ upload-manager) luôn có;
 * ở màn chương thêm job của chương đang mở (`progress.jobs` + số trang đang chạy/lỗi theo `error_class`, nút "Chạy
 * lại trang lỗi") và lượt xuất gần đây (tải lại, huỷ). Nút mở drawer kèm số việc đang chạy.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "zustand";
import { Drawer } from "../../app/drawer.tsx";
import { errorMessage } from "../../lib/api.ts";
import { fetchRecentChapters, seriesKeys } from "../series/api.ts";
import { uploadManager, useUploads } from "../upload/upload-manager.ts";
import { cancelJob, type JobView, type Progress } from "./api.ts";
import { ExportRow, useExports } from "./export-panel.tsx";
import { ERROR_CLASS, failedPageGroups, providerWait, providerWaitText } from "./job-error.ts";
import { pageLevel } from "./page-status.ts";
import { formatBytes } from "./text-utils.ts";

const JOB_LABEL: Record<string, string> = {
  "chapter.ingest": "Cắt trang",
  "page.prepare": "GĐ1 · xoá chữ + OCR",
  "chapter.translate": "Dịch chương",
  "page.reinpaint": "Xoá chữ lại theo mask",
  "page.ocr_region": "OCR vùng",
  "chapter.export": "Xuất",
};
const JOB_STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Đang chờ", tone: "busy" },
  running: { label: "Đang chạy", tone: "busy" },
  paused_budget: { label: "Tạm dừng (hết ngân sách)", tone: "warn" },
  succeeded: { label: "Xong", tone: "ok" },
  failed: { label: "Lỗi", tone: "danger" },
  cancelled: { label: "Đã huỷ", tone: "idle" },
};
const ACTIVE = new Set(["queued", "running", "paused_budget"]);
/** Job theo trang (mỗi trang 1 job) gom vào dòng "trang"; xuất có mục riêng. */
const PER_PAGE_OR_EXPORT = new Set(["page.prepare", "chapter.export"]);

/** Job chương cần hiện (mới nhất trước, tối đa 8). */
const chapterJobs = (jobs: JobView[]) =>
  jobs
    .filter((j) => !PER_PAGE_OR_EXPORT.has(j.type))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

/** Số chương đang tải ảnh trong tab (selector trả số → tiến độ từng byte không render lại người dùng). */
export function useUploadCount() {
  return useStore(uploadManager.store, (s) => Object.values(s.chapters).filter((c) => c.phase === "uploading").length);
}

/** Việc đang chạy của chương: job chương còn chạy (trang đang xử lý mà chưa thấy job nào → tính 1) + lượt xuất. */
export function chapterActivityCount(progress: Progress | undefined, exportsActive: number) {
  if (!progress) return exportsActive;
  const jobs = chapterJobs(progress.jobs).filter((j) => ACTIVE.has(j.status)).length;
  const pagesBusy = progress.pages.some((p) => pageLevel(p.status) === "busy");
  return exportsActive + Math.max(jobs, pagesBusy ? 1 : 0);
}

/** `icon`: chỉ biểu tượng + số (thanh trên màn chương, chật chỗ); tên đầy đủ ở aria-label/title. */
export function ActivityButton({ count, onClick, icon }: { count: number; onClick(): void; icon?: boolean }) {
  return (
    <button
      type="button"
      className={icon ? "btn-ghost" : undefined}
      onClick={onClick}
      aria-label={count ? `Hoạt động (${count} đang chạy)` : "Hoạt động"}
      title={icon ? "Hoạt động" : undefined}
    >
      {icon ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M3 12h4l3-8 4 16 3-8h4" />
        </svg>
      ) : (
        "Hoạt động"
      )}
      {count > 0 && <span className="count-badge">{count}</span>}
    </button>
  );
}

export function ActivityDrawer(props: {
  /** Màn chương: job + xuất của chương đang mở. */
  chapter?: {
    id: string;
    progress: Progress | undefined;
    canRetry: boolean;
    retrying: boolean;
    onRetry(): void;
  };
  onClose(): void;
}) {
  return (
    <Drawer title="Hoạt động" onClose={props.onClose}>
      <UploadSection />
      {props.chapter && <ChapterSection {...props.chapter} />}
      {props.chapter && <ExportSection chapterId={props.chapter.id} />}
    </Drawer>
  );
}

/** Nút + drawer Hoạt động cho app shell (home, series…): chỉ mục Upload. */
export function ShellActivity() {
  const [open, setOpen] = useState(false);
  const count = useUploadCount();
  return (
    <>
      <ActivityButton count={count} onClick={() => setOpen(true)} />
      {open && <ActivityDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function UploadSection() {
  const uploads = Object.values(useUploads());
  // Tên chương: danh sách "Việc cần làm" (gồm chương nháp đang tải) — cùng query với home, không poll thêm.
  const recent = useQuery({
    queryKey: seriesKeys.recent(),
    queryFn: () => fetchRecentChapters(),
    enabled: uploads.length > 0,
  }).data?.chapters;
  return (
    <section className="drawer-section" aria-label="Upload">
      <h3>Upload</h3>
      {uploads.length === 0 ? (
        <p className="muted small">Không có ảnh nào đang tải trong tab này.</p>
      ) : (
        <div className="drawer-list">
          {uploads.map((u) => {
            const ch = recent?.find((c) => c.id === u.chapterId);
            const name = ch ? `Chương ${ch.number} · ${ch.series_title}` : "Chương mới";
            const pct = u.bytesTotal ? Math.round((u.bytesDone / u.bytesTotal) * 100) : 0;
            const tone = u.phase === "failed" ? "danger" : u.phase === "uploaded" ? "ok" : "busy";
            const label =
              u.phase === "failed"
                ? `Lỗi ${u.total - u.done} ảnh · đã tải ${u.done}/${u.total}`
                : u.phase === "uploaded"
                  ? `Đã tải xong ${u.total} ảnh — chờ bấm Dịch chương`
                  : `Đang tải ${u.done}/${u.total} ảnh · ${formatBytes(u.bytesDone)}/${formatBytes(u.bytesTotal)}`;
            return (
              <div key={u.chapterId} className="drawer-item" data-chapter={u.chapterId}>
                <div className="drawer-item-head">
                  <span className="grow">
                    {ch ? (
                      <Link to="/s/$seriesId/c/$chapterId" params={{ seriesId: ch.series_id, chapterId: ch.id }}>
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </span>
                  {u.phase === "failed" && (
                    <button type="button" className="btn-ghost" onClick={() => uploadManager.retryFailed(u.chapterId)}>
                      Thử lại
                    </button>
                  )}
                </div>
                <span className="status small" data-tone={tone}>
                  {label}
                </span>
                {u.phase === "uploading" && (
                  <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ChapterSection(props: {
  progress: Progress | undefined;
  canRetry: boolean;
  retrying: boolean;
  onRetry(): void;
}) {
  const p = props.progress;
  if (!p) return null;
  const busy = p.pages.filter((x) => pageLevel(x.status) === "busy").length;
  const failed = p.pages.filter((x) => x.status === "failed");
  // Lỗi theo nguyên nhân (error_class của job trang) → "23 trang lỗi · AI từ chối khoá API: trang 2–4, 6".
  const groups = failedPageGroups(failed);
  const jobs = chapterJobs(p.jobs);
  const wait = providerWait(p.pages);
  return (
    <section className="drawer-section" aria-label="Chương đang mở">
      <h3>Chương đang mở</h3>
      <div className="drawer-list">
        {p.pages.length > 0 && (
          <div className="drawer-item">
            <div className="drawer-item-head">
              <span className="grow">Trang</span>
              <span className="status" data-tone={failed.length ? "danger" : busy ? "busy" : "ok"}>
                {failed.length ? "Có lỗi" : busy ? "Đang xử lý" : "Xong"}
              </span>
              {failed.length > 0 && props.canRetry && (
                <button type="button" disabled={props.retrying} onClick={props.onRetry}>
                  Chạy lại trang lỗi
                </button>
              )}
            </div>
            <span className="small">
              {p.pages.length} trang: {p.pages.length - busy - failed.length} xong
              {busy ? ` · ${busy} đang xử lý` : ""}
              {failed.length ? ` · ${failed.length} lỗi` : ""}
            </span>
            {groups.map((g) => (
              <span key={g.cls} className="small error" title={g.raw ?? undefined}>
                {g.count} trang lỗi · {g.label}: trang {g.pages}
                {g.hint ? `. ${g.hint}` : ""}
              </span>
            ))}
            {wait && <span className="small warn-text">{providerWaitText(wait)}</span>}
          </div>
        )}
        {jobs.map((j) => {
          const st = JOB_STATUS[j.status] ?? { label: j.status, tone: "idle" };
          return (
            <div key={j.id} className="drawer-item" data-job-type={j.type}>
              <div className="drawer-item-head">
                <span className="grow">{JOB_LABEL[j.type] ?? j.type}</span>
                <span className="status" data-tone={st.tone}>
                  {st.label}
                </span>
              </div>
              <span className="muted small">
                {new Date(j.updated_at).toLocaleString("vi-VN")}
                {j.stage ? ` · ${j.stage}` : ""}
                {ACTIVE.has(j.status) && j.progress > 0 ? ` · ${Math.round(j.progress * 100)}%` : ""}
              </span>
              {j.status === "failed" && (j.error || j.error_class) && (
                <span className="small error">
                  {j.error_class ? `${ERROR_CLASS[j.error_class] ?? j.error_class}: ` : ""}
                  {j.error}
                </span>
              )}
            </div>
          );
        })}
        {p.pages.length === 0 && jobs.length === 0 && <p className="muted small">Chưa có việc nào của chương.</p>}
      </div>
    </section>
  );
}

function ExportSection({ chapterId }: { chapterId: string }) {
  const { q, refresh } = useExports(chapterId);
  const exports = q.data?.exports ?? [];
  const cancel = useMutation({ mutationFn: (id: string) => cancelJob(id), onSettled: refresh });
  return (
    <section className="drawer-section" aria-label="Xuất gần đây">
      <h3>Xuất gần đây</h3>
      {cancel.error && <p className="notice danger">{errorMessage(cancel.error)}</p>}
      {exports.length === 0 ? (
        <p className="muted small">{q.isLoading ? "Đang tải…" : "Chưa có lượt xuất nào."}</p>
      ) : (
        <div className="drawer-list">
          {exports.slice(0, 5).map((x) => (
            <ExportRow key={x.id} x={x} cancelling={cancel.isPending} onCancel={() => cancel.mutate(x.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
