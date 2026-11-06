/**
 * OCR vùng chọn: kéo khung (công cụ R) → xác nhận (thanh nổi cạnh khung / Enter) → POST /ocr-region → poll job →
 * chèn region + text box vào state như một thao tác editor (có undo, đi qua save). "Dịch lại khối" 1 vùng có sẵn (panel Chọn, thanh nổi): cùng job trên bbox của vùng,
 * kết quả thay chữ gốc + bản dịch của vùng đó. Khung đang chờ hiện viền đứt; lỗi báo trên panel.
 * Khung mới (không phải "Dịch lại khối") + bật "Xoá chữ gốc": khối chữ chèn xong → khung vào hàng xoá chữ của page
 * (erase-queue.ts), ảnh sạch cập nhật sau. Chỉ xoá khi đã có khối dịch (OCR lỗi / huỷ → chữ gốc giữ nguyên, vì xoá
 * ảnh sạch không hoàn tác được). Hàng xoá mỗi page sống tới khi rời chương: đổi trang / "Huỷ OCR" không bỏ lần xoá
 * của khối đã chèn.
 */
import type { Region } from "@mtl/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Group, Layer, Rect } from "react-konva";
import { errorMessage } from "../../../lib/api.ts";
import { cancelJob } from "../../chapter/api.ts";
import { insertOcrRegion, refreshRegionFromOcr } from "../actions.ts";
import { type OcrRegionResult, startOcrRegion, startReinpaint, waitJob } from "../api.ts";
import { createEraseQueue, type EraseQueue } from "../erase-queue.ts";
import { ocrRetryNote, ocrStallNote } from "../ocr-wait.ts";
import { blockBarPos, type Size } from "../page-layout.ts";
import { editorStore, type View } from "../store.ts";
import { SELECT_FILL, SELECT_STROKE } from "./colors.ts";

export type PageRect = { x: number; y: number; w: number; h: number };
type Pending = PageRect & { id: string };

/** Xoá chữ gốc trong khung OCR: bật/tắt, clean_rev đang biết của từng page, tải lại ảnh khi xoá xong. */
export type OcrEraseOptions = { enabled: boolean; cleanRevOf(pageId: string): number | null; onErased(): void };

export function useOcrRegion(
  pageId: string,
  defaultFont: string,
  page: { w: number; h: number },
  erase: OcrEraseOptions,
) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  /** Số lần xoá đang chờ theo page (hàng xoá của page cũ vẫn chạy sau khi đổi trang). */
  const [erasingBy, setErasingBy] = useState<Record<string, number>>({});
  const [eraseError, setEraseError] = useState<string | null>(null);
  const abort = useRef(new AbortController());
  /** Mỗi lần OCR đang chờ: huỷ riêng (người dùng bấm Huỷ) + job id để báo server dừng. */
  const waits = useRef(new Map<string, { ctl: AbortController; jobId: string | null }>());
  // Đọc qua ref: hàng xoá sống theo page, không dựng lại mỗi lần rev/callback đổi.
  const eraseRef = useRef(erase);
  eraseRef.current = erase;
  const queues = useRef(new Map<string, EraseQueue>());

  const queueFor = useCallback((pid: string) => {
    let q = queues.current.get(pid);
    if (!q) {
      q = createEraseQueue(pid, {
        start: startReinpaint,
        wait: (id, signal) => waitJob(id, signal, 1000),
        cleanRev: () => eraseRef.current.cleanRevOf(pid),
        onErased: () => eraseRef.current.onErased(),
        onState: (st) => {
          setErasingBy((m) => ({ ...m, [pid]: st.pending }));
          if (st.error || st.pending === 0) setEraseError(st.error);
        },
        errorText: errorMessage,
      });
      queues.current.set(pid, q);
    }
    return q;
  }, []);

  // Rời chương: thôi chờ mọi hàng xoá (job đã gửi vẫn chạy xong ở server và tự ghi ảnh sạch mới).
  useEffect(() => {
    const all = queues.current;
    return () => {
      for (const q of all.values()) q.dispose();
      all.clear();
    };
  }, []);

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
        const sentAt = Date.now();
        const done = await waitJob(job.id, signal, undefined, (j) => {
          if (!signal.aborted) setRetry(ocrRetryNote(j) ?? ocrStallNote(j, Date.now() - sentAt));
        });
        if (done.status !== "succeeded") throw new Error(done.error ?? "Quét chữ vùng thất bại");
        const region = (done.result as OcrRegionResult | null)?.region as Region | undefined;
        if (!region) throw new Error("Quét chữ không trả về vùng");
        const s = editorStore.getState();
        if (s.pageId !== pageId || !s.layout) return;
        if (regionId) {
          s.apply(refreshRegionFromOcr(regionId, region, s.layout));
          return;
        }
        const rid = `r-${crypto.randomUUID().slice(0, 8)}`;
        s.apply(insertOcrRegion(region, { region: rid, box: `tb-${rid}` }, defaultFont, s.layout));
        s.select(`tb-${rid}`);
        if (eraseRef.current.enabled) queueFor(pageId).push(bbox);
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
    [pageId, defaultFont, page.w, page.h, queueFor],
  );

  /** Thôi chờ mọi OCR đang chạy ở page này (không áp kết quả) và báo server huỷ job (best-effort). */
  const cancel = useCallback(() => {
    for (const w of waits.current.values()) {
      w.ctl.abort();
      if (w.jobId) void cancelJob(w.jobId).catch(() => undefined);
    }
  }, []);

  const erasing = Object.values(erasingBy).reduce((a, b) => a + b, 0);
  return { pending, error, retry, erasing, eraseError, start, cancel };
}

/** PageRect dùng `w/h`; Konva Rect cần `width/height` (spread thẳng PageRect → khung 0×0, không thấy gì). */
const konvaRect = (r: PageRect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });

/**
 * Khung đang kéo, khung chờ xác nhận (`proposal`, viền đậm + nền nhạt) và khung đang chờ OCR (viền đứt) — toạ độ
 * page đang sửa, đặt tại `offset` trên strip chương.
 */
export function OcrOverlay({
  draft,
  proposal = null,
  pending,
  offset = 0,
}: {
  draft: PageRect | null;
  proposal?: PageRect | null;
  pending: PageRect[];
  offset?: number;
}) {
  return (
    <Layer listening={false}>
      <Group y={offset}>
        {pending.map((r) => (
          <Rect
            key={`${r.x}:${r.y}:${r.w}`}
            {...konvaRect(r)}
            stroke={SELECT_STROKE}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            dash={[6, 4]}
          />
        ))}
        {proposal && (
          <Rect
            {...konvaRect(proposal)}
            stroke={SELECT_STROKE}
            strokeWidth={2}
            strokeScaleEnabled={false}
            fill={SELECT_FILL}
          />
        )}
        {draft && (
          <Rect
            {...konvaRect(draft)}
            stroke={SELECT_STROKE}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            fill={SELECT_FILL}
          />
        )}
      </Group>
    </Layer>
  );
}

/**
 * Thanh nổi cạnh khung OCR chờ xác nhận (trên khung; sát mép trên → dưới khung): "Nhận dạng vùng này" · "Huỷ".
 * Chỉ khi bấm (hoặc Enter) mới gửi OCR — kéo nhầm không tốn lượt AI. HTML phủ lên canvas, toạ độ khung nhìn.
 */
export function OcrConfirmBar(props: { rect: PageRect; view: View; frame: Size; onConfirm(): void; onCancel(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<Size>({ w: 230, h: 38 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.offsetWidth !== bar.w || el.offsetHeight !== bar.h))
      setBar({ w: el.offsetWidth, h: el.offsetHeight });
  });
  const pos = blockBarPos(props.rect, props.view, props.frame, bar);
  return (
    <div
      ref={ref}
      className="ed-ocrbar"
      role="toolbar"
      aria-label="Xác nhận quét chữ vùng"
      style={{ left: pos.left, top: pos.top }}
      // Không để pointerdown lọt xuống Stage (bắt đầu kéo khung mới).
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="btn-primary"
        onClick={props.onConfirm}
        title="Nhận dạng + dịch chữ trong khung (Enter)"
      >
        Nhận dạng vùng này
      </button>
      <button type="button" onClick={props.onCancel} title="Bỏ khung (Esc)">
        Huỷ
      </button>
    </div>
  );
}
