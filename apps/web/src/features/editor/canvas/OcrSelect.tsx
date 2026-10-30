/**
 * OCR vùng chọn: kéo khung (công cụ O) → POST /ocr-region → poll job → chèn region + text box vào state như
 * một thao tác editor (có undo, đi qua save). "Dịch lại khối" 1 vùng có sẵn (panel Chọn, thanh nổi): cùng job trên bbox của vùng,
 * kết quả thay chữ gốc + bản dịch của vùng đó. Khung đang chờ hiện viền đứt; lỗi báo trên panel.
 */
import type { Region } from "@mtl/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Layer, Rect } from "react-konva";
import { errorMessage } from "../../../lib/api.ts";
import { cancelJob } from "../../chapter/api.ts";
import { insertOcrRegion, refreshRegionFromOcr } from "../actions.ts";
import { type OcrRegionResult, startOcrRegion, waitJob } from "../api.ts";
import { ocrRetryNote } from "../ocr-wait.ts";
import { editorStore } from "../store.ts";
import { SELECT_FILL, SELECT_STROKE } from "./colors.ts";

export type PageRect = { x: number; y: number; w: number; h: number };
type Pending = PageRect & { id: string };

export function useOcrRegion(pageId: string, defaultFont: string, page: { w: number; h: number }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const abort = useRef(new AbortController());
  /** Mỗi lần OCR đang chờ: huỷ riêng (người dùng bấm Huỷ) + job id để báo server dừng. */
  const waits = useRef(new Map<string, { ctl: AbortController; jobId: string | null }>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: đổi page → huỷ OCR đang chờ của page cũ.
  useEffect(() => {
    const ctl = new AbortController();
    abort.current = ctl;
    setPending([]);
    setError(null);
    setRetry(null);
    const mine = waits.current;
    mine.clear();
    return () => {
      ctl.abort();
      // Kết quả page cũ luôn bị bỏ → báo server dừng job, khỏi tốn AI vô ích.
      for (const w of mine.values()) if (w.jobId) void cancelJob(w.jobId).catch(() => undefined);
      mine.clear();
    };
  }, [pageId]);

  const start = useCallback(
    /** `regionId`: OCR lại vùng đó thay vì chèn vùng mới. */
    async (r: PageRect, regionId?: string) => {
      const id = crypto.randomUUID();
      const pageSignal = abort.current.signal;
      const own = new AbortController();
      const signal = AbortSignal.any([pageSignal, own.signal]);
      const wait: { ctl: AbortController; jobId: string | null } = { ctl: own, jobId: null };
      waits.current.set(id, wait);
      setPending((p) => [...p, { ...r, id }]);
      setError(null);
      try {
        // Kẹp vào page sau khi làm tròn (làm tròn riêng x và w có thể vượt mép → server 400).
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(page.w, Math.ceil(r.x + r.w));
        const y1 = Math.min(page.h, Math.ceil(r.y + r.h));
        const bbox: [number, number, number, number] = [x0, y0, x1 - x0, y1 - y0];
        const { job } = await startOcrRegion(pageId, bbox);
        wait.jobId = job.id;
        // Đã huỷ từ lúc POST còn bay (chưa có job id để báo server) → huỷ ngay khi có id.
        if (signal.aborted) void cancelJob(job.id).catch(() => undefined);
        const done = await waitJob(job.id, signal, undefined, (j) => {
          if (!signal.aborted) setRetry(ocrRetryNote(j));
        });
        if (done.status !== "succeeded") throw new Error(done.error ?? "OCR vùng thất bại");
        const region = (done.result as OcrRegionResult | null)?.region as Region | undefined;
        if (!region) throw new Error("OCR không trả về vùng");
        const s = editorStore.getState();
        if (s.pageId !== pageId || !s.layout) return;
        if (regionId) {
          s.apply(refreshRegionFromOcr(regionId, region, s.layout));
          return;
        }
        const rid = `r-${crypto.randomUUID().slice(0, 8)}`;
        s.apply(insertOcrRegion(region, { region: rid, box: `tb-${rid}` }, defaultFont, s.layout));
        s.select(`tb-${rid}`);
      } catch (e) {
        if (!signal.aborted) setError(errorMessage(e));
      } finally {
        waits.current.delete(id);
        if (!pageSignal.aborted) {
          setPending((p) => p.filter((x) => x.id !== id));
          if (!waits.current.size) setRetry(null);
        }
      }
    },
    [pageId, defaultFont, page.w, page.h],
  );

  /** Thôi chờ mọi OCR đang chạy ở page này (không áp kết quả) và báo server huỷ job (best-effort). */
  const cancel = useCallback(() => {
    for (const w of waits.current.values()) {
      w.ctl.abort();
      if (w.jobId) void cancelJob(w.jobId).catch(() => undefined);
    }
  }, []);

  return { pending, error, retry, start, cancel };
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
            stroke={SELECT_STROKE}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            dash={[6, 4]}
          />
        ))}
        {draft && (
          <Rect {...draft} stroke={SELECT_STROKE} strokeWidth={1.5} strokeScaleEnabled={false} fill={SELECT_FILL} />
        )}
      </Group>
    </Layer>
  );
}
