/**
 * Tạo job (idempotent) và tiến trạng thái chương giữa 2 giai đoạn. Mọi hàm nhận `tx` của caller để
 * enqueue cùng transaction với thay đổi dữ liệu (VD ingest complete tạo pages + page.prepare một lần).
 * Route (Phase 4–6) gọi qua `inJobTx(tx => enqueueX(tx, ws, …))` — route không giữ kết nối DB thô.
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
} from "@mtl/db";
import {
  ACTIVE_JOB_STATUSES,
  emptyPageState,
  HONORIFIC_EXAMPLES,
  type JobPayload,
  type JobType,
  LANG_NAMES,
  type PageFormat,
  readingOrder,
  type SourceLang,
  type TargetLang,
  type TranslateSettings,
} from "@mtl/shared";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db.ts";
import { exportKey, ingestKey, type JobKey, pageOpKey, prepareKey, translateKey } from "./idempotency.ts";

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

const conflict = (code: string, message = code) =>
  new HTTPException(409, { res: Response.json({ error: code, message }, { status: 409 }) });

const activeStatus = sql`${jobs.status} in (${sql.join(
  ACTIVE_JOB_STATUSES.map((s) => sql`${s}`),
  sql`, `,
)})`;

/** Insert theo idempotency_key; job active cùng key đã có → trả job đó (`created: false`). */
export async function insertJob(
  tx: DbLike,
  v: {
    workspaceId: string;
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
      workspaceId: v.workspaceId,
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

async function lockChapter(tx: DbLike, ws: string, chapterId: string): Promise<Chapter> {
  const [ch] = await tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.workspaceId, ws), eq(chapters.id, chapterId)))
    .for("update");
  if (!ch) throw new NotFoundError("chapter");
  return ch;
}

async function seriesOf(tx: DbLike, ch: Chapter): Promise<Series> {
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

async function activeJobOf(tx: DbLike, chapterId: string, type: JobType): Promise<Job | undefined> {
  const [j] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.chapterId, chapterId), eq(jobs.type, type), activeStatus))
    .limit(1);
  return j;
}

/** Commit chương (Phase 4) → ingest_rev + 1, chapter `ingesting`, enqueue chapter.ingest. */
export async function enqueueIngest(
  tx: DbLike,
  ws: string,
  chapterId: string,
  /** Bỏ trống → page_format của series (override chỉ dành cho test/tool). */
  mode?: PageFormat,
): Promise<{ job: Job; created: boolean }> {
  const ch = await lockChapter(tx, ws, chapterId);
  const active = await activeJobOf(tx, ch.id, "chapter.ingest");
  if (active) return { job: active, created: false };
  // Ingest complete xoá page cũ (cascade job của chúng) → không ingest lại khi page còn job đang chạy.
  const [busy] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.chapterId, ch.id), activeStatus))
    .limit(1);
  if (busy) throw conflict("chapter_busy", "chương còn job đang chạy — huỷ hoặc chờ xong rồi ingest lại");
  if (await chapterHasUserEdits(tx, ch.id)) {
    throw conflict("chapter_has_user_edits", "chương đã có chỉnh sửa tay — tạo chương mới để ingest lại");
  }
  const sources = await tx
    .select({ id: sourceFiles.id })
    .from(sourceFiles)
    .where(eq(sourceFiles.chapterId, ch.id))
    .orderBy(asc(sourceFiles.ord));
  if (sources.length === 0) throw new HTTPException(400, { message: "chapter has no source files" });
  const ingestMode = mode ?? (await seriesOf(tx, ch)).pageFormat;
  const ingestRev = ch.ingestRev + 1;
  await tx.update(chapters).set({ ingestRev, ingestMode, status: "ingesting" }).where(eq(chapters.id, ch.id));
  return insertJob(tx, {
    workspaceId: ws,
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

/**
 * Giai đoạn 1 cho 1 page; page → `pending`. Thứ tự đọc theo mode chương đã thực sự ingest (không theo
 * page_format hiện tại của series — đổi định dạng chỉ áp cho lần commit sau).
 */
export async function enqueuePrepare(tx: DbLike, page: Page, s: Series, ch: Chapter) {
  await tx.update(pages).set({ status: "pending" }).where(eq(pages.id, page.id));
  return insertJob(tx, {
    workspaceId: page.workspaceId,
    payload: {
      type: "page.prepare",
      page_id: page.id,
      source_lang: s.sourceLang,
      reading_order: readingOrder(s.sourceLang, ch.ingestMode),
    },
    key: prepareKey(page.id, page.originalSha256, s.settingsRev),
    chapterId: page.chapterId,
    pageId: page.id,
  });
}

/** Snapshot cài đặt dịch: glossary (entry series đè entry workspace), quy tắc xưng hô, font. */
export async function translateSettings(tx: DbLike, s: Series): Promise<TranslateSettings> {
  const entries = await tx
    .select()
    .from(glossaryEntries)
    .where(
      and(
        eq(glossaryEntries.workspaceId, s.workspaceId),
        or(isNull(glossaryEntries.seriesId), eq(glossaryEntries.seriesId, s.id)),
      ),
    );
  const glossary: Record<string, string> = {};
  // Workspace trước, series sau → entry series thắng khi trùng source_term.
  for (const e of [...entries].sort((a, b) => Number(a.seriesId !== null) - Number(b.seriesId !== null))) {
    glossary[e.sourceTerm] = e.targetTerm;
  }
  return {
    glossary,
    source_lang: s.sourceLang,
    target_lang: s.targetLang,
    pronoun_rules: s.pronounRules.length ? JSON.stringify(s.pronounRules) : "",
    honorific_policy: honorificText(s.honorificPolicy, s.sourceLang, s.targetLang),
    style_prompt: s.stylePrompt,
    font: s.defaultFonts.dialogue ?? DEFAULT_DIALOGUE_FONT,
  };
}

/**
 * Giai đoạn 2 cho các page đã prepare (theo ord). `context`: rolling = cả chương; neighbors = tập con,
 * dùng ngữ cảnh trang n−1/n+1 (inputs dựng lúc claim).
 */
export async function enqueueTranslate(
  tx: DbLike,
  ws: string,
  chapterId: string,
  pageIds: string[],
  context: "rolling" | "neighbors",
) {
  const ch = await lockChapter(tx, ws, chapterId);
  const s = await seriesOf(tx, ch);
  const rows = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.chapterId, ch.id), inArray(pages.id, pageIds)))
    .orderBy(asc(pages.ord));
  if (rows.length !== new Set(pageIds).size) throw new NotFoundError("page");
  const unprepared = rows.filter((p) => !p.ocrResult || !p.prepareInputRev);
  if (unprepared.length) throw conflict("page_not_prepared", `${unprepared.length} page chưa qua giai đoạn 1`);
  await tx.update(chapters).set({ status: "processing" }).where(eq(chapters.id, ch.id));
  return insertJob(tx, {
    workspaceId: ws,
    payload: {
      type: "chapter.translate",
      chapter_id: ch.id,
      page_ids: rows.map((p) => p.id),
      context,
      glossary_rev: s.glossaryRev,
      settings_rev: s.settingsRev,
      settings: await translateSettings(tx, s),
    },
    key: translateKey(
      ch.id,
      rows.map((p) => ({ pageId: p.id, prepareInputRev: p.prepareInputRev as string })),
      s.glossaryRev,
      s.settingsRev,
      context,
    ),
    chapterId: ch.id,
  });
}

/** Chạy lại dịch: cả chương (rolling) hoặc tập page (neighbors). */
export async function retranslate(tx: DbLike, ws: string, chapterId: string, pageIds?: string[]) {
  if (pageIds?.length) return enqueueTranslate(tx, ws, chapterId, pageIds, "neighbors");
  const all = await tx.select({ id: pages.id }).from(pages).where(eq(pages.chapterId, chapterId));
  if (all.length === 0) throw new NotFoundError("page");
  return enqueueTranslate(
    tx,
    ws,
    chapterId,
    all.map((p) => p.id),
    "rolling",
  );
}

/**
 * "Chạy lại trang lỗi" cấp chương: page lỗi giai đoạn 1 (chưa có OCR hợp lệ) → page.prepare (xong → chờ "Dịch");
 * page lỗi giai đoạn 2 → chapter.translate cho riêng chúng.
 */
export async function retryFailedPages(tx: DbLike, ws: string, chapterId: string) {
  const ch = await lockChapter(tx, ws, chapterId);
  const s = await seriesOf(tx, ch);
  const failed = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.chapterId, ch.id), eq(pages.status, "failed")))
    .orderBy(asc(pages.ord));
  const stage1 = failed.filter(
    (p) => !p.ocrResult || p.prepareInputRev !== prepareKey(p.id, p.originalSha256, s.settingsRev).inputRev,
  );
  const stage2 = failed.filter((p) => !stage1.includes(p));
  const created: Job[] = [];
  for (const p of stage1) created.push((await enqueuePrepare(tx, p, s, ch)).job);
  if (stage2.length) {
    created.push(
      (
        await enqueueTranslate(
          tx,
          ws,
          ch.id,
          stage2.map((p) => p.id),
          "neighbors",
        )
      ).job,
    );
  }
  if (created.length) await tx.update(chapters).set({ status: "processing" }).where(eq(chapters.id, ch.id));
  return created;
}

/** Re-inpaint theo mask người vẽ (Phase 5) — chỉ đổi pages.clean_rev khi complete. */
export async function enqueueReinpaint(
  tx: DbLike,
  ws: string,
  payload: Extract<JobPayload, { type: "page.reinpaint" }>,
) {
  const page = await pageIn(tx, ws, payload.page_id);
  if (!payload.user_mask_key.startsWith(`ws/${ws}/pg/${page.id}/user-mask/`) || payload.user_mask_key.includes("..")) {
    throw new HTTPException(400, { message: "user_mask_key không thuộc page này" });
  }
  return insertJob(tx, {
    workspaceId: ws,
    payload,
    key: pageOpKey(payload),
    chapterId: page.chapterId,
    pageId: page.id,
  });
}

/** OCR + dịch 1 vùng (Phase 5) — kết quả nằm ở jobs.result, editor tự chèn. Ngôn ngữ lấy từ series của page. */
export async function enqueueOcrRegion(
  tx: DbLike,
  ws: string,
  input: Omit<Extract<JobPayload, { type: "page.ocr_region" }>, "source_lang" | "target_lang">,
) {
  const page = await pageIn(tx, ws, input.page_id);
  const [ch] = await tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.workspaceId, ws), eq(chapters.id, page.chapterId)));
  if (!ch) throw new NotFoundError("chapter");
  const s = await seriesOf(tx, ch);
  const payload = { ...input, source_lang: s.sourceLang, target_lang: s.targetLang };
  return insertJob(tx, {
    workspaceId: ws,
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
export async function enqueueExport(tx: DbLike, ws: string, payload: Extract<JobPayload, { type: "chapter.export" }>) {
  const [ch] = await tx
    .select({ id: chapters.id, status: chapters.status })
    .from(chapters)
    .where(and(eq(chapters.workspaceId, ws), eq(chapters.id, payload.chapter_id)));
  if (!ch) throw new NotFoundError("chapter");
  if (ch.status === "ingesting" || ch.status === "processing") {
    throw conflict("chapter_busy", "chương đang xử lý — chờ xong rồi xuất");
  }
  const rows = await tx
    .select({ id: pages.id, cleanRev: pages.cleanRev, status: pages.status, version: pageStates.version })
    .from(pages)
    .leftJoin(pageStates, eq(pageStates.pageId, pages.id))
    .where(eq(pages.chapterId, ch.id));
  if (rows.length === 0) throw conflict("no_pages", "chương chưa có trang để xuất");
  return insertJob(tx, {
    workspaceId: ws,
    payload,
    key: exportKey(
      payload,
      rows.map((r) => ({ ...r, version: r.version ?? 0 })),
    ),
    chapterId: ch.id,
  });
}

async function pageIn(tx: DbLike, ws: string, pageId: string): Promise<Page> {
  const [p] = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, ws), eq(pages.id, pageId)));
  if (!p) throw new NotFoundError("page");
  return p;
}

/**
 * Bước 1 (tiếp): tạo pages + page_states rỗng + page.prepare cho kết quả ingest (cùng transaction với complete).
 * Giai đoạn 1 xong chương dừng ở `prepared` — bước 2 (dịch) chỉ chạy khi người dùng bấm (`translatePrepared`).
 */
export async function createIngestedPages(
  tx: DbLike,
  ch: Chapter,
  rows: Array<Omit<typeof pages.$inferInsert, "workspaceId" | "chapterId" | "status">>,
) {
  const s = await seriesOf(tx, ch);
  // Không có chỉnh sửa tay (đã kiểm) → bỏ page của lần ingest trước (cascade page_states/history/job).
  await tx.delete(pages).where(eq(pages.chapterId, ch.id));
  const inserted = await tx
    .insert(pages)
    .values(rows.map((r) => ({ ...r, workspaceId: ch.workspaceId, chapterId: ch.id, status: "pending" as const })))
    .returning();
  await tx
    .insert(pageStates)
    .values(
      inserted.map((p) => ({ pageId: p.id, workspaceId: ch.workspaceId, state: emptyPageState(p.width, p.height) })),
    );
  for (const p of inserted) await enqueuePrepare(tx, p, s, ch);
  await tx.update(chapters).set({ status: "processing" }).where(eq(chapters.id, ch.id));
  return inserted;
}

/**
 * Bước 2 "Dịch": chương `prepared` → chapter.translate cho mọi page đã qua giai đoạn 1 (chưa dịch). Cả chương đã
 * prepare → ngữ cảnh cuộn; có page lỗi giai đoạn 1 → chỉ dịch page sẵn sàng, ngữ cảnh trang lân cận.
 */
export async function translatePrepared(tx: DbLike, ws: string, chapterId: string) {
  const ch = await lockChapter(tx, ws, chapterId);
  if (ch.status !== "prepared") throw conflict("chapter_not_prepared", "chương chưa xong bước 1 hoặc đang dịch");
  const rows = await tx.select({ id: pages.id, status: pages.status }).from(pages).where(eq(pages.chapterId, ch.id));
  const prepared = rows.filter((p) => p.status === "prepared").map((p) => p.id);
  if (prepared.length === 0) throw conflict("page_not_prepared", "không có trang nào chờ dịch");
  return enqueueTranslate(tx, ws, ch.id, prepared, prepared.length === rows.length ? "rolling" : "neighbors");
}

const BUSY = new Set(["pending", "preparing", "translating"]);

/**
 * Tính lại trạng thái chương sau mỗi sự kiện job (khoá dòng chapter → các complete song song tuần tự hoá, không bỏ
 * lỡ "page cuối cùng xong"). Không tự sang bước 2: hết việc mà còn page `prepared` → chương `prepared` (chờ "Dịch").
 */
export async function refreshChapter(tx: DbLike, ws: string, chapterId: string): Promise<void> {
  const ch = await lockChapter(tx, ws, chapterId);
  if (ch.status === "ingesting" || ch.status === "draft") return;
  const rows = await tx.select({ id: pages.id, status: pages.status }).from(pages).where(eq(pages.chapterId, ch.id));
  const busy = rows.some((p) => BUSY.has(p.status)) || !!(await activeJobOf(tx, ch.id, "chapter.translate"));
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
}
