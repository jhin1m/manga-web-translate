/**
 * Xuất chương (PNG zip / CBZ): chọn tuỳ chọn → gửi job → polling tiến độ → tải qua link có xác thực
 * (API trả 302 tới presigned GET 5'). Danh sách export gần đây + huỷ job đang chạy.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Modal } from "./Modal.tsx";
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
const FORMAT: Record<ExportFormat, string> = { png_zip: "PNG (zip)", cbz: "CBZ" };
const LAYOUT: Record<ExportLayout, string> = { original_slices: "Theo slice gốc", pages: "Theo trang" };
const isActive = (s: ExportStatus) => s === "queued" || s === "running";

export function ExportDialog({ ws, chapterId, onClose }: { ws: string; chapterId: string; onClose(): void }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<ExportFormat>("png_zip");
  const [layout, setLayout] = useState<ExportLayout>("original_slices");
  const [quality, setQuality] = useState(90);
  const [untranslated, setUntranslated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: exportKeys.list(ws, chapterId),
    queryFn: () => fetchExports(ws, chapterId),
    refetchInterval: (q) =>
      q.state.status !== "error" && q.state.data?.exports.some((e) => isActive(e.status)) ? EXPORT_POLL_MS : false,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: exportKeys.list(ws, chapterId) });

  const start = useMutation({
    mutationFn: () =>
      createExport(ws, chapterId, {
        format,
        layout,
        quality: format === "cbz" ? quality : undefined,
        include_untranslated: untranslated,
      }),
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
    <Modal title="Xuất chương" onClose={onClose}>
      <div className="grid-2">
        <div>
          <label htmlFor="exp-format">Định dạng</label>
          <select id="exp-format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {Object.entries(FORMAT).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exp-layout">Bố cục ảnh</label>
          <select id="exp-layout" value={layout} onChange={(e) => setLayout(e.target.value as ExportLayout)}>
            {Object.entries(LAYOUT).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      {format === "cbz" && (
        <div style={{ maxWidth: 240 }}>
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
      )}
      {format === "png_zip" && (
        <p className="muted small">PNG luôn không mất dữ liệu — chất lượng chỉ áp dụng cho CBZ.</p>
      )}
      <label className="row" style={{ margin: "12px 0 0", gap: 6 }}>
        <input type="checkbox" checked={untranslated} onChange={(e) => setUntranslated(e.target.checked)} />
        Gồm cả trang chưa dịch (xuất ảnh đã xoá chữ/ảnh gốc)
      </label>

      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? "Đang gửi…" : "Xuất"}
        </button>
      </div>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}

      <div className="section">
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--fs-md)" }}>Lượt xuất gần đây</h3>
        {listQ.isError && <p className="notice danger">{errorMessage(listQ.error)}</p>}
        {!listQ.isError && exports.length === 0 && (
          <p className="muted small">{listQ.isLoading ? "Đang tải…" : "Chưa có lượt xuất nào."}</p>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          {exports.map((x) => (
            <ExportRow key={x.id} x={x} cancelling={cancel.isPending} onCancel={() => cancel.mutate(x.id)} />
          ))}
        </div>
        <p className="muted small">File xuất được xoá sau 7 ngày; link tải mỗi lần bấm chỉ có hiệu lực 5 phút.</p>
      </div>
    </Modal>
  );
}

function ExportRow({ x, cancelling, onCancel }: { x: ExportView; cancelling: boolean; onCancel(): void }) {
  const st = STATUS[x.status];
  const pct = Math.round(Math.min(1, Math.max(0, x.progress)) * 100);
  const expired = x.expires_at !== null && new Date(x.expires_at).getTime() < Date.now();
  return (
    <div style={{ border: "1px solid var(--c-line)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span className="status" data-tone={st.tone}>
            {st.label}
          </span>
          <span className="small">
            {FORMAT[x.format]} · {LAYOUT[x.layout]}
            {x.format === "cbz" ? ` · q${x.quality}` : ""}
            {x.include_untranslated ? " · gồm trang chưa dịch" : ""}
          </span>
        </div>
        <div className="row">
          <span className="muted small">
            {new Date(x.created_at).toLocaleString("vi-VN")}
            {x.bytes != null ? ` · ${formatBytes(x.bytes)}` : ""}
          </span>
          {isActive(x.status) && (
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
      </div>
      {isActive(x.status) && (
        <>
          <div
            className="bar"
            style={{ marginTop: 8 }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
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
