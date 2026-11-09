/**
 * Drawer "Hoạt động": việc đang chạy/xong/lỗi gom 1 chỗ, mục trống được ẩn. Upload (mọi chương của tab, từ
 * upload-manager); ở màn chương thêm tóm tắt trang + nguyên nhân lỗi (nút "Chạy lại trang lỗi"), job chương gấp trong
 * "Chi tiết", và lượt xuất gần đây (tải lại, huỷ). Ở màn chương mở từ chip trạng thái hoặc menu ⋯ (kèm số việc đang chạy).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "zustand";
import { Drawer } from "../../app/drawer.tsx";
import { errorMessage } from "../../lib/api.ts";
import { type ChapterUpload, uploadManager, useUploads } from "../upload/upload-manager.ts";
import { cancelJob, chapterKeys, fetchChapter, type JobView, type Progress } from "./api.ts";
import { ExportRow, useExports } from "./export-panel.tsx";
import { failedPageGroups, jobErrorLabel, providerWait, providerWaitText } from "./job-error.ts";
import { pageLevel, pageSummary } from "./page-status.ts";
import { stageLabel } from "./stage-labels.ts";
import { formatBytes } from "./text-utils.ts";

const JOB_LABEL: Record<string, string> = {
  "chapter.ingest": "Cắt trang",
  "page.prepare": "Xoá chữ và đọc chữ",
  "chapter.translate": "Dịch",
  "page.reinpaint": "Xoá chữ lại",
  "page.ocr_region": "Đọc chữ vùng đã chọn",
  "chapter.export": "Xuất",
  "chapter.proofread": "Hiệu đính",
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

/** Nút "Hoạt động" của app shell, kèm số việc đang chạy. Màn chương mở drawer qua chip trạng thái / menu ⋯. */
function ActivityButton({ count, onClick }: { count: number; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} aria-label={count ? `Hoạt động (${count} đang chạy)` : "Hoạt động"}>
      Hoạt động
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
      <UploadSection showEmpty={!props.chapter} />
      {props.chapter && <ChapterSection {...props.chapter} />}
      {props.chapter && <ExportSection chapterId={props.chapter.id} />}
    </Drawer>
  );
}

/**
 * Nút + drawer Hoạt động cho app shell (home, series…): chỉ mục Upload. Nút chỉ hiện khi có chương đang tải ảnh (hoặc
 * khi drawer đang mở, để không biến mất giữa chừng lúc việc cuối vừa xong).
 */
export function ShellActivity() {
  const [open, setOpen] = useState(false);
  const count = useUploadCount();
  // Upload lỗi không còn "đang chạy" nhưng nút Thử lại chỉ nằm trong drawer, nên nút vẫn phải hiện.
  const hasFailed = useStore(uploadManager.store, (s) => Object.values(s.chapters).some((c) => c.phase === "failed"));
  return (
    <>
      {(count > 0 || hasFailed || open) && <ActivityButton count={count} onClick={() => setOpen(true)} />}
      {open && <ActivityDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

/** Ở màn chương mục trống được ẩn; ở app shell đây là mục duy nhất nên vẫn báo trống. */
function UploadSection({ showEmpty }: { showEmpty: boolean }) {
  const uploads = Object.values(useUploads());
  if (uploads.length === 0 && !showEmpty) return null;
  return (
    <section className="drawer-section" aria-label="Upload">
      <h3>Upload</h3>
      {uploads.length === 0 ? (
        <p className="muted small">Không có ảnh nào đang tải trong tab này.</p>
      ) : (
        <div className="drawer-list">
          {uploads.map((u) => (
            <UploadItem key={u.chapterId} u={u} />
          ))}
        </div>
      )}
    </section>
  );
}

function UploadItem({ u }: { u: ChapterUpload }) {
  // Tên chương lấy theo từng chương đang tải (cùng khoá với màn chương): danh sách "Việc cần làm" bị cắt ở 20 chương
  // và chương đang mở ở tab khác xếp trước, nên chương nháp vừa tải có thể không nằm trong đó.
  const ch = useQuery({ queryKey: chapterKeys.detail(u.chapterId), queryFn: () => fetchChapter(u.chapterId) }).data;
  const name = ch ? `Chương ${ch.number} · ${ch.series.title}` : "Chương mới";
  const pct = u.bytesTotal ? Math.round((u.bytesDone / u.bytesTotal) * 100) : 0;
  const tone = u.phase === "failed" ? "danger" : u.phase === "uploaded" ? "ok" : "busy";
  const label =
    u.phase === "failed"
      ? `Lỗi ${u.total - u.done} ảnh · đã tải ${u.done}/${u.total}`
      : u.phase === "uploaded"
        ? `Đã tải xong ${u.total} ảnh — chờ bấm Dịch chương`
        : `Đang tải ${u.done}/${u.total} ảnh · ${formatBytes(u.bytesDone)}/${formatBytes(u.bytesTotal)}`;
  return (
    <div className="drawer-item" data-chapter={u.chapterId}>
      <div className="drawer-item-head">
        <span className="grow">
          {ch ? (
            <Link to="/s/$seriesId/c/$chapterId" params={{ seriesId: ch.series.id, chapterId: ch.id }}>
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
              <span className="grow">{pageSummary(p.pages.length, busy, failed.length)}</span>
              {failed.length > 0 && props.canRetry && (
                <button type="button" disabled={props.retrying} onClick={props.onRetry}>
                  Chạy lại trang lỗi
                </button>
              )}
            </div>
            {groups.map((g) => (
              <div key={g.cls} className="small">
                <span className="error">
                  {g.count} trang · {g.label}: trang {g.pages}
                  {g.hint ? `. ${g.hint}` : ""}
                </span>
                {g.needsSetup && (
                  <Link to="/settings" search={{ section: "tasks" }}>
                    Mở Model tác vụ
                  </Link>
                )}
                {g.details.length > 0 && (
                  <details className="cw-error-raw">
                    <summary>Chi tiết kỹ thuật</summary>
                    {g.details.map((d) => (
                      <p key={d.error}>
                        <strong>Trang {d.pages}:</strong> {d.error}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            ))}
            {wait && <span className="small warn-text">{providerWaitText(wait)}</span>}
          </div>
        )}
        {jobs.length > 0 && (
          <details className="drawer-jobs">
            <summary className="small">Chi tiết</summary>
            {jobs.map((j) => {
              const st = JOB_STATUS[j.status] ?? { label: j.status, tone: "idle" };
              // Bước cũ của job đã kết thúc không còn ý nghĩa (server xoá stage khi xong; lỗi giữ bước cuối).
              const step = ACTIVE.has(j.status) ? stageLabel(j) : null;
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
                    {step ? ` · ${step}` : ""}
                    {ACTIVE.has(j.status) && j.progress > 0 ? ` · ${Math.round(j.progress * 100)}%` : ""}
                  </span>
                  {j.status === "failed" && (j.error || j.error_class) && (
                    <span className="small error">
                      {jobErrorLabel(j)}
                      {j.error ? `: ${j.error}` : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </details>
        )}
        {p.pages.length === 0 && jobs.length === 0 && <p className="muted small">Chưa có việc nào của chương.</p>}
      </div>
    </section>
  );
}

function ExportSection({ chapterId }: { chapterId: string }) {
  const { q, refresh } = useExports(chapterId);
  const exports = q.data?.exports ?? [];
  const cancel = useMutation({ mutationFn: (id: string) => cancelJob(id), onSettled: refresh });
  if (exports.length === 0 && !cancel.error) return null;
  return (
    <section className="drawer-section" aria-label="Xuất gần đây">
      <h3>Xuất gần đây</h3>
      {cancel.error && <p className="notice danger">{errorMessage(cancel.error)}</p>}
      <div className="drawer-list">
        {exports.slice(0, 5).map((x) => (
          <ExportRow key={x.id} x={x} cancelling={cancel.isPending} onCancel={() => cancel.mutate(x.id)} />
        ))}
      </div>
    </section>
  );
}
