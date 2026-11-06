/**
 * Nội dung thanh phụ công cụ Tẩy chữ (B) / Tẩy nét (E) trên canvas (khung thanh: chapter/tool-panels.tsx): đổi Tô ↔ Tẩy nét, cỡ bút, bỏ nét, gửi xoá chữ. Luồng reinpaint: PNG
 * theo vùng có nét → presigned POST (≤ 5MB) → POST /reinpaint {user_mask_key, offset, base_clean_rev} → poll job →
 * báo `onDone` để tải lại page (layer clean chuyển sang clean_rev mới). Nét mask không vào undo/page_state.
 */
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../lib/api.ts";
import { requestMaskUpload, startReinpaint, uploadMask, waitJob } from "../api.ts";
import { renderMaskPng } from "../canvas/MaskLayer.tsx";
import { editorStore, useEditor } from "../store.ts";

export function MaskToolBar(props: {
  pageId: string;
  cleanRev: number | null;
  page: { w: number; h: number };
  onDone(): void;
}) {
  const strokes = useEditor((s) => s.mask.strokes);
  const size = useEditor((s) => s.mask.size);
  const readOnly = useEditor((s) => !!s.readOnly);
  const tool = useEditor((s) => s.tool);
  /** Chỉ có nét tẩy thì chưa có gì để gửi (renderMaskPng sẽ báo lỗi). */
  const hasPaint = strokes.some((st) => st.mode === "paint");
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
      const post = await requestMaskUpload(props.pageId);
      await uploadMask(post, blob);
      setBusy("Đang xoá chữ vùng đã vẽ…");
      const { job } = await startReinpaint(props.pageId, {
        user_mask_key: post.key,
        offset,
        base_clean_rev: props.cleanRev,
      });
      const done = await waitJob(job.id, ctl.signal, 1000);
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
    <>
      <fieldset className="ed-seg" aria-label="Chế độ bút">
        <button
          type="button"
          title="Tô (B)"
          aria-pressed={tool === "brush"}
          className={tool === "brush" ? "on" : undefined}
          onClick={() => editorStore.getState().setTool("brush")}
        >
          Tô
        </button>
        <button
          type="button"
          title="Tẩy nét (E) — xoá nét tô thừa, không đụng ảnh"
          aria-pressed={tool === "eraser"}
          className={tool === "eraser" ? "on" : undefined}
          onClick={() => editorStore.getState().setTool("eraser")}
        >
          Tẩy nét
        </button>
      </fieldset>
      <label className="cw-check" htmlFor="ed-brush">
        Cỡ
        <input
          id="ed-brush"
          type="range"
          min={4}
          max={160}
          value={size}
          title="Cỡ bút — vòng tròn theo chuột trên ảnh"
          onChange={(e) => editorStore.getState().setMask({ size: Number(e.target.value) })}
        />
        <span className="cw-toolbar-value">{size}</span>
      </label>
      {tool === "eraser" && !hasPaint && <span className="muted">Chưa có nét tô để tẩy</span>}
      <button
        type="button"
        className="btn-ghost"
        disabled={!!busy || strokes.length === 0}
        onClick={() => editorStore.getState().setMask({ strokes: [] })}
      >
        Bỏ nét
      </button>
      <button
        type="button"
        className="btn-primary"
        disabled={!!busy || readOnly || !hasPaint}
        title={hasPaint ? "AI xoá chữ trong vùng đã tô" : "Tô lên chữ còn sót trên ảnh trước"}
        onClick={() => void run()}
      >
        Xoá chữ vùng tô
      </button>
      {busy && (
        <span className="status" data-tone="busy" role="status">
          {busy}
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
