/**
 * Gợi ý AI hiệu đính (thuần, test không DOM). Trạng thái suy ra từ bản dịch hiện tại của khối (page đang sửa đọc
 * editorStore, page khác đọc cache — cùng nguồn với bảng văn bản):
 * - `pending`: bản hiện tại = bản AI đã đọc lúc hiệu đính → Nhận / Bỏ được;
 * - `applied`: bản hiện tại = gợi ý (đã nhận; hoàn tác thì về `pending`);
 * - `stale`: khối đã bị sửa khác cả hai (hoặc không còn khối) sau khi tạo gợi ý → lỗi thời, chỉ Bỏ.
 */
import { type MessageKey, t, tp } from "../../i18n/t.ts";

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

const STATE_KEY: Record<SuggestionState, MessageKey> = {
  pending: "chapter.proofreadModel.state.pending",
  applied: "chapter.proofreadModel.state.applied",
  stale: "chapter.proofreadModel.state.stale",
};
export const stateLabel = (s: SuggestionState) => t(STATE_KEY[s]);

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
  if (r.high < 0.01) return t("chapter.proofreadModel.usdUnder");
  return `${usd(r.low)} – ${usd(r.high)}`;
}

/** "khoảng 2–7 phút"; ngắn → "dưới 1 phút". */
export function fmtDurationRange(r: { low: number; high: number }): string {
  const lo = Math.max(1, Math.round(r.low / 60));
  const hi = Math.max(1, Math.round(r.high / 60));
  if (r.high < 60) return t("chapter.proofreadModel.durationUnder");
  return lo === hi
    ? tp("chapter.proofreadModel.durationAbout", hi)
    : t("chapter.proofreadModel.durationRange", { low: lo, high: hi });
}

/** Luôn hiện trong hộp xác nhận (kể cả khi ước tính đang tải / lỗi): dữ liệu gửi lên nhà cung cấp AI. */
export const proofreadDataNotice = () => t("chapter.proofreadModel.dataNotice");

/** Một dòng gọn trong hộp xác nhận: "12 trang · $0.012 – $0.050 · khoảng 2–7 phút". Giá tính theo mức cao nhất thì nói rõ. */
export function estimateSummary(e: ProofreadEstimate): string {
  const range = fmtUsdRange(e.usd);
  const price = e.price_known ? range : t("chapter.proofreadModel.priceMax", { price: range });
  return tp("chapter.proofreadModel.summary", e.pages, { price, duration: fmtDurationRange(e.seconds) });
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
  const model = e.model ? `${e.provider ?? "?"} · ${e.model}` : t("chapter.proofreadModel.defaultModel");
  const price = fmtUsdRange(e.usd);
  return [
    tp("chapter.proofreadModel.pagesModel", e.pages, { model }),
    t(e.price_known ? "chapter.proofreadModel.cost" : "chapter.proofreadModel.costMax", { price }),
    t("chapter.proofreadModel.time", { duration: fmtDurationRange(e.seconds) }),
    t(e.basis === "history" ? "chapter.proofreadModel.basisHistory" : "chapter.proofreadModel.basisDefault"),
  ];
}
