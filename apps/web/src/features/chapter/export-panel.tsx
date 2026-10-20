/**
 * Xuất chương (PNG zip / CBZ) trong drawer "Xuất chương": chọn tuỳ chọn → cảnh báo (chỉ thông tin) → gửi job →
 * polling tiến độ → tải qua link có xác thực (API trả 302 tới presigned GET 5'). Danh sách export gần đây + huỷ
 * job đang chạy (dùng lại ở drawer Hoạt động).
 */
import { EXPORT_FILE } from "@mtl/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import {
  cancelJob,
  createExport,
  type ExportFormat,
  type ExportStatus,
  type ExportView,
  exportKeys,
  fetchExports,
} from "./api.ts";
import type { Tone } from "./status.ts";
import { formatBytes } from "./text-utils.ts";

export const EXPORT_POLL_MS = 1500;

const STATUS: Record<ExportStatus, { label: string; tone: Tone }> = {
  queued: { label: "Đang chờ", tone: "busy" },
  running: { label: "Đang xuất", tone: "busy" },
  succeeded: { label: "Xong", tone: "ok" },
  failed: { label: "Lỗi", tone: "danger" },
  cancelled: { label: "Đã huỷ", tone: "idle" },
  paused_budget: { label: "Tạm dừng (hết ngân sách)", tone: "warn" },
};
const FORMAT: Record<ExportFormat, string> = { png_zip: "ZIP PNG", cbz: "CBZ" };
export const isExportActive = (s: ExportStatus) => s === "queued" || s === "running";

/** Export gần đây của chương; poll khi còn lượt đang chạy. Dùng chung cho drawer Xuất, Hoạt động và số việc. */
export function useExports(ws: string, chapterId: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: exportKeys.list(ws, chapterId),
    queryFn: () => fetchExports(ws, chapterId),
    refetchInterval: (q) =>
      q.state.status !== "error" && q.state.data?.exports.some((e) => isExportActive(e.status))
        ? EXPORT_POLL_MS
        : false,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: exportKeys.list(ws, chapterId) });
  return { q, refresh };
}

export function ExportPanel(props: {
  ws: string;
  chapterId: string;
  /** Tên file không đuôi, khớp tên server đặt khi tải (`{series}-ch{số}`). */
  fileBase: string;
  pageCount: number;
  warnings: string[];
  /** "Xem các khối này" → bảng văn bản lọc "Cần xem" (drawer đóng). */
  onShowWarnings(): void;
  /** Lưu phần đang sửa trước khi gửi job (server render từ state đã lưu). */
  beforeStart(): Promise<unknown>;
  onCancel(): void;
}) {
  const { ws, chapterId } = props;
  const [format, setFormat] = useState<ExportFormat>("png_zip");
  const [slices, setSlices] = useState(true);
  const [quality, setQuality] = useState(90);
  const [untranslated, setUntranslated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { q: listQ, refresh } = useExports(ws, chapterId);

  const start = useMutation({
    mutationFn: async () => {
      await props.beforeStart();
      return createExport(ws, chapterId, {
        format,
        layout: slices ? "original_slices" : "pages",
        quality: format === "cbz" ? quality : undefined,
        include_untranslated: untranslated,
      });
    },
    onSuccess: (r) => {
      setError(null);
      if (!r.created) setError("Đã có lượt xuất cùng tuỳ chọn đang chạy — theo dõi bên dưới.");
      refresh();
    },
    onError: (e) => {
      const code = (e as { body?: { error?: string } }).body?.error;
      setError(code === "no_pages" ? "Chương chưa có trang nào để xuất." : errorMessage(e));
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelJob(ws, id),
    onSettled: refresh,
    onError: (e) => setError(errorMessage(e)),
  });

  const exports = listQ.data?.exports ?? [];
  return (
    <>
      <section className="drawer-section">
        <h3>Phạm vi</h3>
        <p className="small" style={{ margin: 0 }}>
          Cả chương ({props.pageCount} trang)
        </p>
      </section>
      <section className="drawer-section">
        <h3>Định dạng</h3>
        <div className="drawer-choice" role="radiogroup" aria-label="Định dạng">
          {Object.entries(FORMAT).map(([v, l]) => (
            <label key={v}>
              <input
                type="radio"
                name="exp-format"
                value={v}
                checked={format === v}
                onChange={() => setFormat(v as ExportFormat)}
              />
              {l}
            </label>
          ))}
        </div>
        <label className="drawer-check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={slices} onChange={(e) => setSlices(e.target.checked)} />
          Cắt lại theo slice gốc (khớp ảnh đã tải lên)
        </label>
        {!slices && <p className="muted small">Mỗi trang đã cắt thành 1 ảnh.</p>}
        {format === "cbz" ? (
          <div style={{ maxWidth: 200, marginTop: 8 }}>
            <label htmlFor="exp-quality">Chất lượng (1–100)</label>
            <input
              id="exp-quality"
              type="number"
              min={1}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Math.min(100, Math.max(1, Number(e.target.value) || 90)))}
            />
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Dưới 100: ảnh nén JPEG (nhẹ hơn, có mất chi tiết). 100: PNG nguyên bản.
            </p>
          </div>
        ) : (
          <p className="muted small">PNG luôn không mất dữ liệu.</p>
        )}
        <label className="drawer-check">
          <input type="checkbox" checked={untranslated} onChange={(e) => setUntranslated(e.target.checked)} />
          Gồm cả trang chưa dịch (ảnh đã xoá chữ/ảnh gốc)
        </label>
      </section>
      {props.warnings.length > 0 && (
        <section className="drawer-warn" aria-label="Trước khi xuất">
          <strong className="small">Trước khi xuất</strong>
          <span className="small">{props.warnings.join(" · ")}</span>
          <span className="small">
            <button type="button" className="link" onClick={props.onShowWarnings}>
              Xem các khối này trong bảng văn bản
            </button>{" "}
            <span className="muted">— vẫn xuất được.</span>
          </span>
        </section>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Tên file: <span className="mono">{`${props.fileBase}.${EXPORT_FILE[format].ext}`}</span> · link tải hiệu lực 5
        phút, file giữ 7 ngày.
      </p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" onClick={props.onCancel}>
          Huỷ
        </button>
        <button type="button" className="btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? "Đang gửi…" : `Xuất ${FORMAT[format]}`}
        </button>
      </div>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}

      <section className="drawer-section">
        <h3>Lượt xuất gần đây</h3>
        {listQ.isError && <p className="notice danger">{errorMessage(listQ.error)}</p>}
        {!listQ.isError && exports.length === 0 && (
          <p className="muted small">{listQ.isLoading ? "Đang tải…" : "Chưa có lượt xuất nào."}</p>
        )}
        <div className="drawer-list">
          {exports.map((x) => (
            <ExportRow key={x.id} x={x} cancelling={cancel.isPending} onCancel={() => cancel.mutate(x.id)} />
          ))}
        </div>
      </section>
    </>
  );
}

export function ExportRow({ x, cancelling, onCancel }: { x: ExportView; cancelling: boolean; onCancel(): void }) {
  const st = STATUS[x.status];
  const pct = Math.round(Math.min(1, Math.max(0, x.progress)) * 100);
  const expired = x.expires_at !== null && new Date(x.expires_at).getTime() < Date.now();
  return (
    <div className="drawer-item">
      <div className="drawer-item-head">
        <span className="status" data-tone={st.tone}>
          {st.label}
        </span>
        <span className="grow small">
          {FORMAT[x.format]} · {x.layout === "original_slices" ? "theo slice gốc" : "theo trang"}
          {x.format === "cbz" ? ` · q${x.quality}` : ""}
          {x.include_untranslated ? " · gồm trang chưa dịch" : ""}
        </span>
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
            {pct}%{x.stage ? ` · ${x.stage}` : ""}
          </div>
        </>
      )}
      {x.status === "failed" && x.error && <div className="small error">{x.error}</div>}
    </div>
  );
}
