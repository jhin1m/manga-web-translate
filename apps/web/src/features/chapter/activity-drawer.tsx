/**
 * Drawer "Hoạt động": việc đang chạy/xong/lỗi gom 1 chỗ, mục trống được ẩn. Upload (mọi chương của tab, từ
 * upload-manager); ở màn chương thêm tóm tắt trang + nguyên nhân lỗi (nút "Chạy lại trang lỗi"), job chương gấp trong
 * "Chi tiết", và lượt xuất gần đây (tải lại, huỷ). Ở màn chương mở từ chip trạng thái hoặc menu ⋯ (kèm số việc đang chạy).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "zustand";
import { useMe } from "../../app/app-shell.tsx";
import { Drawer } from "../../app/drawer.tsx";
import { fmtDate } from "../../i18n/format.ts";
import { type MessageKey, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { type ChapterUpload, uploadManager, useUploads } from "../upload/upload-manager.ts";
import { cancelJob, chapterKeys, fetchChapter, type JobView, type Progress } from "./api.ts";
import { ExportRow, useExports } from "./export-panel.tsx";
import { failedPageGroups, jobErrorLabel, needsTaskSetup, providerWait, providerWaitText } from "./job-error.ts";
import { pageLevel, pageSummary } from "./page-status.ts";
import { stageLabel } from "./stage-labels.ts";
import { formatBytes } from "./text-utils.ts";

const JOB_LABEL: Record<string, MessageKey> = {
  "chapter.ingest": "chapter.activityDrawer.job.chapterIngest",
  "page.prepare": "chapter.activityDrawer.job.pagePrepare",
  "chapter.translate": "chapter.activityDrawer.job.chapterTranslate",
  "page.reinpaint": "chapter.activityDrawer.job.pageReinpaint",
  "page.ocr_region": "chapter.activityDrawer.job.pageOcrRegion",
  "chapter.export": "chapter.activityDrawer.job.chapterExport",
  "chapter.proofread": "chapter.activityDrawer.job.chapterProofread",
};
const JOB_STATUS: Record<string, { label: MessageKey; tone: string }> = {
  queued: { label: "chapter.activityDrawer.status.queued", tone: "busy" },
  running: { label: "chapter.activityDrawer.status.running", tone: "busy" },
  paused_budget: { label: "chapter.activityDrawer.status.paused_budget", tone: "warn" },
  succeeded: { label: "chapter.activityDrawer.status.succeeded", tone: "ok" },
  failed: { label: "chapter.activityDrawer.status.failed", tone: "danger" },
  cancelled: { label: "chapter.activityDrawer.status.cancelled", tone: "idle" },
};
/** Ngày giờ đầy đủ như `toLocaleString()` mặc định. */
const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
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
  const { t } = useT();
  const title = t("chapter.activityDrawer.title");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count ? t("chapter.activityDrawer.buttonAria", { count }) : title}
    >
      {title}
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
  const { t } = useT();
  return (
    <Drawer title={t("chapter.activityDrawer.title")} onClose={props.onClose}>
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
  const { t } = useT();
  const uploads = Object.values(useUploads());
  if (uploads.length === 0 && !showEmpty) return null;
  return (
    <section className="drawer-section" aria-label="Upload">
      <h3>Upload</h3>
      {uploads.length === 0 ? (
        <p className="muted small">{t("chapter.activityDrawer.uploadEmpty")}</p>
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
  const { t } = useT();
  // Tên chương lấy theo từng chương đang tải (cùng khoá với màn chương): danh sách "Việc cần làm" bị cắt ở 20 chương
  // và chương đang mở ở tab khác xếp trước, nên chương nháp vừa tải có thể không nằm trong đó.
  const ch = useQuery({ queryKey: chapterKeys.detail(u.chapterId), queryFn: () => fetchChapter(u.chapterId) }).data;
  const name = ch
    ? t("chapter.activityDrawer.chapterName", { number: ch.number, title: ch.series.title })
    : t("chapter.activityDrawer.newChapter");
  const pct = u.bytesTotal ? Math.round((u.bytesDone / u.bytesTotal) * 100) : 0;
  const tone = u.phase === "failed" ? "danger" : u.phase === "uploaded" ? "ok" : "busy";
  const label =
    u.phase === "failed"
      ? t("chapter.activityDrawer.uploadFailed", { failed: u.total - u.done, done: u.done, total: u.total })
      : u.phase === "uploaded"
        ? t("chapter.activityDrawer.uploadDone", { total: u.total })
        : t("chapter.activityDrawer.uploadProgress", {
            done: u.done,
            total: u.total,
            bytesDone: formatBytes(u.bytesDone),
            bytesTotal: formatBytes(u.bytesTotal),
          });
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
            {t("common.retry")}
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

/** Lối tới Cài đặt › Pipeline (chọn model AI từng bước) khi job thiếu model; chỉ admin mở được trang đó. */
function TaskSetupLink() {
  const { t } = useT();
  const me = useMe();
  if (!me.is_admin) return null;
  return (
    <div>
      <Link to="/settings" search={{ section: "pipeline" }}>
        {t("chapter.activityDrawer.openPipeline")}
      </Link>
    </div>
  );
}

function ChapterSection(props: {
  progress: Progress | undefined;
  canRetry: boolean;
  retrying: boolean;
  onRetry(): void;
}) {
  const { t, tp } = useT();
  const p = props.progress;
  if (!p) return null;
  const busy = p.pages.filter((x) => pageLevel(x.status) === "busy").length;
  const failed = p.pages.filter((x) => x.status === "failed");
  // Lỗi theo nguyên nhân (error_class của job trang) → "23 trang lỗi · AI từ chối khoá API: trang 2–4, 6".
  const groups = failedPageGroups(failed);
  const jobs = chapterJobs(p.jobs);
  const wait = providerWait(p.pages);
  // Dịch lại lỗi thì trang vẫn "xong" (giữ bản cũ), nên thiếu model phải báo từ job mới nhất.
  const newest = jobs[0];
  const setupJob =
    newest?.status === "failed" && needsTaskSetup(newest) && !groups.some((g) => g.needsSetup) ? newest : null;
  return (
    <section className="drawer-section" aria-label={t("chapter.activityDrawer.openChapter")}>
      <h3>{t("chapter.activityDrawer.openChapter")}</h3>
      <div className="drawer-list">
        {p.pages.length > 0 && (
          <div className="drawer-item">
            <div className="drawer-item-head">
              <span className="grow">{pageSummary(p.pages.length, busy, failed.length)}</span>
              {failed.length > 0 && props.canRetry && (
                <button type="button" disabled={props.retrying} onClick={props.onRetry}>
                  {t("chapter.activityDrawer.retryFailed")}
                </button>
              )}
            </div>
            {groups.map((g) => (
              <div key={g.cls} className="small">
                <span className="error">
                  {tp("chapter.activityDrawer.failedGroup", g.count, { label: g.label, pages: g.pages })}
                  {g.hint ? `. ${g.hint}` : ""}
                </span>
                {g.needsSetup && <TaskSetupLink />}
                {g.details.length > 0 && (
                  <details className="cw-error-raw">
                    <summary>{t("chapter.activityDrawer.technicalDetails")}</summary>
                    {g.details.map((d) => (
                      <p key={d.error}>
                        <strong>{t("chapter.activityDrawer.detailPages", { pages: d.pages })}</strong> {d.error}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            ))}
            {wait && <span className="small warn-text">{providerWaitText(wait)}</span>}
          </div>
        )}
        {setupJob && (
          <div className="drawer-item small">
            <span className="error">{jobErrorLabel(setupJob)}</span>
            <TaskSetupLink />
          </div>
        )}
        {jobs.length > 0 && (
          <details className="drawer-jobs">
            <summary className="small">{t("chapter.activityDrawer.details")}</summary>
            {jobs.map((j) => {
              const known = JOB_STATUS[j.status];
              const st = known ? { label: t(known.label), tone: known.tone } : { label: j.status, tone: "idle" };
              const jobLabel = JOB_LABEL[j.type];
              // Bước cũ của job đã kết thúc không còn ý nghĩa (server xoá stage khi xong; lỗi giữ bước cuối).
              const step = ACTIVE.has(j.status) ? stageLabel(j) : null;
              return (
                <div key={j.id} className="drawer-item" data-job-type={j.type}>
                  <div className="drawer-item-head">
                    <span className="grow">{jobLabel ? t(jobLabel) : j.type}</span>
                    <span className="status" data-tone={st.tone}>
                      {st.label}
                    </span>
                  </div>
                  <span className="muted small">
                    {fmtDate(j.updated_at, DATE_TIME)}
                    {step ? ` · ${step}` : ""}
                    {ACTIVE.has(j.status) && j.progress > 0 ? ` · ${Math.round(j.progress * 100)}%` : ""}
                  </span>
                  {j.status === "failed" && (j.error || j.error_class) && (
                    <span className="small error">
                      {jobErrorLabel(j)}
                      {j.error && !needsTaskSetup(j) ? `: ${j.error}` : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </details>
        )}
        {p.pages.length === 0 && jobs.length === 0 && (
          <p className="muted small">{t("chapter.activityDrawer.noJobs")}</p>
        )}
      </div>
    </section>
  );
}

function ExportSection({ chapterId }: { chapterId: string }) {
  const { t } = useT();
  const { q, refresh } = useExports(chapterId);
  const exports = q.data?.exports ?? [];
  const cancel = useMutation({ mutationFn: (id: string) => cancelJob(id), onSettled: refresh });
  if (exports.length === 0 && !cancel.error) return null;
  return (
    <section className="drawer-section" aria-label={t("chapter.activityDrawer.recentExports")}>
      <h3>{t("chapter.activityDrawer.recentExports")}</h3>
      {cancel.error && <p className="notice danger">{errorMessage(cancel.error)}</p>}
      <div className="drawer-list">
        {exports.slice(0, 5).map((x) => (
          <ExportRow key={x.id} x={x} cancelling={cancel.isPending} onCancel={() => cancel.mutate(x.id)} />
        ))}
      </div>
    </section>
  );
}
