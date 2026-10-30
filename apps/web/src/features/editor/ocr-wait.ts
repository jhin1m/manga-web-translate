import type { JobView } from "../chapter/api.ts";
import { clock, ERROR_CLASS, providerText, waitingOnProvider } from "../chapter/job-error.ts";

type RetryJob = Pick<JobView, "status" | "error" | "error_class" | "provider_retries" | "run_after">;

/**
 * Job OCR lỗi tạm thời được server xếp lại hàng đợi (backoff tới `run_after`, vài lần) → vẫn "chưa xong" nên UI chỉ
 * thấy "Đang OCR…". Trả câu báo lần lỗi vừa rồi (theo nhóm lỗi, không in lỗi thô) + giờ thử lại; null = chạy bình thường.
 */
export function ocrRetryNote(j: RetryJob, now = Date.now()): string | null {
  if (j.status !== "queued" || !j.error) return null;
  const cls = j.error_class ?? "internal";
  const why = waitingOnProvider(j) ? providerText(cls) : (ERROR_CLASS[cls] ?? ERROR_CLASS.internal);
  const retries = j.provider_retries > 0 ? ` (lần ${j.provider_retries})` : "";
  // run_after đã qua = job đang chờ worker rảnh, không có giờ cụ thể để hứa.
  const when = new Date(j.run_after).getTime() > now ? `lúc ${clock(j.run_after)}` : "sắp tới";
  return `Lần OCR vừa rồi lỗi (${why}) — tự thử lại ${when}${retries}. Có thể huỷ nếu không muốn chờ.`;
}
