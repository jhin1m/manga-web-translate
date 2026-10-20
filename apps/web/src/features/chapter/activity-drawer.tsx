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
const ERROR_CLASS: Record<string, string> = {
  provider: "nhà cung cấp AI lỗi",
  rate_limited: "bị giới hạn tốc độ",
  schema: "AI trả sai định dạng",
  invalid_input: "ảnh lỗi hoặc vượt giới hạn",
  internal: "lỗi hệ thống",
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

export function ActivityButton({ count, onClick }: { count: number; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} aria-label={count ? `Hoạt động (${count} đang chạy)` : "Hoạt động"}>
      Hoạt động{count > 0 && <span className="count-badge">{count}</span>}
    </button>
  );
}

export function ActivityDrawer(props: {
  ws: string;
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
      <UploadSection ws={props.ws} />
      {props.chapter && <ChapterSection {...props.chapter} />}
      {props.chapter && <ExportSection ws={props.ws} chapterId={props.chapter.id} />}
    </Drawer>
  );
}

/** Nút + drawer Hoạt động cho app shell (home, series…): chỉ mục Upload. */
export function ShellActivity({ ws }: { ws: string }) {
  const [open, setOpen] = useState(false);
  const count = useUploadCount();
  return (
    <>
      <ActivityButton count={count} onClick={() => setOpen(true)} />
      {open && <ActivityDrawer ws={ws} onClose={() => setOpen(false)} />}
    </>
  );
}

function UploadSection({ ws }: { ws: string }) {
  const uploads = Object.values(useUploads());
  // Tên chương: danh sách "Việc cần làm" (gồm chương nháp đang tải) — cùng query với home, không poll thêm.
  const recent = useQuery({
    queryKey: seriesKeys.recent(ws),
    queryFn: () => fetchRecentChapters(ws),
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
                      <Link
                        to="/w/$ws/s/$seriesId/c/$chapterId"
                        params={{ ws, seriesId: ch.series_id, chapterId: ch.id }}
                      >
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
  // Lỗi theo loại (error_class của job trang) → "2 trang: nhà cung cấp AI lỗi".
  const byClass = new Map<string, number[]>();
  for (const f of failed) {
    const k = f.job?.error_class ?? "internal";
    byClass.set(k, [...(byClass.get(k) ?? []), f.ord + 1]);
  }
  const jobs = chapterJobs(p.jobs);
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
              {p.pages.length - busy - failed.length}/{p.pages.length} trang xong
              {busy ? ` · ${busy} trang đang xử lý` : ""}
              {failed.length ? ` · ${failed.length} trang lỗi` : ""}
            </span>
            {[...byClass].map(([k, ords]) => (
              <span key={k} className="small error">
                Trang {ords.join(", ")}: {ERROR_CLASS[k] ?? k}
              </span>
            ))}
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

function ExportSection({ ws, chapterId }: { ws: string; chapterId: string }) {
  const { q, refresh } = useExports(ws, chapterId);
  const exports = q.data?.exports ?? [];
  const cancel = useMutation({ mutationFn: (id: string) => cancelJob(ws, id), onSettled: refresh });
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
