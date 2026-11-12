/**
 * "Luôn cắt ở series này": kết quả học từng mép riêng (một mép lỗi không chặn mép kia), thông báo gộp và danh sách mép
 * đáng thử lại. Thuần, không đụng mạng.
 */
import { ApiError } from "../../lib/api.ts";

export type BandEdge = "top" | "bottom";

export type BandResult =
  | { edge: BandEdge; ok: true; learned: number; known: number }
  | { edge: BandEdge; ok: false; reason: string; retry: boolean };

const EDGE_LABEL: Record<BandEdge, string> = { top: "dải đầu", bottom: "dải cuối" };

const REASON: Record<string, string> = {
  plain_image: "ảnh gần trơn",
  no_trim: "mép này chưa cắt",
  skip_images_full: "danh sách tự cắt đã đầy",
  band_too_small: "dải quá mỏng",
  trim_changed: "số px cắt đã đổi, cắt lại rồi học lại",
  no_hash: "ảnh không có kích thước",
  not_uploaded: "ảnh chưa tải lên xong",
};

/** Lỗi tạm (mạng, giải mã, 5xx, ảnh chưa tải xong) thử lại được; 4xx còn lại là kết luận của server, thử lại vẫn vậy. */
export function failedBand(edge: BandEdge, e: unknown): BandResult {
  if (!(e instanceof ApiError)) return { edge, ok: false, reason: "không đọc được ảnh, kiểm tra mạng", retry: true };
  const code = typeof e.body.error === "string" ? e.body.error : "";
  const retry = e.status >= 500 || code === "not_uploaded";
  return { edge, ok: false, reason: REASON[code] ?? (retry ? "máy chủ lỗi" : "server từ chối"), retry };
}

export function retryEdges(results: BandResult[]): BandEdge[] {
  return results.flatMap((r) => (!r.ok && r.retry ? [r.edge] : []));
}

const join = (xs: string[]) => xs.join(" và ");
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Nội dung toast sau khi học: tất cả thành công giữ câu cũ; có mép lỗi thì nói rõ từng mép. */
export function bandSummary(results: BandResult[]): { text: string; tone: "info" | "danger" } {
  const failed = results.flatMap((r) => (r.ok ? [] : [r]));
  const oks = results.flatMap((r) => (r.ok ? [r] : []));
  if (!failed.length) {
    const learned = oks.reduce((n, r) => n + r.learned, 0);
    const known = oks.reduce((n, r) => n + r.known, 0);
    return {
      tone: "info",
      text: learned
        ? `Đã học ${learned} dải — chương sau của series tự cắt dải giống.`
        : `Đã có sẵn ${known} dải này trong danh sách tự cắt của series.`,
    };
  }
  const parts: string[] = [];
  const fresh = oks.filter((r) => r.learned > 0).map((r) => EDGE_LABEL[r.edge]);
  const had = oks.filter((r) => r.learned === 0).map((r) => EDGE_LABEL[r.edge]);
  if (fresh.length) parts.push(`Đã học ${join(fresh)}`);
  if (had.length) parts.push(`${join(had)} đã có sẵn`);
  for (const r of failed) parts.push(`${EDGE_LABEL[r.edge]}: ${r.reason}`);
  return { tone: "danger", text: `${upper(parts.join("; "))}.` };
}
