/**
 * Ước tính chi phí + thời gian của một lượt AI hiệu đính cả chương — hiện cho người dùng xác nhận trước khi chạy.
 * Theo trang: trung bình token vào/ra và thời gian chạy của ≤20 lượt hiệu đính thành công gần nhất của chính user;
 * chưa có lịch sử → hằng số mặc định. Giá = giá model đang gán slot Hiệu đính (chưa gán → giá bảo thủ của bảng tĩnh).
 * Chỉ là ước tính hiển thị — tiền thật vẫn tính từ số token worker báo.
 */
import { aiModels, aiProviders, type DbLike, jobs, pages, systemSettings, usageLedger } from "@mtl/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { llmPrice } from "./prices.ts";

/** Mỗi trang: ảnh trang thu nhỏ (1–6 khúc) + bản dịch + glossary vào; gợi ý sửa ra. Khoảng rộng vì trang dày/mỏng. */
export const DEFAULT_PER_PAGE = {
  tokensIn: { low: 2500, high: 7000 },
  tokensOut: { low: 150, high: 1200 },
  seconds: { low: 5, high: 20 },
} as const;
/** Lịch sử chỉ là trung bình → nới khoảng hai phía. */
const HISTORY_SPREAD = { low: 0.8, high: 1.4 } as const;
const HISTORY_JOBS = 20;

type Range = { low: number; high: number };
export type PerPage = { tokensIn: Range; tokensOut: Range; seconds: Range };

export type ProofreadEstimate = {
  pages: number;
  provider: string | null;
  model: string | null;
  /** false = chưa gán slot Hiệu đính (model do worker tự chọn) → tính theo giá cao nhất bảng tĩnh. */
  price_known: boolean;
  usd: Range;
  seconds: Range;
  basis: "history" | "default";
};

/** Trung bình theo trang từ tổng của các lượt cũ; thiếu dữ liệu hợp lệ → null (dùng mặc định). */
export function perPageFromHistory(h: { pages: number; tokensIn: number; tokensOut: number; seconds: number }) {
  if (!(h.pages > 0) || !(h.tokensIn > 0)) return null;
  const at = (total: number): Range => ({
    low: (total / h.pages) * HISTORY_SPREAD.low,
    high: (total / h.pages) * HISTORY_SPREAD.high,
  });
  return {
    tokensIn: at(h.tokensIn),
    tokensOut: at(h.tokensOut),
    seconds: h.seconds > 0 ? at(h.seconds) : { ...DEFAULT_PER_PAGE.seconds },
  } satisfies PerPage;
}

/** Thuần: khoảng USD + giây cho `pages` trang với giá USD / 1M token. */
export function estimateRange(pageCount: number, price: { in: number; out: number }, per: PerPage) {
  const usd = (k: keyof Range) => (pageCount * (per.tokensIn[k] * price.in + per.tokensOut[k] * price.out)) / 1e6;
  return {
    usd: { low: usd("low"), high: usd("high") },
    seconds: { low: pageCount * per.seconds.low, high: pageCount * per.seconds.high },
  };
}

/** Số trang lượt hiệu đính sẽ gửi — khớp `enqueueProofread` (trang đã dịch, không bỏ qua). */
async function pageCount(t: DbLike, userId: string, chapterId: string) {
  const [row] = await t
    .select({ n: sql<number>`count(*)::int` })
    .from(pages)
    .where(
      and(
        eq(pages.userId, userId),
        eq(pages.chapterId, chapterId),
        eq(pages.skipped, false),
        eq(pages.status, "ready"),
      ),
    );
  return row?.n ?? 0;
}

async function proofreadModel(t: DbLike) {
  const [row] = await t
    .select({ provider: aiProviders.name, model: aiModels.modelId, in: aiModels.priceIn, out: aiModels.priceOut })
    .from(systemSettings)
    .innerJoin(aiModels, eq(aiModels.id, systemSettings.proofreadModelId))
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(eq(systemSettings.id, 1));
  return row ?? null;
}

async function history(t: DbLike, userId: string) {
  const recent = await t
    .select({
      id: jobs.id,
      pages: sql<number>`coalesce(jsonb_array_length(${jobs.payload} -> 'page_ids'), 0)::int`,
      seconds: sql<number>`greatest(extract(epoch from ${jobs.updatedAt} - ${jobs.claimedAt}), 0)::float8`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, "chapter.proofread"),
        eq(jobs.status, "succeeded"),
        isNotNull(jobs.claimedAt),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(HISTORY_JOBS);
  if (recent.length === 0) return null;
  const tokens = await t
    .select({ kind: usageLedger.kind, total: sql<number>`sum(${usageLedger.quantity})::float8` })
    .from(usageLedger)
    .where(
      and(
        inArray(
          usageLedger.jobId,
          recent.map((r) => r.id),
        ),
        inArray(usageLedger.kind, ["llm_tokens_in", "llm_tokens_out"]),
      ),
    )
    .groupBy(usageLedger.kind);
  const sum = (kind: string) => Number(tokens.find((r) => r.kind === kind)?.total ?? 0);
  return perPageFromHistory({
    pages: recent.reduce((a, r) => a + r.pages, 0),
    seconds: recent.reduce((a, r) => a + Number(r.seconds), 0),
    tokensIn: sum("llm_tokens_in"),
    tokensOut: sum("llm_tokens_out"),
  });
}

export async function estimateProofread(t: DbLike, userId: string, chapterId: string): Promise<ProofreadEstimate> {
  // Tuần tự: cùng một transaction/connection.
  const n = await pageCount(t, userId, chapterId);
  const model = await proofreadModel(t);
  const past = await history(t, userId);
  const price = model ? { in: model.in, out: model.out } : llmPrice(null).price;
  const per = past ?? DEFAULT_PER_PAGE;
  return {
    pages: n,
    provider: model?.provider ?? null,
    model: model?.model ?? null,
    price_known: !!model,
    ...estimateRange(n, price, per),
    basis: past ? "history" : "default",
  };
}
