/**
 * OCR vùng tự xoá chữ gốc: khối dịch của một khung mới chèn xong → khung vào hàng xoá của page. Các lần xoá chạy tuần tự
 * (POST /reinpaint {auto_text_bbox, base_clean_rev} → chờ job → báo `onErased` để tải lại ảnh sạch) vì mỗi lần dựng
 * trên clean_rev mới nhất — gửi song song thì lần sau dính 409 `clean_rev_changed`. Rev lấy max(rev job trước trả,
 * rev page đang biết) (clean_rev chỉ tiến); vẫn 409 (người khác vừa xoá) → dùng rev server báo, thử lại 1 lần.
 * Thuần (phụ thuộc truyền vào) để test; nhớ lựa chọn bật/tắt theo trình duyệt.
 */
import { ApiError } from "../../lib/api.ts";

export type BBoxTuple = [number, number, number, number];

type Job = { id: string; status: string; error?: string | null; result?: unknown };

export type EraseDeps = {
  start(pageId: string, body: { auto_text_bbox: BBoxTuple; base_clean_rev: number }): Promise<{ job: Job }>;
  wait(jobId: string, signal: AbortSignal): Promise<Job>;
  /** clean_rev page đang biết (dữ liệu chương tải lại sau mỗi lần xoá có thể chậm hơn kết quả job). */
  cleanRev(): number | null;
  onErased(): void;
  onState(s: { pending: number; error: string | null }): void;
  errorText(e: unknown): string;
};

export type EraseQueue = { push(bbox: BBoxTuple): void; dispose(): void };

/** 409 `clean_rev_changed` → rev hiện tại server báo; lỗi khác → null. */
function staleRev(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.status !== 409 || e.body.error !== "clean_rev_changed") return null;
  return typeof e.body.clean_rev === "number" ? e.body.clean_rev : null;
}

function resultRev(job: Job): number | null {
  const r = job.result as { clean_rev?: unknown } | null | undefined;
  return typeof r?.clean_rev === "number" ? r.clean_rev : null;
}

export function createEraseQueue(pageId: string, deps: EraseDeps): EraseQueue {
  const ctl = new AbortController();
  let known: number | null = null;
  let pending = 0;
  let error: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  const emit = () => {
    if (!ctl.signal.aborted) deps.onState({ pending, error });
  };

  const latestRev = () => {
    const page = deps.cleanRev();
    if (known === null) return page;
    return page === null ? known : Math.max(known, page);
  };

  async function run(bbox: BBoxTuple) {
    if (ctl.signal.aborted) return;
    const base = latestRev();
    if (base === null) throw new Error("Trang chưa có ảnh đã xoá chữ.");
    let job: Job;
    try {
      job = (await deps.start(pageId, { auto_text_bbox: bbox, base_clean_rev: base })).job;
    } catch (e) {
      const fresh = staleRev(e);
      if (fresh === null || ctl.signal.aborted) throw e;
      known = fresh;
      job = (await deps.start(pageId, { auto_text_bbox: bbox, base_clean_rev: fresh })).job;
    }
    const done = await deps.wait(job.id, ctl.signal);
    if (done.status !== "succeeded") throw new Error(done.error ?? "Xoá chữ gốc thất bại");
    known = resultRev(done) ?? known;
    if (!ctl.signal.aborted) deps.onErased();
  }

  return {
    push(bbox) {
      pending += 1;
      error = null;
      emit();
      chain = chain
        .then(() => run(bbox))
        .catch((e: unknown) => {
          if (!ctl.signal.aborted) error = deps.errorText(e);
        })
        .finally(() => {
          pending -= 1;
          emit();
        });
    },
    /** Thôi gửi/chờ (rời chương). Job đã gửi không bị huỷ: nó dựng trên rev đúng và tự ghi ảnh sạch ở server. */
    dispose() {
      ctl.abort();
    },
  };
}

const PREF_KEY = "mtl.ocr.autoErase";

/** Mặc định bật; không đọc được localStorage (chế độ riêng tư) → bật. */
export function readAutoErase(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeAutoErase(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    // Không lưu được → chỉ mất ghi nhớ lựa chọn.
  }
}
