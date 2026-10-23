/**
 * Gợi ý AI hiệu đính (thuần, test không DOM). Trạng thái suy ra từ bản dịch hiện tại của khối (page đang sửa đọc
 * editorStore, page khác đọc cache — cùng nguồn với bảng văn bản):
 * - `pending`: bản hiện tại = bản AI đã đọc lúc hiệu đính → Nhận / Bỏ được;
 * - `applied`: bản hiện tại = gợi ý (đã nhận; hoàn tác thì về `pending`);
 * - `stale`: khối đã bị sửa khác cả hai (hoặc không còn khối) sau khi tạo gợi ý → lỗi thời, chỉ Bỏ.
 */
export type Suggestion = {
  id: string;
  page_id: string;
  region_id: string;
  old: string;
  suggestion: string;
  reason: string;
  created_at: string;
};
export type SuggestionState = "pending" | "applied" | "stale";

const norm = (t: string) => t.normalize("NFC").replace(/\s+/g, " ").trim();

export function suggestionState(
  s: Pick<Suggestion, "old" | "suggestion">,
  current: string | undefined,
): SuggestionState {
  if (current === undefined) return "stale";
  if (norm(current) === norm(s.suggestion)) return "applied";
  if (norm(current) === norm(s.old)) return "pending";
  return "stale";
}

export const STATE_LABEL: Record<SuggestionState, string> = {
  pending: "Chờ duyệt",
  applied: "Đã nhận",
  stale: "Lỗi thời",
};

/** Theo thứ tự trang rồi thứ tự khối trong trang (theo bảng văn bản); khối không còn → cuối trang. */
export function sortSuggestions<T extends Pick<Suggestion, "page_id" | "region_id">>(
  list: T[],
  pageOrd: ReadonlyMap<string, number>,
  rowIndex: ReadonlyMap<string, number>,
): T[] {
  const key = (s: T) => [pageOrd.get(s.page_id) ?? 1e9, rowIndex.get(`${s.page_id}:${s.region_id}`) ?? 1e9] as const;
  return [...list].sort((a, b) => {
    const [pa, ra] = key(a);
    const [pb, rb] = key(b);
    return pa - pb || ra - rb;
  });
}
