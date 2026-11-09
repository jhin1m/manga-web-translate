/**
 * Lỗi job viết cho người: lỗi thô (VD nguyên JSON 429 của Gemini) chỉ để xem chi tiết. Lỗi provider/rate_limited
 * không làm job hỏng ngay — queue requeue có backoff (apps/api/src/jobs/errors.ts) → trang "đang chờ AI", tự thử lại.
 */
import { LLM_NOT_CONFIGURED, QUOTA_EXCEEDED } from "@mtl/shared";
import type { JobView } from "./api.ts";

export const ERROR_CLASS: Record<string, string> = {
  provider: "nhà cung cấp AI lỗi",
  rate_limited: "bị giới hạn tốc độ",
  schema: "AI trả sai định dạng",
  invalid_input: "ảnh lỗi hoặc vượt giới hạn",
  auth: "AI từ chối khoá API",
  internal: "lỗi hệ thống",
};

const RETRY_HINT = 'Chuột phải trang → "Dịch lại trang", hoặc bấm "Chạy lại trang lỗi" để thử lại.';
/** Khoá API sai thì bấm chạy lại cũng hỏng tiếp — nói rõ phải sửa cấu hình trước. */
const AUTH_HINT =
  'Khoá API AI sai, hết hạn mức hoặc chưa cấu hình — admin sửa ở Cài đặt › AI › Nhà cung cấp (hoặc key env của worker) rồi bấm "Chạy lại trang lỗi".';
const PROVIDER_CLASSES = new Set(["provider", "rate_limited"]);
const WAITING = new Set(["queued", "running"]);

type ErrorJob = Pick<JobView, "status" | "error_class" | "error" | "provider_retries" | "run_after"> &
  Partial<Pick<JobView, "type">>;

const SETUP_HINT = "Chọn model ở Cài đặt › Model tác vụ rồi chạy lại.";
const TASK_OF_JOB: Record<string, string> = {
  "page.prepare": "OCR",
  "page.ocr_region": "OCR",
  "chapter.translate": "Dịch",
  "chapter.proofread": "Hiệu đính",
};
type CauseJob = Pick<JobView, "error_class" | "error"> & Partial<Pick<JobView, "type">>;

export const needsTaskSetup = (j: CauseJob | null | undefined) => !!j?.error?.startsWith(LLM_NOT_CONFIGURED);

/** Nguyên nhân lỗi ngắn: thiếu model tách khỏi "AI từ chối khoá API" dù cùng `error_class`. */
export function jobErrorLabel(j: CauseJob): string {
  if (needsTaskSetup(j)) {
    const task = TASK_OF_JOB[j.type ?? ""];
    return `Chưa chọn model AI cho tác vụ${task ? ` ${task}` : ""}`;
  }
  const cls = j.error_class ?? "internal";
  return ERROR_CLASS[cls] ?? cls;
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/** Job đã gặp lỗi AI tạm thời và đang chờ tự thử lại (chưa hỏng). */
export const waitingOnProvider = (j: ErrorJob | null | undefined): boolean =>
  !!j && WAITING.has(j.status) && !!j.error_class && PROVIDER_CLASSES.has(j.error_class);

export const providerText = (cls: string) =>
  cls === "rate_limited" ? "Nhà cung cấp AI báo hết hạn mức / quá nhiều yêu cầu (429)" : "Nhà cung cấp AI lỗi tạm thời";

/** Đầu ngày UTC kế tiếp — lúc hạn mức chi phí ngày đặt lại (server tính theo ngày UTC). */
export const nextQuotaReset = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

/** null = job không có lỗi cần nói. `waiting` = đang tự thử lại, không cần làm gì. */
export function describeJobError(j: ErrorJob | null | undefined): { text: string; waiting: boolean } | null {
  if (!j?.error_class && !j?.error) return null;
  const cls = j.error_class ?? "internal";
  if (waitingOnProvider(j)) {
    const at = j.status === "queued" ? ` lúc ${clock(j.run_after)}` : "";
    return { text: `${providerText(cls)} — tự thử lại${at} (lần ${j.provider_retries}).`, waiting: true };
  }
  if (j.status === "cancelled") return { text: `Đã huỷ xử lý. ${RETRY_HINT}`, waiting: false };
  if (j.status === "failed" && j.error?.startsWith(QUOTA_EXCEEDED)) {
    return { text: `Đã dùng hết hạn mức AI hôm nay — thử lại sau ${clock(nextQuotaReset())}.`, waiting: false };
  }
  if (j.status !== "failed") return null;
  if (needsTaskSetup(j)) return { text: `Lỗi: ${jobErrorLabel(j)}. ${SETUP_HINT}`, waiting: false };
  if (cls === "auth") return { text: `Lỗi: ${AUTH_HINT}`, waiting: false };
  const label = PROVIDER_CLASSES.has(cls) ? `${providerText(cls)}, đã thử lại nhiều lần` : (ERROR_CLASS[cls] ?? cls);
  return { text: `Lỗi: ${label}. ${RETRY_HINT}`, waiting: false };
}

/** Băng cảnh báo chương: các trang đang chờ AI thử lại + giờ thử lại sớm nhất. */
export function providerWait(pages: { ord: number; job: ErrorJob | null }[]) {
  const waiting = pages.filter((p) => waitingOnProvider(p.job));
  if (!waiting.length) return null;
  const queued = waiting.flatMap((p) => (p.job?.status === "queued" ? [p.job.run_after] : []));
  const next = queued.length ? queued.reduce((a, b) => (a < b ? a : b)) : null;
  const rateLimited = waiting.some((p) => p.job?.error_class === "rate_limited");
  return { pages: waiting.map((p) => p.ord + 1), next, rateLimited };
}

export function providerWaitText(w: NonNullable<ReturnType<typeof providerWait>>) {
  const why = w.rateLimited ? providerText("rate_limited") : providerText("provider");
  const at = w.next ? ` lúc ${clock(w.next)}` : "";
  return `${why} — trang ${w.pages.join(", ")} đang chờ, tự thử lại${at}. Không cần làm gì; muốn dừng thì bấm "Huỷ xử lý".`;
}

/** Bản ngắn của `providerWaitText` cho băng cảnh báo: lý do + trang nào tự thử lại. */
export function providerWaitShort(w: NonNullable<ReturnType<typeof providerWait>>) {
  const why = w.rateLimited ? "AI hết hạn mức" : "AI lỗi tạm thời";
  return `${why}, trang ${w.pages.join(", ")} tự thử lại`;
}

/** Số trang (1-based) → dải gọn: [2, 3, 4, 6, 9] → "2–4, 6, 9". */
export function pageRanges(ords: number[]): string {
  const sorted = [...new Set(ords)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] as number) + 1) j++;
    out.push(j > i + 1 ? `${sorted[i]}–${sorted[j]}` : sorted.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}

type FailedPage = { ord: number; job: CauseJob | null };

/** Lỗi thô của các trang trong 1 nhóm, gom theo nội dung: [{ pages: "2–4", error }]. */
function rawErrors(pages: FailedPage[]) {
  const by = new Map<string, number[]>();
  for (const p of pages) {
    const e = p.job?.error;
    if (e) by.set(e, [...(by.get(e) ?? []), p.ord + 1]);
  }
  return [...by].map(([error, ords]) => ({ pages: pageRanges(ords), error }));
}

/**
 * Trang lỗi gom theo nguyên nhân (nhiều trang nhất trước) → 1 dòng mỗi nguyên nhân thay vì liệt kê từng trang.
 * `hint` = việc cần làm khi chạy lại thôi chưa đủ; `raw` = lỗi thô đầu tiên; `details` = mọi lỗi thô của nhóm (theo
 * nội dung, kèm số trang) để đọc ở "Chi tiết kỹ thuật"; `needsSetup` = thiếu model, kèm lối tới Model tác vụ.
 */
export function failedPageGroups(failed: FailedPage[]) {
  const by = new Map<string, FailedPage[]>();
  for (const f of failed) {
    const k = needsTaskSetup(f.job) ? LLM_NOT_CONFIGURED : (f.job?.error_class ?? "internal");
    by.set(k, [...(by.get(k) ?? []), f]);
  }
  return [...by]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cls, ps]) => ({
      cls,
      count: ps.length,
      label: ps[0]?.job ? jobErrorLabel(ps[0].job) : (ERROR_CLASS[cls] ?? cls),
      pages: pageRanges(ps.map((p) => p.ord + 1)),
      hint: cls === "auth" ? AUTH_HINT : null,
      needsSetup: cls === LLM_NOT_CONFIGURED,
      raw: ps.find((p) => p.job?.error)?.job?.error ?? null,
      details: rawErrors(ps),
    }));
}
