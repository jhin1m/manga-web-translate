/**
 * Xuất chương (.zip ảnh / .cbz) trong menu dưới nút "Xuất": 1 dòng "N chỗ cần xem" (bấm mở nói hậu quả) → 1 nút tải:
 * gửi job → tiến độ ngay tại nút → xong tự tải qua link có xác thực (API trả 302 tới presigned GET 5'); link "Tải
 * xuống" tại chỗ phòng trình duyệt chặn tự tải → tuỳ chọn thu gọn (1 dòng tóm tắt) → lần xuất trước + "Tải lại".
 * Đóng menu giữa chừng không mất việc: mở lại thì theo dõi tiếp lượt còn chạy. Danh sách lượt xuất + huỷ job đang chạy
 * nằm ở drawer Hoạt động (ExportRow).
 */
import { EXPORT_FILE, EXPORT_RETENTION_DAYS } from "@mtl/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fmtDate } from "../../i18n/format.ts";
import { type MessageKey, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { timeAgo } from "../../lib/format.ts";
import {
  createExport,
  type ExportFormat,
  type ExportLayout,
  type ExportStatus,
  type ExportView,
  exportKeys,
  fetchExports,
} from "./api.ts";
import {
  CBZ_QUALITY,
  type CbzQuality,
  DEFAULT_LAYOUT,
  exportFailureText,
  exportLabel,
  exportPhase,
  exportPollInterval,
  FORMAT_LABEL,
  isExportActive,
  LAYOUT_CHOICES,
  latestActiveExport,
  optionsSummary,
  showLayoutChoice,
} from "./export-options.ts";
import { type ExportWarnings, reviewCount, warningLines } from "./export-warnings.ts";
import { stageLabel } from "./stage-labels.ts";
import type { Tone } from "./status.ts";
import { formatBytes } from "./text-utils.ts";
import "./export-panel.css";

const STATUS: Record<ExportStatus, { label: MessageKey; tone: Tone }> = {
  queued: { label: "chapter.exportPanel.status.queued", tone: "busy" },
  running: { label: "chapter.exportPanel.status.running", tone: "busy" },
  succeeded: { label: "chapter.exportPanel.status.succeeded", tone: "ok" },
  failed: { label: "chapter.exportPanel.status.failed", tone: "danger" },
  cancelled: { label: "chapter.exportPanel.status.cancelled", tone: "idle" },
  paused_budget: { label: "chapter.exportPanel.status.paused_budget", tone: "warn" },
};
/** Ngày giờ đầy đủ như `Date#toLocaleString()` mặc định. */
const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};
/** Lượt xuất gần đây của chương; poll khi còn lượt đang chạy. Dùng chung cho menu Xuất, Hoạt động và số việc. */
export function useExports(chapterId: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: exportKeys.list(chapterId),
    queryFn: () => fetchExports(chapterId),
    refetchInterval: (q) => exportPollInterval(q.state),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: exportKeys.list(chapterId) });
  return { q, refresh };
}

/** Tải file qua anchor `download` (API trả 302 kèm Content-Disposition attachment). */
export function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.append(a);
  a.click();
  a.remove();
}

/** Tổng chỗ cần xem trong 1 dòng tóm tắt (cùng tập với `warningLines`). */
const warnTotal = (w: ExportWarnings, includeUntranslated: boolean) =>
  (includeUntranslated ? 0 : w.untranslated) + w.empty + w.aiPending + w.overflow;

export function ExportPanel(props: {
  chapterId: string;
  /** Tên file không đuôi, khớp tên server đặt khi tải (`{series}-ch{số}`). */
  fileBase: string;
  /** `sources` = ảnh đã tải lên còn dùng; `pages` = trang đã cắt đang hiện. */
  counts: { sources: number; pages: number };
  warnings: ExportWarnings;
  /** "Xem N chỗ này" → bảng văn bản lọc "Cần xem" (menu đóng). */
  onShowWarnings(): void;
  /** Lưu phần đang sửa trước khi gửi job (server render từ state đã lưu). */
  beforeStart(): Promise<unknown>;
}) {
  const { chapterId, counts } = props;
  const { t, tp } = useT();
  const [format, setFormat] = useState<ExportFormat>("png_zip");
  const [chosenLayout, setLayout] = useState<ExportLayout>(DEFAULT_LAYOUT);
  const [quality, setQuality] = useState<CbzQuality>("high");
  const [includeUntranslated, setInclude] = useState(false);
  const { q: listQ, refresh } = useExports(chapterId);
  /**
   * Lượt xuất nút chính theo dõi và tự tải đúng 1 lần khi xong: lượt vừa gửi từ menu này, hoặc lượt còn chạy lúc
   * mở lại menu (đóng menu giữa chừng không mất tiến độ).
   */
  const [pending, setPending] = useState<ExportView | null>(() => latestActiveExport(listQ.data?.exports));
  // Danh sách chưa có lúc mở menu → nhận lượt còn chạy ở lần tải đầu.
  const adoptedRef = useRef(!!listQ.data);
  useEffect(() => {
    if (adoptedRef.current || !listQ.data) return;
    adoptedRef.current = true;
    const active = latestActiveExport(listQ.data.exports);
    if (active) setPending((p) => p ?? active);
  }, [listQ.data]);
  const downloadedRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1 ảnh tải lên = 1 trang → không hỏi cách chia, xuất như lúc tải lên.
  const layoutChoice = showLayoutChoice(counts);
  const layout = layoutChoice ? chosenLayout : DEFAULT_LAYOUT;
  const qualityValue = CBZ_QUALITY[quality].value;
  const options = { format, layout, quality: qualityValue, includeUntranslated };

  const start = useMutation({
    mutationFn: async () => {
      await props.beforeStart();
      return createExport(chapterId, {
        format,
        layout,
        quality: format === "cbz" ? qualityValue : undefined,
        include_untranslated: includeUntranslated,
      });
    },
    onMutate: () => setError(null),
    // `created:false` = lượt cùng tuỳ chọn đang chạy → theo dõi luôn lượt đó.
    onSuccess: (r) => {
      setPending(r.job);
      refresh();
    },
    onError: (e) => {
      const code = (e as { body?: { error?: string } }).body?.error;
      setError(code === "no_pages" ? t("chapter.exportPanel.noPages") : errorMessage(e));
    },
  });
  const exports = listQ.data?.exports ?? [];
  // Danh sách chưa kịp tải lại sau khi gửi: theo dõi bằng job server vừa trả.
  const tracked = pending && !exports.some((e) => e.id === pending.id) ? [pending, ...exports] : exports;
  const phase = exportPhase(tracked, pending?.id ?? null);
  const readyId = phase.kind === "ready" ? phase.id : null;
  const readyUrl = phase.kind === "ready" ? phase.url : null;

  useEffect(() => {
    if (!readyId || !readyUrl || downloadedRef.current === readyId) return;
    downloadedRef.current = readyId;
    triggerDownload(readyUrl);
  }, [readyId, readyUrl]);

  const lines = warningLines(props.warnings, { includeUntranslated });
  const review = reviewCount(props.warnings);
  const ext = FORMAT_LABEL[format].ext;
  // Poll lỗi khi đang chạy: vẫn poll lại theo nhịp, nhưng tạm chưa biết tiến độ → mở lại nút thay vì kẹt "Đang xuất".
  const lost = listQ.isError && phase.kind === "running";
  const running = phase.kind === "running" && !lost;
  const failure =
    error ??
    (phase.kind === "failed"
      ? phase.error
      : lost
        ? t("chapter.exportPanel.trackingLost", { error: errorMessage(listQ.error) })
        : null);

  const last = exports.find((x) => x.status === "succeeded");
  const lastExpired = !!last && last.expires_at !== null && Date.parse(last.expires_at) < Date.now();
  // Đang theo dõi một lượt (chạy / vừa xong / lỗi / hết hạn) thì trạng thái của nó đã hiện ở nút — "Lần trước" chỉ khi rảnh.
  const showLast = !!last && phase.kind === "idle";

  return (
    <>
      {lines.length > 0 && (
        <section aria-label={t("chapter.exportPanel.beforeExport")}>
          <details className="exp-warn">
            <summary>
              <span className="exp-warn-mark" aria-hidden="true">
                !
              </span>
              {tp("chapter.exportPanel.toReview", warnTotal(props.warnings, includeUntranslated))}
            </summary>
            <ul className="exp-warn-list small">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {review > 0 && (
              <span className="small">
                <button type="button" className="link" onClick={props.onShowWarnings}>
                  {t("chapter.exportPanel.showReview", { count: review })}
                </button>{" "}
                <span className="muted">{t("chapter.exportPanel.stillExportable")}</span>
              </span>
            )}
          </details>
        </section>
      )}

      <div className="exp-main" aria-live="polite">
        <button
          type="button"
          className="btn-primary exp-main-btn"
          disabled={start.isPending || running}
          onClick={() => start.mutate()}
        >
          {start.isPending ? (
            t("chapter.exportPanel.sending")
          ) : running ? (
            phase.kind === "running" && phase.paused ? (
              t("chapter.exportPanel.pausedButton")
            ) : (
              t("chapter.exportPanel.exportingPct", { pct: phase.pct })
            )
          ) : (
            <>
              <span aria-hidden="true">⬇</span> {t("chapter.exportPanel.downloadChapter", { ext })}
            </>
          )}
        </button>
        {phase.kind === "ready" && (
          <span className="small">
            {t("chapter.exportPanel.readyFallback")}{" "}
            <a className="btn" href={phase.url} download>
              {t("chapter.exportPanel.download")}
            </a>
          </span>
        )}
        {phase.kind === "running" && phase.paused && (
          <span className="muted small">{t("chapter.exportPanel.pausedHint")}</span>
        )}
        {phase.kind === "expired" && <span className="muted small">{t("chapter.exportPanel.expiredHint")}</span>}
        <span className="muted small">
          {t("chapter.exportPanel.fileName")}{" "}
          <span className="mono">{`${props.fileBase}.${EXPORT_FILE[format].ext}`}</span>
        </span>
      </div>
      {failure && (
        <p
          className="notice danger"
          role="alert"
          title={!error && phase.kind === "failed" ? (phase.detail ?? undefined) : undefined}
        >
          {failure} {t("chapter.exportPanel.retryHint")}
        </p>
      )}

      <details className="exp-options">
        <summary>
          <span className="exp-options-title">{t("chapter.exportPanel.options")}</span>
          <span className="muted small">{optionsSummary(options, counts)}</span>
        </summary>
        <div className="exp-options-body">
          <fieldset className="exp-field">
            <legend>{t("chapter.exportPanel.format")}</legend>
            <div className="drawer-choice exp-stack">
              {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((f) => (
                <label key={f}>
                  <input type="radio" name="exp-format" checked={format === f} onChange={() => setFormat(f)} />
                  {FORMAT_LABEL[f].long}
                </label>
              ))}
            </div>
          </fieldset>
          {format === "cbz" && (
            <fieldset className="exp-field">
              <legend>{t("chapter.exportPanel.quality")}</legend>
              <div className="exp-seg">
                {(Object.keys(CBZ_QUALITY) as CbzQuality[]).map((k) => (
                  <button key={k} type="button" aria-pressed={quality === k} onClick={() => setQuality(k)}>
                    {CBZ_QUALITY[k].label}
                  </button>
                ))}
              </div>
              <p className="muted small exp-hint">{t("chapter.exportPanel.qualityHint")}</p>
            </fieldset>
          )}
          {layoutChoice && (
            <fieldset className="exp-field">
              <legend>{t("chapter.exportPanel.layout")}</legend>
              <div className="drawer-choice exp-stack">
                {LAYOUT_CHOICES.map((c) => (
                  <label key={c.value}>
                    <input
                      type="radio"
                      name="exp-layout"
                      checked={layout === c.value}
                      onChange={() => setLayout(c.value)}
                    />
                    {c.label(counts)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="drawer-check">
            <input type="checkbox" checked={includeUntranslated} onChange={(e) => setInclude(e.target.checked)} />
            {t("chapter.exportPanel.includeUntranslated")}
          </label>
        </div>
      </details>

      {listQ.isError && (
        <p className="notice danger" role="alert">
          {errorMessage(listQ.error)}
        </p>
      )}
      {showLast && last && (
        <p className="exp-last small" title={t("chapter.exportPanel.linkTitle", { days: EXPORT_RETENTION_DAYS })}>
          <span className="grow">
            {t("chapter.exportPanel.last", { when: timeAgo(last.created_at), label: exportLabel(last) })}
          </span>
          {last.download_url && !lastExpired ? (
            <a className="btn" href={last.download_url} download>
              {t("chapter.exportPanel.redownload")}
            </a>
          ) : (
            <span className="muted exp-last-note">{t("chapter.exportPanel.lastExpired")}</span>
          )}
        </p>
      )}
    </>
  );
}

export function ExportRow({ x, cancelling, onCancel }: { x: ExportView; cancelling: boolean; onCancel(): void }) {
  const { t } = useT();
  const st = STATUS[x.status];
  const pct = Math.round(Math.min(1, Math.max(0, x.progress)) * 100);
  const expired = x.expires_at !== null && new Date(x.expires_at).getTime() < Date.now();
  const step = stageLabel({ type: "chapter.export", stage: x.stage, progress_done: null, progress_total: null });
  return (
    <div className="drawer-item" title={t("chapter.exportPanel.linkTitle", { days: EXPORT_RETENTION_DAYS })}>
      <div className="drawer-item-head">
        <span className="status" data-tone={st.tone}>
          {t(st.label)}
        </span>
        <span className="grow small">{exportLabel(x)}</span>
        {isExportActive(x.status) && (
          <button type="button" className="btn-danger" disabled={cancelling} onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
        {x.status === "succeeded" &&
          (x.download_url && !expired ? (
            <a className="btn btn-primary" href={x.download_url} download>
              {t("chapter.exportPanel.download")}
            </a>
          ) : (
            <span className="muted small">{t("chapter.exportPanel.expired")}</span>
          ))}
      </div>
      <span className="muted small">
        {fmtDate(x.created_at, DATE_TIME)}
        {x.bytes != null ? ` · ${formatBytes(x.bytes)}` : ""}
      </span>
      {isExportActive(x.status) && (
        <>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="muted small">
            {step ? `${step} · ` : ""}
            {pct}%
          </div>
        </>
      )}
      {x.status === "failed" && (x.error || x.error_class) && (
        <div className="small error" title={x.error ?? undefined}>
          {exportFailureText(x)}
        </div>
      )}
    </div>
  );
}
