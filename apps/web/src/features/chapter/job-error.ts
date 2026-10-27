/**
 * Lỗi job viết cho người: lỗi thô (VD nguyên JSON 429 của Gemini) chỉ để xem chi tiết. Lỗi provider/rate_limited
 * không làm job hỏng ngay — queue requeue có backoff (apps/api/src/jobs/errors.ts) → trang "đang chờ AI", tự thử lại.
 */
import { QUOTA_EXCEEDED } from "@mtl/shared";
import type { JobView } from "./api.ts";

export const ERROR_CLASS: Record<string, string> = {
  provider: "nhà cung cấp AI lỗi",
  rate_limited: "bị giới hạn tốc độ",
  schema: "AI trả sai định dạng",
  invalid_input: "ảnh lỗi hoặc vượt giới hạn",
  internal: "lỗi hệ thống",
};

const RETRY_HINT = 'Bấm "Dịch lại trang này" hoặc "Chạy lại trang lỗi" để thử lại.';
const PROVIDER_CLASSES = new Set(["provider", "rate_limited"]);
const WAITING = new Set(["queued", "running"]);

type ErrorJob = Pick<JobView, "status" | "error_class" | "error" | "provider_retries" | "run_after">;

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/** Job đã gặp lỗi AI tạm thời và đang chờ tự thử lại (chưa hỏng). */
export const waitingOnProvider = (j: ErrorJob | null | undefined): boolean =>
  !!j && WAITING.has(j.status) && !!j.error_class && PROVIDER_CLASSES.has(j.error_class);

const providerText = (cls: string) =>
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
