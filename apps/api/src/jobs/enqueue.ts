/**
 * Tạo job (idempotent) và tiến trạng thái chương giữa 2 giai đoạn. Mọi hàm nhận `tx` của caller để
 * enqueue cùng transaction với thay đổi dữ liệu (VD ingest complete tạo pages + page.prepare một lần).
 * Route (Phase 4–6) gọi qua `inJobTx(tx => enqueueX(tx, userId, …))` — route không giữ kết nối DB thô.
 */

import {
  chapters,
  type DbLike,
  glossaryEntries,
  jobs,
  NotFoundError,
  pageStates,
  pages,
  series,
  sourceFiles,
  userSettings,
} from "@mtl/db";
import {
  ACTIVE_JOB_STATUSES,
  emptyPageState,
  HONORIFIC_EXAMPLES,
  inpaintOptions,
  type JobPayload,
  type JobType,
  LANG_NAMES,
  LOCAL_OCR_ENGINES,
  ocrEngineFor,
  type PageFormat,
  type PipelineSettings,
  prepareOptions,
  readingOrder,
  resolvePipelineSettings,
  type SourceLang,
  type TargetLang,
  type TranslateCarry,
  type TranslateSettings,
  userPrefix,
} from "@mtl/shared";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db.ts";
import { mergeBySourceTerm, seriesGlossaryWhere } from "../lib/glossary-scope.ts";
import { exportKey, ingestKey, type JobKey, pageOpKey, prepareKey, proofreadKey, translateKey } from "./idempotency.ts";

type Job = typeof jobs.$inferSelect;
type Page = typeof pages.$inferSelect;
type Chapter = typeof chapters.$inferSelect;
type Series = typeof series.$inferSelect;

export const DEFAULT_DIALOGUE_FONT = "Bangers-Regular";
/** Câu chỉ dẫn kính ngữ theo cặp nguồn → đích (policy lạ → gửi nguyên văn). */
export function honorificText(policy: string, src: string, tgt: string): string {
  const ex = HONORIFIC_EXAMPLES[src as SourceLang] ?? HONORIFIC_EXAMPLES.ko;
  const target = LANG_NAMES[tgt as TargetLang]?.replace(/^Tiếng/, "tiếng") ?? tgt;
  if (policy === "keep") return `giữ nguyên kính ngữ (${ex}) ở dạng phiên âm Latin`;
  if (policy === "translate") return `chuyển kính ngữ (${ex}) sang cách xưng hô/gọi nhau tự nhiên của ${target}`;
  return policy;
}

export const inJobTx = <R>(fn: (tx: DbLike) => Promise<R>): Promise<R> =>
  db.transaction((tx) => fn(tx as unknown as DbLike));

export const conflict = (code: string, message = code) =>
  new HTTPException(409, { res: Response.json({ error: code, message }, { status: 409 }) });

const activeStatus = sql`${jobs.status} in (${sql.join(
  ACTIVE_JOB_STATUSES.map((s) => sql`${s}`),
  sql`, `,
)})`;

/**
 * Job chỉ đọc chương (AI hiệu đính): không tính là chương "đang bận" khi ingest lại / áp ngược chữ bỏ qua — gợi ý của
 * nó tự lỗi thời / bị lọc nếu trang đổi.
 */
export const notReadOnlyJob = ne(jobs.type, "chapter.proofread");

/** Insert theo idempotency_key; job active cùng key đã có → trả job đó (`created: false`). */
export async function insertJob(
  tx: DbLike,
  v: {
    userId: string;
    payload: JobPayload;
    key: JobKey;
    chapterId?: string | null;
    pageId?: string | null;
    priority?: number;
  },
): Promise<{ job: Job; created: boolean }> {
  const [row] = await tx
    .insert(jobs)
    .values({
      userId: v.userId,
      type: v.payload.type,
      payload: v.payload,
      inputRev: v.key.inputRev,
      idempotencyKey: v.key.idempotencyKey,
      chapterId: v.chapterId ?? null,
      pageId: v.pageId ?? null,
      priority: v.priority ?? 100,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey, where: activeStatus })
    .returning();
  if (row) return { job: row, created: true };
  const [existing] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.idempotencyKey, v.key.idempotencyKey), activeStatus));
  if (!existing) throw new Error("idempotent insert lost both insert and existing row");
  return { job: existing, created: false };
}

export async function lockChapter(tx: DbLike, userId: string, chapterId: string): Promise<Chapter> {
  const [ch] = await tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.id, chapterId)))
    .for("update");
  if (!ch) throw new NotFoundError("chapter");
  return ch;
}

export async function seriesOf(tx: DbLike, ch: Chapter): Promise<Series> {
  const [s] = await tx.select().from(series).where(eq(series.id, ch.seriesId));
  if (!s) throw new NotFoundError("series");
  return s;
}

/** Chương có page người đã sửa → không cho ingest lại (mất chỉnh sửa); tạo chương mới thay thế (red team #4). */
export async function chapterHasUserEdits(tx: DbLike, chapterId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: pageStates.pageId })
    .from(pageStates)
    .innerJoin(pages, eq(pages.id, pageStates.pageId))
    .where(and(eq(pages.chapterId, chapterId), eq(pageStates.stateOrigin, "user")))
    .limit(1);
  return !!row;
}

export async function activeJobOf(tx: DbLike, chapterId: string, type: JobType): Promise<Job | undefined> {
  const [j] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.chapterId, chapterId), eq(jobs.type, type), activeStatus))
    .limit(1);
  return j;
}

/** Lượt chạy của chương: dừng sau Bước 1 (`prepared`) hay dịch luôn theo chuỗi lô (`translated`). */
export type RunTarget = "prepared" | "translated";

/**
 * Commit không nói đích: manga (ingest từng trang, không có cắt strip để duyệt) dịch luôn; strip dừng ở `prepared`
 * chờ người dùng duyệt cắt trang rồi bấm "Dịch".
 */
export const defaultRunTarget = (mode: PageFormat): RunTarget => (mode === "pages" ? "translated" : "prepared");

/**
 * Commit chương → ingest_rev + 1, chapter `ingesting`, enqueue chapter.ingest. Mở lượt chạy `target` (trang tạo ra
 * lúc ingest xong vào chuỗi dịch khi `translated`).
 */
export async function enqueueIngest(
  tx: DbLike,
  userId: string,
  chapterId: string,
  /** Bỏ trống → page_format của series (override chỉ dành cho test/tool). */
  mode?: PageFormat,
  /** Bỏ trống → `defaultRunTarget(mode)`. */
  target?: RunTarget,
): Promise<{ job: Job; created: boolean }> {
  const ch = await lockChapter(tx, userId, chapterId);
  const active = await activeJobOf(tx, ch.id, "chapter.ingest");
  if (active) return { job: active, created: false };
  // Ingest complete xoá page cũ (cascade job của chúng) → không ingest lại khi page còn job đang chạy.
  const [busy] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.chapterId, ch.id), activeStatus, notReadOnlyJob))
    .limit(1);
  if (busy) throw conflict("chapter_busy", "chương còn job đang chạy — huỷ hoặc chờ xong rồi ingest lại");
  if (await chapterHasUserEdits(tx, ch.id)) {
    throw conflict("chapter_has_user_edits", "chương đã có chỉnh sửa tay — tạo chương mới để ingest lại");
  }
  // Khoá idempotency theo đúng bộ ảnh sẽ ghép (bỏ ảnh bỏ qua) → bỏ/dùng lại ảnh rồi cắt lại là lượt ingest mới.
  const sources = await tx
    .select({ id: sourceFiles.id })
    .from(sourceFiles)
    .where(and(eq(sourceFiles.chapterId, ch.id), isNull(sourceFiles.skip)))
    .orderBy(asc(sourceFiles.ord));
  if (sources.length === 0) throw new HTTPException(400, { message: "chapter has no source files" });
  const ingestMode = mode ?? (await seriesOf(tx, ch)).pageFormat;
  const ingestRev = ch.ingestRev + 1;
  await tx
    .update(chapters)
    .set({
      ingestRev,
      ingestMode,
      status: "ingesting",
      runTarget: target ?? defaultRunTarget(ingestMode),
      runStartedAt: sql`now()`,
      runTotal: 0,
    })
    .where(eq(chapters.id, ch.id));
  return insertJob(tx, {
    userId: userId,
    payload: { type: "chapter.ingest", chapter_id: ch.id, ingest_rev: ingestRev, mode: ingestMode },
    key: ingestKey(
      ch.id,
      ingestRev,
      ingestMode,
      sources.map((s) => s.id),
    ),
    chapterId: ch.id,
  });
}

/** Cài đặt pipeline của người dùng (thiếu hàng / key → mặc định = hành vi cũ). */
export async function pipelineSettingsOf(tx: DbLike, userId: string): Promise<PipelineSettings> {
  const [row] = await tx
    .select({ pipeline: userSettings.pipeline })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return resolvePipelineSettings(row?.pipeline);
}

/** page.prepare của series này có gọi LLM không (OCR engine theo cài đặt + ngôn ngữ nguồn) — để kiểm hạn mức. */
export async function prepareUsesLlm(tx: DbLike, userId: string, seriesId: string): Promise<boolean> {
  const [s] = await tx
    .select({ sourceLang: series.sourceLang })
    .from(series)
    .where(and(eq(series.userId, userId), eq(series.id, seriesId)));
  if (!s) return true;
  return !LOCAL_OCR_ENGINES.includes(ocrEngineFor(await pipelineSettingsOf(tx, userId), s.sourceLang));
}

/**
 * Giai đoạn 1 cho 1 page; page → `pending`. Thứ tự đọc theo mode chương đã thực sự ingest (không theo
 * page_format hiện tại của series — đổi định dạng chỉ áp cho lần commit sau). Cài đặt pipeline của người dùng được
 * snapshot vào payload (`pipeline`); vòng lặp nhiều page truyền sẵn để khỏi đọc lại.
 */
export async function enqueuePrepare(tx: DbLike, page: Page, s: Series, ch: Chapter, pipeline?: PipelineSettings) {
  const options = prepareOptions(pipeline ?? (await pipelineSettingsOf(tx, page.userId)), s.sourceLang);
  await tx.update(pages).set({ status: "pending" }).where(eq(pages.id, page.id));
  return insertJob(tx, {
    userId: page.userId,
    payload: {
      type: "page.prepare",
      page_id: page.id,
      source_lang: s.sourceLang,
      reading_order: readingOrder(s.sourceLang, ch.ingestMode),
      pipeline: options,
    },
    key: prepareKey(page.id, page.originalSha256, s.settingsRev, options),
    chapterId: page.chapterId,
    pageId: page.id,
  });
}

/** Snapshot cài đặt dịch: glossary (entry series đè entry chung đúng cặp), quy tắc xưng hô, font. */
export async function translateSettings(tx: DbLike, s: Series): Promise<TranslateSettings> {
  const entries = await tx.select().from(glossaryEntries).where(seriesGlossaryWhere(s));
  const glossary: Record<string, string> = {};
  for (const [term, e] of mergeBySourceTerm(entries)) glossary[term] = e.targetTerm;
  const font = s.defaultFonts.dialogue ?? DEFAULT_DIALOGUE_FONT;
  return {
    glossary,
    source_lang: s.sourceLang,
    target_lang: s.targetLang,
    pronoun_rules: s.pronounRules.length ? JSON.stringify(s.pronounRules) : "",
    honorific_policy: honorificText(s.honorificPolicy, s.sourceLang, s.targetLang),
    style_prompt: s.stylePrompt,
    font,
    // Chưa chọn font dẫn truyện → giống font thoại (series cũ không đổi hành vi).
    narration_font: s.defaultFonts.narration ?? font,
  };
}

/**
 * Giai đoạn 2 cho các page đã prepare (theo ord). `context`: rolling = không có trang hiện nào trước lô;
 * neighbors = dùng ngữ cảnh trang n−1/n+1 (inputs dựng lúc claim). `carry`: ngữ cảnh lô trước cùng lượt.
 */
export async function enqueueTranslate(
  tx: DbLike,
  userId: string,
  chapterId: string,
  pageIds: string[],
  context: "rolling" | "neighbors",
  opts: { priority?: number; carry?: TranslateCarry } = {},
) {
  const ch = await lockChapter(tx, userId, chapterId);
  const s = await seriesOf(tx, ch);
  const rows = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.chapterId, ch.id), inArray(pages.id, pageIds)))
    .orderBy(asc(pages.ord));
  if (rows.length !== new Set(pageIds).size) throw new NotFoundError("page");
  if (rows.some((p) => p.skipped)) throw conflict("page_skipped", "trang đã xoá — khôi phục trước khi dịch");
  const unprepared = rows.filter((p) => !p.ocrResult || !p.prepareInputRev);
  if (unprepared.length) throw conflict("page_not_prepared", `${unprepared.length} page chưa qua giai đoạn 1`);
  await tx.update(chapters).set({ status: "processing" }).where(eq(chapters.id, ch.id));
  return insertJob(tx, {
    userId: userId,
    payload: {
      type: "chapter.translate",
      chapter_id: ch.id,
      page_ids: rows.map((p) => p.id),
      context,
      glossary_rev: s.glossaryRev,
      settings_rev: s.settingsRev,
      settings: await translateSettings(tx, s),
      ...(opts.carry ? { carry: opts.carry } : {}),
    },
    key: translateKey(
      ch.id,
      rows.map((p) => ({ pageId: p.id, prepareInputRev: p.prepareInputRev as string })),
      s.glossaryRev,
      s.settingsRev,
      context,
    ),
    chapterId: ch.id,
    priority: opts.priority,
  });
}

/** Re-inpaint theo mask người vẽ (Phase 5) — chỉ đổi pages.clean_rev khi complete. */
export async function enqueueReinpaint(
  tx: DbLike,
  userId: string,
  input: Omit<Extract<JobPayload, { type: "page.reinpaint" }>, "inpaint">,
) {
  const page = await pageIn(tx, userId, input.page_id);
  const payload = { ...input, inpaint: inpaintOptions(await pipelineSettingsOf(tx, userId)) };
  if (
    !payload.user_mask_key.startsWith(`${userPrefix(userId)}pg/${page.id}/user-mask/`) ||
    payload.user_mask_key.includes("..")
  ) {
    throw new HTTPException(400, { message: "user_mask_key không thuộc page này" });
  }
  return insertJob(tx, {
    userId: userId,
    payload,
    key: pageOpKey(payload),
    chapterId: page.chapterId,
    pageId: page.id,
  });
}

/** OCR + dịch 1 vùng (Phase 5) — kết quả nằm ở jobs.result, editor tự chèn. Ngôn ngữ lấy từ series của page. */
export async function enqueueOcrRegion(
  tx: DbLike,
  userId: string,
  input: Omit<
    Extract<JobPayload, { type: "page.ocr_region" }>,
    "source_lang" | "target_lang" | "ocr_engine" | "reading_order"
  >,
) {
  const page = await pageIn(tx, userId, input.page_id);
  const [ch] = await tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.id, page.chapterId)));
  if (!ch) throw new NotFoundError("chapter");
  const s = await seriesOf(tx, ch);
  const payload = {
    ...input,
    source_lang: s.sourceLang,
    target_lang: s.targetLang,
    ocr_engine: ocrEngineFor(await pipelineSettingsOf(tx, userId), s.sourceLang),
    reading_order: readingOrder(s.sourceLang, ch.ingestMode),
  };
  return insertJob(tx, {
    userId: userId,
    payload,
    key: pageOpKey(payload),
    chapterId: page.chapterId,
    pageId: page.id,
  });
}

/**
 * Xuất chương (render phía server từ page_state hiện tại). Chương chưa có page → 409 `no_pages`; đang ingest/xử lý
 * → 409 `chapter_busy` (page đang dịch lại bị coi là chưa dịch → file thiếu trang mà không báo).
 */
export async function enqueueExport(
  tx: DbLike,
  userId: string,
  payload: Extract<JobPayload, { type: "chapter.export" }>,
) {
  const [ch] = await tx
    .select({ id: chapters.id, status: chapters.status })
    .from(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.id, payload.chapter_id)));
  if (!ch) throw new NotFoundError("chapter");
  if (ch.status === "ingesting" || ch.status === "processing") {
    throw conflict("chapter_busy", "chương đang xử lý — chờ xong rồi xuất");
  }
  const rows = await tx
    .select({ id: pages.id, cleanRev: pages.cleanRev, status: pages.status, version: pageStates.version })
    .from(pages)
    .leftJoin(pageStates, eq(pageStates.pageId, pages.id))
    // Trang ẩn không xuất → ẩn/khôi phục đổi khoá (file xuất khác).
    .where(and(eq(pages.chapterId, ch.id), eq(pages.skipped, false)));
  if (rows.length === 0) throw conflict("no_pages", "chương chưa có trang để xuất");
  return insertJob(tx, {
    userId: userId,
    payload,
    key: exportKey(
      payload,
      rows.map((r) => ({ ...r, version: r.version ?? 0 })),
    ),
    chapterId: ch.id,
  });
}

/** Chương đã qua Bước 2 (có trang dịch xong) — mới có bản dịch để hiệu đính. */
const PROOFREAD_STATUSES = new Set(["review", "done", "partial_failed"]);

/**
 * AI hiệu đính cả chương: các trang hiện (không ẩn) đã dịch xong (`ready`). Snapshot cài đặt dịch (glossary, xưng hô,
 * giọng văn) + model theo cài đặt pipeline của người dùng. Không đổi trạng thái chương/trang (job chỉ đọc).
 */
export async function enqueueProofread(tx: DbLike, userId: string, chapterId: string) {
  const ch = await lockChapter(tx, userId, chapterId);
  if (!PROOFREAD_STATUSES.has(ch.status)) {
    throw conflict("chapter_not_translated", "chương chưa dịch xong hoặc đang chạy — dịch xong rồi hiệu đính");
  }
  const s = await seriesOf(tx, ch);
  const rows = await tx
    .select({ id: pages.id, version: pageStates.version })
    .from(pages)
    .innerJoin(pageStates, eq(pageStates.pageId, pages.id))
    .where(and(eq(pages.chapterId, ch.id), eq(pages.skipped, false), eq(pages.status, "ready")))
    .orderBy(asc(pages.ord));
  if (rows.length === 0) throw conflict("no_translated_pages", "chương chưa có trang đã dịch");
  const tier = (await pipelineSettingsOf(tx, userId)).proofread_tier;
  return insertJob(tx, {
    userId: userId,
    payload: {
      type: "chapter.proofread",
      chapter_id: ch.id,
      page_ids: rows.map((r) => r.id),
      model_tier: tier,
      settings: await translateSettings(tx, s),
    },
    key: proofreadKey(ch.id, rows, s.glossaryRev, s.settingsRev, tier),
    chapterId: ch.id,
  });
}

async function pageIn(tx: DbLike, userId: string, pageId: string): Promise<Page> {
  const [p] = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.userId, userId), eq(pages.id, pageId)));
  if (!p) throw new NotFoundError("page");
  return p;
}

/**
 * Bước 1 (tiếp): tạo pages + page_states rỗng + page.prepare cho kết quả ingest (cùng transaction với complete).
 * Lượt `translated` → mọi trang vào chuỗi dịch (lô đầu chạy ngay khi có trang prepared); lượt `prepared` → chương
 * dừng ở `prepared`, bước 2 chỉ chạy khi người dùng bấm.
 */
export async function createIngestedPages(
  tx: DbLike,
  ch: Chapter,
  rows: Array<Omit<typeof pages.$inferInsert, "userId" | "chapterId" | "status">>,
) {
  const s = await seriesOf(tx, ch);
  // Không có chỉnh sửa tay (đã kiểm) → bỏ page của lần ingest trước (cascade page_states/history/job).
  await tx.delete(pages).where(eq(pages.chapterId, ch.id));
  const inserted = await tx
    .insert(pages)
    .values(
      rows.map((r) => ({
        ...r,
        userId: ch.userId,
        chapterId: ch.id,
        status: "pending" as const,
        translateQueued: ch.runTarget === "translated",
      })),
    )
    .returning();
  await tx
    .insert(pageStates)
    .values(inserted.map((p) => ({ pageId: p.id, userId: ch.userId, state: emptyPageState(p.width, p.height) })));
  const pipeline = await pipelineSettingsOf(tx, ch.userId);
  for (const p of inserted) await enqueuePrepare(tx, p, s, ch, pipeline);
  await tx.update(chapters).set({ status: "processing", runTotal: inserted.length }).where(eq(chapters.id, ch.id));
  return inserted;
}

const BUSY = new Set(["pending", "preparing", "translating"]);

/**
 * Tính lại trạng thái chương sau mỗi sự kiện job (khoá dòng chapter → các complete song song tuần tự hoá, không bỏ
 * lỡ "page cuối cùng xong"). Lượt dịch còn trang chờ (`translate_queued`) → vẫn bận; hết việc mà còn page `prepared`
 * → chương `prepared` (chờ "Dịch"). Lượt `prepared` hết bận → đóng lượt.
 */
export async function refreshChapter(tx: DbLike, userId: string, chapterId: string): Promise<void> {
  const ch = await lockChapter(tx, userId, chapterId);
  if (ch.status === "ingesting" || ch.status === "draft") return;
  // Trang ẩn không tính: chương "xong" khi mọi trang còn hiện đã xong.
  const rows = await tx
    .select({ id: pages.id, status: pages.status, queued: pages.translateQueued })
    .from(pages)
    .where(and(eq(pages.chapterId, ch.id), eq(pages.skipped, false)));
  const busy =
    rows.some((p) => BUSY.has(p.status)) ||
    (ch.runTarget === "translated" && rows.some((p) => p.queued)) ||
    !!(await activeJobOf(tx, ch.id, "chapter.translate"));
  const status = busy
    ? "processing"
    : rows.length && rows.every((p) => p.status === "ready")
      ? ch.status === "done"
        ? "done"
        : "review"
      : rows.some((p) => p.status === "prepared")
        ? "prepared"
        : "partial_failed";
  if (status !== ch.status) await tx.update(chapters).set({ status }).where(eq(chapters.id, ch.id));
  if (!busy && ch.runTarget === "prepared")
    await tx.update(chapters).set({ runTarget: null }).where(eq(chapters.id, ch.id));
}
