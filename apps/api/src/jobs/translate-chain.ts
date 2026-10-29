/**
 * Lượt dịch theo chuỗi job `chapter.translate` theo lô (≤ 4 trang có chữ & ≤ 40 khối — như `make_batches` của worker),
 * chạy tuần tự theo thứ tự trang: trang lô đầu xong (`ready`, sửa được) trong khi lô sau còn chờ.
 *
 * - Lượt = `chapters.run_target = 'translated'` + các trang `pages.translate_queued` (chưa xong).
 * - `advanceTranslateChain` (dưới khoá dòng chapter, idempotent) enqueue lô kế: gọi khi page.prepare xong/lỗi và khi
 *   lô trước xong/lỗi hẳn, nên hàng đợi không rỗng giữa hai lô.
 * - Frontier = trang chờ đầu tiên (theo ord, bỏ trang ẩn). Trang lỗi Bước 1 bị bỏ khỏi lượt; frontier còn ở Bước 1 → chờ.
 * - Lô đầu chạy ngay khi có ≥ 1 trang; lô sau chưa đầy mà còn trang phía sau đang ở Bước 1 → chờ cho đầy (không vụn lô).
 * - Ngữ cảnh: `neighbors` (trang ngay trước, dựng lúc claim) + `carry` (notes, tên nhân vật) của lô thành công gần nhất.
 *
 * Thứ tự khoá cố định chapter → pages ở mọi nhánh (queue.ts khoá chương trước khi ghi page) để không deadlock.
 * File này import enqueue.ts, enqueue.ts không import ngược.
 */
import { chapters, type DbLike, jobs, NotFoundError, pages } from "@mtl/db";
import { type OcrResult, prepareOptions, type TranslateCarry } from "@mtl/shared";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { userQuotaStatus } from "../billing/user-quota.ts";
import {
  activeJobOf,
  conflict,
  enqueuePrepare,
  enqueueTranslate,
  lockChapter,
  pipelineSettingsOf,
  type RunTarget,
  refreshChapter,
  seriesOf,
} from "./enqueue.ts";
import { prepareKey } from "./idempotency.ts";

export type { RunTarget };

type Job = typeof jobs.$inferSelect;
type Chapter = typeof chapters.$inferSelect;

/** Lô dịch xếp trước page.prepare (100): trang đã prepare được dịch ngay, không chờ hết Bước 1 của cả chương. */
export const CHAIN_PRIORITY = 50;
export const MAX_BATCH_PAGES = 4;
export const MAX_BATCH_REGIONS = 40;

export type ChainPage = { id: string; regions: number };

/** Số khối worker sẽ gửi dịch (bỏ vùng rỗng, SFX, chữ trắng) — cùng luật lọc của `handle_translate`. */
export function regionCount(ocr: OcrResult | null): number {
  return ocr ? ocr.items.filter((it) => !it.empty && !it.is_sfx && it.source.trim()).length : 0;
}

/**
 * Cắt danh sách trang (đã theo thứ tự) thành lô: đóng lô khi đủ `maxPages` trang có chữ hoặc thêm trang sẽ vượt
 * `maxRegions` khối; trang đơn lẻ vượt trần vẫn đi riêng. Trang 0 khối đi kèm lô đang mở, không tính vào trần.
 */
export function planBatches(
  list: ChainPage[],
  maxPages = MAX_BATCH_PAGES,
  maxRegions = MAX_BATCH_REGIONS,
): ChainPage[][] {
  const out: ChainPage[][] = [];
  let cur: ChainPage[] = [];
  let counted = 0;
  let regions = 0;
  for (const p of list) {
    if (p.regions > 0 && counted > 0 && (counted >= maxPages || regions + p.regions > maxRegions)) {
      out.push(cur);
      cur = [];
      counted = 0;
      regions = 0;
    }
    cur.push(p);
    if (p.regions > 0) {
      counted++;
      regions += p.regions;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const isFull = (batch: ChainPage[]) => {
  const texted = batch.filter((p) => p.regions > 0);
  return texted.length >= MAX_BATCH_PAGES || texted.reduce((n, p) => n + p.regions, 0) >= MAX_BATCH_REGIONS;
};

type ChainRow = {
  id: string;
  status: string;
  ocrResult: OcrResult | null;
  prepareInputRev: string | null;
};

const hasOcr = (p: ChainRow) => !!p.ocrResult && !!p.prepareInputRev;
const inStep1 = (p: ChainRow) => p.status === "pending" || p.status === "preparing";
/** Đủ điều kiện vào lô: đã có OCR và không đang chạy lại Bước 1. */
const isPrepared = (p: ChainRow) => hasOcr(p) && !inStep1(p);
const step1Failed = (p: ChainRow) => p.status === "failed" && !hasOcr(p);

/** Trang hiện (không ẩn) đang chờ trong lượt, theo thứ tự đọc — chỉ đọc OCR của chúng (advance chạy dưới khoá chương). */
function queuedPages(tx: DbLike, chapterId: string): Promise<ChainRow[]> {
  return tx
    .select({
      id: pages.id,
      status: pages.status,
      ocrResult: pages.ocrResult,
      prepareInputRev: pages.prepareInputRev,
    })
    .from(pages)
    .where(and(eq(pages.chapterId, chapterId), eq(pages.skipped, false), eq(pages.translateQueued, true)))
    .orderBy(asc(pages.ord));
}

/**
 * Ngữ cảnh của lô: `rolling` (không lấy chữ trang ngoài lô) chỉ khi lô mở đầu chương và mọi trang hiện xen giữa /
 * ngay sau lô đều còn chờ trong lượt (các lô kế sẽ dịch tiếp, ngữ cảnh đi qua `carry`). Ngược lại `neighbors`: claim
 * dựng nguồn + bản dịch trang ngay trước và nguồn trang ngay sau các đoạn trang của lô — như dịch lại trang lẻ trước
 * khi có chuỗi lô (trang đầu chương dịch lại riêng vẫn có chữ trang sau).
 */
async function batchContext(
  tx: DbLike,
  chapterId: string,
  batch: ChainPage[],
  queued: Set<string>,
): Promise<"rolling" | "neighbors"> {
  const visible = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.chapterId, chapterId), eq(pages.skipped, false)))
    .orderBy(asc(pages.ord));
  const inBatch = new Set(batch.map((p) => p.id));
  const first = visible.findIndex((p) => inBatch.has(p.id));
  if (first !== 0) return "neighbors";
  const last = visible.findLastIndex((p) => inBatch.has(p.id));
  const outside = visible.slice(first, last + 2).filter((p) => !inBatch.has(p.id));
  return outside.every((p) => queued.has(p.id)) ? "rolling" : "neighbors";
}

/** Job dịch tạo trong lượt hiện tại (so trong SQL: Date của JS mất micro giây của timestamptz). */
const inCurrentRun = (chapterId: string) =>
  and(
    eq(jobs.chapterId, chapterId),
    eq(jobs.type, "chapter.translate"),
    gte(jobs.createdAt, sql`(select ${chapters.runStartedAt} from ${chapters} where ${chapters.id} = ${chapterId})`),
  );

/** Số lô đã tạo trong lượt hiện tại. */
export async function runBatchesStarted(tx: DbLike, chapterId: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobs).where(inCurrentRun(chapterId));
  return row?.n ?? 0;
}

/** `carry` của lô dịch thành công gần nhất trong lượt (lô lỗi không có ngữ cảnh mới). */
async function lastCarry(tx: DbLike, chapterId: string): Promise<TranslateCarry | undefined> {
  const [row] = await tx
    .select({ result: jobs.result })
    .from(jobs)
    .where(and(inCurrentRun(chapterId), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return (row?.result as { carry?: TranslateCarry } | null)?.carry;
}

async function openRun(tx: DbLike, chapterId: string, pageIds: string[]) {
  await tx
    .update(chapters)
    .set({ runTarget: "translated", runStartedAt: sql`now()`, runTotal: pageIds.length })
    .where(eq(chapters.id, chapterId));
  await tx.update(pages).set({ translateQueued: true }).where(inArray(pages.id, pageIds));
}

/** Đóng lượt: bỏ cờ mọi trang (cả trang ẩn) rồi tính lại trạng thái chương. Chương đã khoá bởi caller. */
async function closeRun(tx: DbLike, userId: string, chapterId: string) {
  await tx.update(chapters).set({ runTarget: null }).where(eq(chapters.id, chapterId));
  await tx
    .update(pages)
    .set({ translateQueued: false })
    .where(and(eq(pages.chapterId, chapterId), eq(pages.translateQueued, true)));
  await refreshChapter(tx, userId, chapterId);
}

function assertNoRun(ch: Chapter) {
  if (ch.runTarget === "translated") throw conflict("translate_running", "chương đang dịch — chờ xong hoặc huỷ");
}

/**
 * Enqueue lô kế của lượt nếu tới lúc (xem đầu file). Idempotent: đã có job dịch active → không làm gì. Hết trang chờ
 * → đóng lượt; hết hạn mức → dừng lượt (trang còn lại giữ `prepared`).
 */
export async function advanceTranslateChain(tx: DbLike, userId: string, chapterId: string): Promise<Job | null> {
  const ch = await lockChapter(tx, userId, chapterId);
  if (ch.runTarget !== "translated") return null;
  if (await activeJobOf(tx, ch.id, "chapter.translate")) return null;
  if ((await userQuotaStatus(tx, userId)).exceeded) {
    await closeRun(tx, userId, ch.id);
    return null;
  }
  const rows = await queuedPages(tx, ch.id);
  const dropped = new Set(rows.filter(step1Failed).map((p) => p.id));
  if (dropped.size)
    await tx
      .update(pages)
      .set({ translateQueued: false })
      .where(inArray(pages.id, [...dropped]));
  const live = rows.filter((p) => !dropped.has(p.id));
  if (live.length === 0) {
    await closeRun(tx, userId, ch.id);
    return null;
  }
  const ready: ChainPage[] = [];
  for (const p of live) {
    if (!isPrepared(p)) break;
    ready.push({ id: p.id, regions: regionCount(p.ocrResult) });
  }
  const plan = planBatches(ready);
  const batch = plan[0];
  if (!batch) return null; // frontier còn ở Bước 1
  const waiting = ready.length < live.length;
  if (waiting && plan.length === 1 && !isFull(batch) && (await runBatchesStarted(tx, ch.id)) > 0) return null;
  const context = await batchContext(tx, ch.id, batch, new Set(live.map((p) => p.id)));
  const { job } = await enqueueTranslate(
    tx,
    userId,
    ch.id,
    batch.map((p) => p.id),
    context,
    { priority: CHAIN_PRIORITY, carry: await lastCarry(tx, ch.id) },
  );
  return job;
}

/** Dừng lượt (huỷ, job bị huỷ): không enqueue thêm lô; trang chưa dịch giữ trạng thái hiện tại. */
export async function stopTranslateChain(tx: DbLike, userId: string, chapterId: string): Promise<void> {
  const ch = await lockChapter(tx, userId, chapterId);
  await closeRun(tx, userId, ch.id);
}

/**
 * Mở lượt dịch cho `pageIds` (bỏ trống = mọi trang hiện) rồi chạy lô đầu. Trang phải thuộc chương, không ẩn, đã
 * qua Bước 1. Lượt khác đang chạy → 409 `translate_running`.
 */
export async function startTranslateRun(
  tx: DbLike,
  userId: string,
  chapterId: string,
  pageIds?: string[],
): Promise<{ job: Job | null; created: boolean }> {
  const ch = await lockChapter(tx, userId, chapterId);
  assertNoRun(ch);
  // Đang ingest: trang sắp bị thay toàn bộ — không mở lượt dịch lên bộ trang mới mà người dùng chưa chọn.
  if (ch.status === "ingesting") throw conflict("chapter_busy", "chương đang tách trang — chờ xong rồi dịch");
  const rows = await tx
    .select()
    .from(pages)
    .where(
      pageIds
        ? and(eq(pages.chapterId, ch.id), inArray(pages.id, pageIds))
        : and(eq(pages.chapterId, ch.id), eq(pages.skipped, false)),
    );
  if (rows.length === 0 || (pageIds && rows.length !== new Set(pageIds).size)) throw new NotFoundError("page");
  if (rows.some((p) => p.skipped)) throw conflict("page_skipped", "trang đã xoá — khôi phục trước khi dịch");
  const unprepared = rows.filter((p) => !p.ocrResult || !p.prepareInputRev);
  if (unprepared.length) throw conflict("page_not_prepared", `${unprepared.length} page chưa qua giai đoạn 1`);
  await openRun(
    tx,
    ch.id,
    rows.map((p) => p.id),
  );
  const job = await advanceTranslateChain(tx, userId, ch.id);
  return { job, created: job !== null };
}

/** Bước 2 "Dịch": chương `prepared` → lượt dịch mọi trang đã qua Bước 1 mà chưa dịch. */
export async function translatePrepared(tx: DbLike, userId: string, chapterId: string) {
  const ch = await lockChapter(tx, userId, chapterId);
  if (ch.status !== "prepared") throw conflict("chapter_not_prepared", "chương chưa xong bước 1 hoặc đang dịch");
  const rows = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.chapterId, ch.id), eq(pages.skipped, false), eq(pages.status, "prepared")));
  if (rows.length === 0) throw conflict("page_not_prepared", "không có trang nào chờ dịch");
  return startTranslateRun(
    tx,
    userId,
    ch.id,
    rows.map((p) => p.id),
  );
}

/** Dịch lại cả chương hoặc tập trang đã chọn — cùng một lượt chuỗi lô. */
export function retranslate(tx: DbLike, userId: string, chapterId: string, pageIds?: string[]) {
  return startTranslateRun(tx, userId, chapterId, pageIds?.length ? pageIds : undefined);
}

/**
 * "Chạy lại trang lỗi" cấp chương: page lỗi giai đoạn 1 (chưa có OCR hợp lệ) → page.prepare; page lỗi giai đoạn 2 →
 * lượt dịch cho riêng chúng. Trang lỗi giai đoạn 1 cũng vào lượt (tự dịch khi prepare xong) chỉ khi chương đã có
 * trang dịch xong; chưa có thì dừng ở `prepared` như chương mới.
 */
export async function retryFailedPages(tx: DbLike, userId: string, chapterId: string): Promise<Job[]> {
  const ch = await lockChapter(tx, userId, chapterId);
  assertNoRun(ch);
  const s = await seriesOf(tx, ch);
  const visible = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.chapterId, ch.id), eq(pages.skipped, false)))
    .orderBy(asc(pages.ord));
  const failed = visible.filter((p) => p.status === "failed");
  const pipeline = await pipelineSettingsOf(tx, userId);
  const options = prepareOptions(pipeline, s.sourceLang);
  const stage1 = failed.filter(
    (p) => !p.ocrResult || p.prepareInputRev !== prepareKey(p.id, p.originalSha256, s.settingsRev, options).inputRev,
  );
  const stage2 = failed.filter((p) => !stage1.includes(p));
  const created: Job[] = [];
  for (const p of stage1) created.push((await enqueuePrepare(tx, p, s, ch, pipeline)).job);
  const hasReady = visible.some((p) => p.status === "ready");
  const queued = [...stage2, ...(hasReady ? stage1 : [])].map((p) => p.id);
  if (queued.length) {
    await openRun(tx, ch.id, queued);
    const job = await advanceTranslateChain(tx, userId, ch.id);
    if (job) created.push(job);
  }
  if (created.length) await tx.update(chapters).set({ status: "processing" }).where(eq(chapters.id, ch.id));
  return created;
}
