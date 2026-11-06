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

/**
 * So bản dịch: NFC, gộp khoảng trắng trong dòng, giữ xuống dòng tay (`\n` = ngắt dòng cứng khi typeset) — khớp
 * `norm_text` (worker) và `sameText` (API). Sửa riêng xuống dòng sau khi tạo gợi ý = khối đã đổi → lỗi thời.
 */
export const normText = (t: string) =>
  t
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((ln) => ln.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
const norm = normText;

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

/** Ước tính trước khi chạy (GET /chapters/:id/proofread/estimate). */
export type ProofreadEstimate = {
  pages: number;
  provider: string | null;
  model: string | null;
  price_known: boolean;
  usd: { low: number; high: number };
  seconds: { low: number; high: number };
  basis: "history" | "default";
};

const usd = (v: number) => `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`;

/** "$0.012 – $0.050"; quá nhỏ → "dưới $0.01". */
export function fmtUsdRange(r: { low: number; high: number }): string {
  if (r.high < 0.01) return "dưới $0.01";
  return `${usd(r.low)} – ${usd(r.high)}`;
}

/** "khoảng 2–7 phút"; ngắn → "dưới 1 phút". */
export function fmtDurationRange(r: { low: number; high: number }): string {
  const lo = Math.max(1, Math.round(r.low / 60));
  const hi = Math.max(1, Math.round(r.high / 60));
  if (r.high < 60) return "dưới 1 phút";
  return lo === hi ? `khoảng ${hi} phút` : `khoảng ${lo}–${hi} phút`;
}

/** Luôn hiện trong hộp xác nhận (kể cả khi ước tính đang tải / lỗi): dữ liệu gửi lên nhà cung cấp AI. */
export const PROOFREAD_DATA_NOTICE =
  "Gửi lên nhà cung cấp AI: ảnh từng trang (thu nhỏ) + chữ gốc, bản dịch, glossary, quy tắc xưng hô.";

/** Một dòng gọn trong hộp xác nhận: "12 trang · $0.012 – $0.050 · khoảng 2–7 phút". Giá tính theo mức cao nhất thì nói rõ. */
export function estimateSummary(e: ProofreadEstimate): string {
  const price = `${fmtUsdRange(e.usd)}${e.price_known ? "" : " (giá cao nhất)"}`;
  return `${e.pages} trang · ${price} · ${fmtDurationRange(e.seconds)}`;
}

/** Số gợi ý còn chờ duyệt (bản dịch hiện tại của khối vẫn là bản AI đã đọc); `translationOf` = bản dịch hiện tại theo khoá khối. */
export function pendingCount(
  suggestions: Pick<Suggestion, "page_id" | "region_id" | "old" | "suggestion">[],
  translationOf: (key: string) => string | undefined,
): number {
  return suggestions.filter((s) => suggestionState(s, translationOf(`${s.page_id}:${s.region_id}`)) === "pending")
    .length;
}

/** Các dòng ước tính trước khi chạy hiệu đính (trang, model, giá, thời gian, cơ sở ước tính). */
export function estimateLines(e: ProofreadEstimate): string[] {
  const model = e.model ? `${e.provider ?? "?"} · ${e.model}` : "model mặc định của worker (chưa gán slot Hiệu đính)";
  return [
    `${e.pages} trang · ${model}`,
    `Chi phí ước tính: ${fmtUsdRange(e.usd)}${e.price_known ? "" : " (tính theo giá cao nhất vì chưa gán model)"}`,
    `Thời gian ước tính: ${fmtDurationRange(e.seconds)}, chưa tính thời gian chờ hàng đợi`,
    e.basis === "history"
      ? "Ước tính theo các lượt hiệu đính gần đây của bạn."
      : "Ước tính sơ bộ (chưa có lượt hiệu đính nào để so) — chi phí thật có thể khác.",
  ];
}
