/**
 * Mask → reinpaint: cỡ bút, xoá nét, gửi. Luồng: PNG theo vùng có nét → presigned POST (≤ 5MB) →
 * POST /reinpaint {user_mask_key, offset, base_clean_rev} → poll job → báo `onDone` để tải lại page
 * (layer clean chuyển sang clean_rev mới). Nét mask không vào undo/page_state.
 */
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../lib/api.ts";
import { requestMaskUpload, startReinpaint, uploadMask, waitJob } from "../api.ts";
import { renderMaskPng } from "../canvas/MaskLayer.tsx";
import { editorStore, useEditor } from "../store.ts";

export function MaskPanel(props: {
  ws: string;
  pageId: string;
  cleanRev: number | null;
  page: { w: number; h: number };
  onDone(): void;
}) {
  const strokes = useEditor((s) => s.mask.strokes);
  const size = useEditor((s) => s.mask.size);
  const readOnly = useEditor((s) => !!s.readOnly);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    if (props.cleanRev === null) return setError("Trang chưa có ảnh đã xoá chữ.");
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    try {
      setBusy("Đang tạo mask…");
      const { blob, offset } = await renderMaskPng(strokes, props.page);
      setBusy("Đang tải mask lên…");
      const post = await requestMaskUpload(props.ws, props.pageId);
      await uploadMask(post, blob);
      setBusy("Đang xoá chữ vùng đã vẽ…");
      const { job } = await startReinpaint(props.ws, props.pageId, {
        user_mask_key: post.key,
        offset,
        base_clean_rev: props.cleanRev,
      });
      const done = await waitJob(props.ws, job.id, ctl.signal, 1000);
      if (done.status !== "succeeded") throw new Error(done.error ?? "Xoá chữ thất bại");
      if (editorStore.getState().pageId === props.pageId) editorStore.getState().setMask({ strokes: [] });
      props.onDone();
    } catch (e) {
      if (!ctl.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!ctl.signal.aborted) setBusy(null);
    }
  };

  return (
    <section className="ed-mask">
      <h3>Xoá chữ sót (mask)</h3>
      <label htmlFor="ed-brush">Cỡ bút: {size}px</label>
      <input
        id="ed-brush"
        type="range"
        min={4}
        max={160}
        value={size}
        onChange={(e) => editorStore.getState().setMask({ size: Number(e.target.value) })}
      />
      <p className="small muted">B: tô vùng cần xoá · E: tẩy nét tô. Chỉ vùng tô được gửi đi.</p>
      <div className="ed-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!!busy || readOnly || strokes.length === 0}
          onClick={() => void run()}
        >
          Xoá chữ vùng đã tô
        </button>
        <button
          type="button"
          disabled={!!busy || strokes.length === 0}
          onClick={() => editorStore.getState().setMask({ strokes: [] })}
        >
          Bỏ nét
        </button>
      </div>
      {busy && (
        <p className="small">
          <span className="status" data-tone="busy">
            {busy}
          </span>
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
