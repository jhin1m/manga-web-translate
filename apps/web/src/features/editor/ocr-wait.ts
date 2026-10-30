import type { JobView } from "../chapter/api.ts";
import { clock } from "../chapter/job-error.ts";

/**
 * Job OCR lỗi tạm thời được server xếp lại hàng đợi (backoff tới `run_after`, vài lần) → vẫn "chưa xong" nên UI chỉ
 * thấy "Đang OCR…". Trả câu báo lỗi lần vừa rồi + giờ thử lại; null = đang chạy bình thường.
 */
export function ocrRetryNote(j: Pick<JobView, "status" | "error" | "run_after">): string | null {
  if (j.status !== "queued" || !j.error) return null;
  const err = j.error.length > 160 ? `${j.error.slice(0, 160)}…` : j.error;
  return `Lần OCR vừa rồi lỗi (${err}) — tự thử lại lúc ${clock(j.run_after)}. Có thể huỷ nếu không muốn chờ.`;
}
