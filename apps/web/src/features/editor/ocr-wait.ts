import { QUOTA_EXCEEDED } from "@mtl/shared";
import { t, tp } from "../../i18n/t.ts";
import type { JobView } from "../chapter/api.ts";
import {
  clock,
  describeJobError,
  ERROR_CLASS,
  jobErrorLabel,
  needsTaskSetup,
  providerText,
  waitingOnProvider,
} from "../chapter/job-error.ts";

type RetryJob = Pick<JobView, "status" | "error" | "error_class" | "provider_retries" | "run_after">;

/**
 * Job OCR lỗi tạm thời được server xếp lại hàng đợi (backoff tới `run_after`, vài lần) → vẫn "chưa xong" nên UI chỉ
 * thấy "Đang OCR…". Trả câu báo lần lỗi vừa rồi (theo nhóm lỗi, không in lỗi thô) + giờ thử lại; null = chạy bình thường.
 */
export function ocrRetryNote(j: RetryJob, now = Date.now()): string | null {
  if (j.status !== "queued" || !j.error) return null;
  const cls = j.error_class ?? "internal";
  const why = waitingOnProvider(j) ? providerText(cls) : (ERROR_CLASS[cls] ?? ERROR_CLASS.internal ?? "");
  const retries = j.provider_retries > 0 ? t("editor.ocrWait.attempt", { count: j.provider_retries }) : "";
  // run_after đã qua = job đang chờ worker rảnh, không có giờ cụ thể để hứa.
  const when =
    new Date(j.run_after).getTime() > now
      ? t("editor.ocrWait.retryAt", { time: clock(j.run_after) })
      : t("editor.ocrWait.retrySoon");
  return t("editor.ocrWait.retryNote", { why, when, retries });
}

/** Job OCR nằm `queued` (chưa ai nhận, chưa lỗi) lâu hơn mức này → báo người dùng thay vì "Đang quét chữ…" im lặng. */
export const OCR_STALL_MS = 30_000;

/**
 * Job chưa được máy xử lý nào nhận sau `OCR_STALL_MS` (đo từ lúc gửi, theo đồng hồ trình duyệt — không so giờ server):
 * hàng đợi bận hoặc không có worker sống. Không có tín hiệu này, OCR trông như treo vô thời hạn. null = chưa tới mức.
 */
export function ocrStallNote(j: Pick<JobView, "status" | "error">, waitedMs: number): string | null {
  if (j.status !== "queued" || j.error || waitedMs < OCR_STALL_MS) return null;
  const s = Math.floor(waitedMs / 1000);
  return tp("editor.ocrWait.stall", s);
}

/**
 * Báo server dừng job OCR mà kết quả đã bị bỏ. Lỗi một lần (mạng, 5xx lúc tải cao) thì job kẹt `queued` rồi chạy tốn AI,
 * nên thử lại một lần sau `retryDelayMs`; vẫn lỗi thì thôi (best-effort, không ném).
 */
export async function cancelJobBestEffort(
  jobId: string,
  cancel: (jobId: string) => Promise<unknown>,
  retryDelayMs = 1500,
): Promise<void> {
  try {
    await cancel(jobId);
    return;
  } catch {
    // thử lại bên dưới
  }
  await new Promise((r) => setTimeout(r, retryDelayMs));
  await cancel(jobId).catch(() => undefined);
}

/**
 * Câu chính khi OCR vùng hỏng: thiếu model / hết hạn mức AI → câu bảo cần làm gì; còn lại → nguyên nhân theo
 * `error_class`. Lỗi thô của worker không làm câu chính.
 */
export function ocrFailureText(done: RetryJob & Partial<Pick<JobView, "type">>): string {
  const special = done.status === "failed" && (needsTaskSetup(done) || done.error?.startsWith(QUOTA_EXCEEDED));
  if (special) {
    const d = describeJobError(done);
    if (d) return d.text;
  }
  if (!done.error && !done.error_class) return t("editor.ocrSelect.failed");
  return t("editor.ocrSelect.failedCause", { label: jobErrorLabel(done) });
}
