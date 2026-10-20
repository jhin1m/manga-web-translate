/**
 * OCR vùng chọn: kéo khung (công cụ O) → POST /ocr-region → poll job → chèn region + text box vào state như
 * một thao tác editor (có undo, đi qua save). Khung đang chờ hiện viền đứt; lỗi báo trên panel.
 */
import type { Region } from "@mtl/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Layer, Rect } from "react-konva";
import { errorMessage } from "../../../lib/api.ts";
import { insertOcrRegion } from "../actions.ts";
import { type OcrRegionResult, startOcrRegion, waitJob } from "../api.ts";
import { editorStore } from "../store.ts";

export type PageRect = { x: number; y: number; w: number; h: number };
type Pending = PageRect & { id: string };

export function useOcrRegion(ws: string, pageId: string, defaultFont: string, page: { w: number; h: number }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef(new AbortController());

  // biome-ignore lint/correctness/useExhaustiveDependencies: đổi page → huỷ OCR đang chờ của page cũ.
  useEffect(() => {
    const ctl = new AbortController();
    abort.current = ctl;
    setPending([]);
    setError(null);
    return () => ctl.abort();
  }, [pageId]);

  const start = useCallback(
    async (r: PageRect) => {
      const id = crypto.randomUUID();
      const signal = abort.current.signal;
      setPending((p) => [...p, { ...r, id }]);
      setError(null);
      try {
        // Kẹp vào page sau khi làm tròn (làm tròn riêng x và w có thể vượt mép → server 400).
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(page.w, Math.ceil(r.x + r.w));
        const y1 = Math.min(page.h, Math.ceil(r.y + r.h));
        const bbox: [number, number, number, number] = [x0, y0, x1 - x0, y1 - y0];
        const { job } = await startOcrRegion(ws, pageId, bbox);
        const done = await waitJob(ws, job.id, signal);
        if (done.status !== "succeeded") throw new Error(done.error ?? "OCR vùng thất bại");
        const region = (done.result as OcrRegionResult | null)?.region as Region | undefined;
        if (!region) throw new Error("OCR không trả về vùng");
        const s = editorStore.getState();
        if (s.pageId !== pageId || !s.layout) return;
        const rid = `r-${crypto.randomUUID().slice(0, 8)}`;
        s.apply(insertOcrRegion(region, { region: rid, box: `tb-${rid}` }, defaultFont, s.layout));
        s.select(`tb-${rid}`);
      } catch (e) {
        if (!signal.aborted) setError(errorMessage(e));
      } finally {
        if (!signal.aborted) setPending((p) => p.filter((x) => x.id !== id));
      }
    },
    [ws, pageId, defaultFont, page.w, page.h],
  );

  return { pending, error, start };
}

/** Khung đang kéo + khung đang chờ OCR (toạ độ page đang sửa, đặt tại `offset` trên strip chương). */
export function OcrOverlay({
  draft,
  pending,
  offset = 0,
}: {
  draft: PageRect | null;
  pending: PageRect[];
  offset?: number;
}) {
  return (
    <Layer listening={false}>
      <Group y={offset}>
        {pending.map((r) => (
          <Rect
            key={`${r.x}:${r.y}:${r.w}`}
            {...r}
            stroke="#1f4fd1"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            dash={[6, 4]}
          />
        ))}
        {draft && (
          <Rect {...draft} stroke="#1f4fd1" strokeWidth={1.5} strokeScaleEnabled={false} fill="rgba(31,79,209,0.08)" />
        )}
      </Group>
    </Layer>
  );
}
