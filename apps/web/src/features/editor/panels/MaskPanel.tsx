/**
 * Panel công cụ Mask (B) / Tẩy nét mask (E): đổi Tô ↔ Tẩy nét, cỡ bút, bỏ nét, gửi xoá chữ. Luồng reinpaint: PNG
 * theo vùng có nét → presigned POST (≤ 5MB) → POST /reinpaint {user_mask_key, offset, base_clean_rev} → poll job →
 * báo `onDone` để tải lại page (layer clean chuyển sang clean_rev mới). Nét mask không vào undo/page_state.
 */
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../lib/api.ts";
import { requestMaskUpload, startReinpaint, uploadMask, waitJob } from "../api.ts";
import { renderMaskPng } from "../canvas/MaskLayer.tsx";
import { editorStore, useEditor } from "../store.ts";

export function MaskPanel(props: {
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
    <section className="ed-mask">
      <ol className="small muted ed-steps">
        <li>Tô (đỏ) lên chữ còn sót trên ảnh. Vòng tròn theo chuột là cỡ bút.</li>
        <li>Tô lố thì chọn "Tẩy nét" và kéo qua phần đỏ thừa — chỉ xoá nét tô, không đụng ảnh.</li>
        <li>Bấm "Xoá chữ vùng đã tô" — AI xoá chữ trong vùng đỏ.</li>
      </ol>
      <fieldset className="ed-seg" aria-label="Chế độ bút">
        <button
          type="button"
          aria-pressed={tool === "brush"}
          className={tool === "brush" ? "on" : undefined}
          onClick={() => editorStore.getState().setTool("brush")}
        >
          Tô (B)
        </button>
        <button
          type="button"
          aria-pressed={tool === "eraser"}
          className={tool === "eraser" ? "on" : undefined}
          onClick={() => editorStore.getState().setTool("eraser")}
        >
          Tẩy nét (E)
        </button>
      </fieldset>
      <label htmlFor="ed-brush">Cỡ bút: {size}px</label>
      <input
        id="ed-brush"
        type="range"
        min={4}
        max={160}
        value={size}
        onChange={(e) => editorStore.getState().setMask({ size: Number(e.target.value) })}
      />
      <div className="ed-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!!busy || readOnly || !hasPaint}
          title={hasPaint ? undefined : "Tô lên ảnh trước"}
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
