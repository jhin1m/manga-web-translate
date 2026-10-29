/**
 * Xuất chương (.zip ảnh / .cbz) trong drawer "Xuất chương": cảnh báo nói hậu quả → tuỳ chọn thu gọn (1 dòng tóm
 * tắt) → 1 nút tải: gửi job → tiến độ ngay tại nút → xong tự tải qua link có xác thực (API trả 302 tới presigned
 * GET 5'); link "Tải xuống" tại chỗ phòng trình duyệt chặn tự tải. Danh sách lượt xuất trước + huỷ job đang chạy
 * (ExportRow dùng lại ở drawer Hoạt động).
 */
import { EXPORT_FILE, EXPORT_RETENTION_DAYS } from "@mtl/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import {
  cancelJob,
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

const STATUS: Record<ExportStatus, { label: string; tone: Tone }> = {
  queued: { label: "Đang chờ", tone: "busy" },
  running: { label: "Đang xuất", tone: "busy" },
  succeeded: { label: "Xong", tone: "ok" },
  failed: { label: "Lỗi", tone: "danger" },
  cancelled: { label: "Đã huỷ", tone: "idle" },
  paused_budget: { label: "Tạm dừng (hết ngân sách)", tone: "warn" },
};
/** Export gần đây của chương; poll khi còn lượt đang chạy. Dùng chung cho drawer Xuất, Hoạt động và số việc. */
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

export function ExportPanel(props: {
  chapterId: string;
  /** Tên file không đuôi, khớp tên server đặt khi tải (`{series}-ch{số}`). */
  fileBase: string;
  /** `sources` = ảnh đã tải lên còn dùng; `pages` = trang đã cắt đang hiện. */
  counts: { sources: number; pages: number };
  warnings: ExportWarnings;
  /** "Xem N chỗ này" → bảng văn bản lọc "Cần xem" (drawer đóng). */
  onShowWarnings(): void;
  /** Lưu phần đang sửa trước khi gửi job (server render từ state đã lưu). */
  beforeStart(): Promise<unknown>;
}) {
  const { chapterId, counts } = props;
  const [format, setFormat] = useState<ExportFormat>("png_zip");
  const [chosenLayout, setLayout] = useState<ExportLayout>(DEFAULT_LAYOUT);
  const [quality, setQuality] = useState<CbzQuality>("high");
  const [includeUntranslated, setInclude] = useState(false);
  const { q: listQ, refresh } = useExports(chapterId);
  /**
   * Lượt xuất nút chính theo dõi và tự tải đúng 1 lần khi xong: lượt vừa gửi từ drawer này, hoặc lượt còn chạy lúc
   * mở lại drawer (đóng drawer giữa chừng không mất việc tự tải).
   */
  const [pending, setPending] = useState<ExportView | null>(() => latestActiveExport(listQ.data?.exports));
  // Danh sách chưa có lúc mở drawer → nhận lượt còn chạy ở lần tải đầu.
  const adoptedRef = useRef(!!listQ.data);
  useEffect(() => {
    if (adoptedRef.current || !listQ.data) return;
    adoptedRef.current = true;
    const active = latestActiveExport(listQ.data.exports);
    if (active) setPending((p) => p ?? active);
  }, [listQ.data]);
  const downloadedRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
      setError(code === "no_pages" ? "Chương chưa có trang nào để xuất." : errorMessage(e));
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelJob(id),
    onSettled: refresh,
    onMutate: () => setCancelError(null),
    onError: (e) => setCancelError(errorMessage(e)),
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
    (phase.kind === "failed" ? phase.error : lost ? `Không theo dõi được tiến độ: ${errorMessage(listQ.error)}` : null);

  return (
    <>
      {lines.length > 0 && (
        <section className="drawer-warn" aria-label="Trước khi xuất">
          <strong className="small">Trước khi xuất</strong>
          <ul className="exp-warn-list small">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {review > 0 && (
            <span className="small">
              <button type="button" className="link" onClick={props.onShowWarnings}>
                Xem {review} chỗ này
              </button>{" "}
              <span className="muted">— vẫn xuất được.</span>
            </span>
          )}
        </section>
      )}

      <details className="exp-options">
        <summary>
          <span className="exp-options-title">Tuỳ chọn</span>
          <span className="muted small">{optionsSummary(options, counts)}</span>
        </summary>
        <div className="exp-options-body">
          <fieldset className="exp-field">
            <legend>Định dạng</legend>
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
              <legend>Chất lượng ảnh</legend>
              <div className="exp-seg">
                {(Object.keys(CBZ_QUALITY) as CbzQuality[]).map((k) => (
                  <button key={k} type="button" aria-pressed={quality === k} onClick={() => setQuality(k)}>
                    {CBZ_QUALITY[k].label}
                  </button>
                ))}
              </div>
              <p className="muted small exp-hint">Gốc: ảnh PNG nguyên bản. Cao/Nhẹ: nén JPEG, file nhỏ hơn.</p>
            </fieldset>
          )}
          {layoutChoice && (
            <fieldset className="exp-field">
              <legend>Cách chia ảnh</legend>
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
            Đưa cả trang chưa dịch vào (ảnh gốc, chưa có bản dịch)
          </label>
        </div>
      </details>

      <div className="exp-main" aria-live="polite">
        <button
          type="button"
          className="btn-primary exp-main-btn"
          disabled={start.isPending || running}
          onClick={() => start.mutate()}
        >
          {start.isPending ? (
            "Đang gửi…"
          ) : running ? (
            phase.kind === "running" && phase.paused ? (
              "Tạm dừng — hết ngân sách"
            ) : (
              `Đang xuất ${phase.pct}%…`
            )
          ) : (
            <>
              <span aria-hidden="true">⬇</span> Tải chương ({ext})
            </>
          )}
        </button>
        {phase.kind === "ready" && (
          <span className="small">
            Đã xong. Nếu file chưa tự tải:{" "}
            <a className="btn" href={phase.url} download>
              Tải xuống
            </a>
          </span>
        )}
        {phase.kind === "running" && phase.paused && (
          <span className="muted small">Hết ngân sách AI — tự xuất tiếp khi có lại, không cần bấm lại.</span>
        )}
        {phase.kind === "expired" && <span className="muted small">Link đã hết hạn — bấm tải lại để xuất mới.</span>}
        <span className="muted small">
          Tên file: <span className="mono">{`${props.fileBase}.${EXPORT_FILE[format].ext}`}</span>
        </span>
      </div>
      {failure && (
        <p className="notice danger" role="alert">
          {failure} Bấm “Tải chương” để thử lại.
        </p>
      )}

      <details className="exp-history">
        <summary>Lượt xuất trước ({exports.length})</summary>
        <div className="exp-history-body">
          {listQ.isError && <p className="notice danger">{errorMessage(listQ.error)}</p>}
          {cancelError && (
            <p className="notice danger" role="alert">
              {cancelError}
            </p>
          )}
          {!listQ.isError && exports.length === 0 && (
            <p className="muted small">{listQ.isLoading ? "Đang tải…" : "Chưa có lượt xuất nào."}</p>
          )}
          <div className="drawer-list">
            {exports.map((x) => (
              <ExportRow key={x.id} x={x} cancelling={cancel.isPending} onCancel={() => cancel.mutate(x.id)} />
            ))}
          </div>
        </div>
      </details>
    </>
  );
}

export function ExportRow({ x, cancelling, onCancel }: { x: ExportView; cancelling: boolean; onCancel(): void }) {
  const st = STATUS[x.status];
  const pct = Math.round(Math.min(1, Math.max(0, x.progress)) * 100);
  const expired = x.expires_at !== null && new Date(x.expires_at).getTime() < Date.now();
  const step = stageLabel({ type: "chapter.export", stage: x.stage, progress_done: null, progress_total: null });
  return (
    <div className="drawer-item" title={`Link tải hiệu lực 5 phút, file giữ ${EXPORT_RETENTION_DAYS} ngày`}>
      <div className="drawer-item-head">
        <span className="status" data-tone={st.tone}>
          {st.label}
        </span>
        <span className="grow small">{exportLabel(x)}</span>
        {isExportActive(x.status) && (
          <button type="button" className="btn-danger" disabled={cancelling} onClick={onCancel}>
            Huỷ
          </button>
        )}
        {x.status === "succeeded" &&
          (x.download_url && !expired ? (
            <a className="btn btn-primary" href={x.download_url} download>
              Tải xuống
            </a>
          ) : (
            <span className="muted small">Đã hết hạn</span>
          ))}
      </div>
      <span className="muted small">
        {new Date(x.created_at).toLocaleString("vi-VN")}
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
      {x.status === "failed" && x.error && <div className="small error">{x.error}</div>}
    </div>
  );
}
