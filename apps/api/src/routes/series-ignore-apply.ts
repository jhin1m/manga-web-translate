/**
 * Áp chữ bỏ qua của series vào chương đã dịch: ẩn (`hidden = true`) các box gắn với vùng có `source_text` khớp danh
 * sách. Không xoá box, không đổi bản dịch. Dùng lõi sửa hàng loạt (lib/batch-edit.ts): preview → apply (kèm
 * `versions`) → hoàn tác theo `batch_id`, mọi chương cùng một `batch_id`.
 *
 * Mỗi chương một transaction, khoá dòng chương (FOR UPDATE) rồi mới kiểm người giữ khoá + job đang chạy ngay trong
 * transaction đó (không dùng ảnh chụp lúc đầu request): chương đang bị người khác giữ khoá, đang có job chạy, hoặc đổi
 * sau preview được bỏ qua và báo lại — không ảnh hưởng chương khác. Chỉ đọc state của một chương tại một thời điểm.
 */
import { chapters, jobs, pages, type Scoped, scoped, series } from "@mtl/db";
import { ACTIVE_JOB_STATUSES, type IgnoreMatcher, type PageState } from "@mtl/shared";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { inJobTx, lockChapter, notReadOnlyJob } from "../jobs/enqueue.ts";
import {
  applyBatch,
  chapterBatchHistory,
  chapterPages,
  httpError,
  previewPages,
  undoBatch,
} from "../lib/batch-edit.ts";
import { activeLockHolder } from "../lib/chapter-lock.ts";
import { compileIgnoreListRe2 } from "../lib/ignore-text.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

const SAMPLES_PER_CHAPTER = 3;
const SAMPLE_MAX_CHARS = 80;
/** Nhãn ghi vào `actor` lịch sử để undo chỉ nhận batch do chức năng này tạo (không nhận batch find/replace, glossary). */
const BATCH_TAG = "ignore-text";

const PreviewBody = z.object({});
const ApplyBody = z.object({ versions: z.record(z.uuid(), z.number().int().nonnegative()) });
const UndoBody = z.object({ batch_id: z.uuid() });

type HideMatch = { id: string; source: string; count: 1 };
type Chapter = typeof chapters.$inferSelect;
type SkipReason = "locked" | "busy" | "changed";

/** Ẩn box chưa ẩn gắn với vùng có chữ nguồn bị bỏ qua. Thuần; state đầu vào không bị sửa. */
export function hideIgnored(state: PageState, isIgnored: IgnoreMatcher): { state: PageState; matches: HideMatch[] } {
  const source = new Map(state.regions.filter((r) => isIgnored(r.source_text)).map((r) => [r.id, r.source_text]));
  const matches: HideMatch[] = [];
  const text_boxes = state.text_boxes.map((b) => {
    const text = b.region_id ? source.get(b.region_id) : undefined;
    if (text === undefined || b.hidden) return b;
    matches.push({ id: b.id, source: text, count: 1 });
    return { ...b, hidden: true };
  });
  return { state: matches.length ? { ...state, text_boxes } : state, matches };
}

const sample = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > SAMPLE_MAX_CHARS ? `${t.slice(0, SAMPLE_MAX_CHARS)}…` : t;
};

const byNumber = (a: Chapter, b: Chapter) =>
  Number(a.number) - Number(b.number) || a.createdAt.getTime() - b.createdAt.getTime();

const chapterRef = (ch: Chapter) => ({ chapter_id: ch.id, number: ch.number, title: ch.title });

/** Chương của series theo số chương + id chương đang có job hoạt động. */
async function chaptersWithBusy(sdb: Scoped, seriesId: string) {
  const chs = (await sdb.select(chapters, eq(chapters.seriesId, seriesId))).sort(byNumber);
  const active = chs.length
    ? await sdb.select(
        jobs,
        and(
          inArray(
            jobs.chapterId,
            chs.map((c) => c.id),
          ),
          inArray(jobs.status, [...ACTIVE_JOB_STATUSES]),
          notReadOnlyJob,
        ) as SQL,
      )
    : [];
  return { chs, busy: new Set(active.map((j) => j.chapterId)) };
}

/** Lý do chương không được đụng tới (tab khác đang giữ khoá / đang chạy job), null = được. */
const blockedReason = (ch: Chapter, busy: Set<string | null>, holder: string): SkipReason | null => {
  const current = activeLockHolder(ch);
  if (current && current !== holder) return "locked";
  return busy.has(ch.id) ? "busy" : null;
};

type Guarded<T> = { ok: true; value: T } | { ok: false; reason: Extract<SkipReason, "locked" | "busy"> };

/**
 * Chạy `fn` trong 1 transaction đang khoá dòng chương. Tab khác giữ khoá còn hạn (editor đang mở) / chương đang có
 * job hoạt động → không chạy. Không cần lấy khoá chương: dòng bị khoá tới hết transaction nên không ai lấy được khoá
 * xen vào, và khoá của chính tab này không bị đụng tới.
 */
function withChapter<T>(
  userId: string,
  holder: string,
  chapterId: string,
  fn: (tx: Scoped) => Promise<T>,
): Promise<Guarded<T>> {
  return inJobTx(async (tx): Promise<Guarded<T>> => {
    const ch = await lockChapter(tx, userId, chapterId);
    const current = activeLockHolder(ch);
    if (current && current !== holder) return { ok: false, reason: "locked" };
    const t = scoped(tx, userId);
    const running = await t.select(
      jobs,
      and(eq(jobs.chapterId, chapterId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES]), notReadOnlyJob) as SQL,
    );
    if (running.length) return { ok: false, reason: "busy" };
    return { ok: true, value: await fn(t) };
  });
}

async function ignoreMatcher(sdb: Scoped, seriesId: string) {
  const s = await sdb.byId(series, seriesId, "series");
  return compileIgnoreListRe2(s.ignoreText);
}

export const seriesIgnoreApplyRoutes = new Hono<AppEnv>();
const base = "/series/:seriesId/ignore-apply";

/** Mỗi chương: số box sẽ ẩn + vài mẫu chữ nguồn + `versions`; chương không thể áp được liệt kê ở `skipped`. */
seriesIgnoreApplyRoutes.post(`${base}/preview`, async (c) => {
  await parseJson(c, PreviewBody);
  const sdb = c.get("sdb");
  const seriesId = c.req.param("seriesId");
  const isIgnored = await ignoreMatcher(sdb, seriesId);
  const { chs, busy } = await chaptersWithBusy(sdb, seriesId);
  const transform = (st: PageState) => hideIgnored(st, isIgnored);
  const out: (ReturnType<typeof chapterRef> & {
    boxes: number;
    pages: number;
    samples: string[];
    versions: Record<string, number>;
  })[] = [];
  const skipped: (ReturnType<typeof chapterRef> & { reason: SkipReason })[] = [];
  for (const ch of chs) {
    const pv = previewPages(await chapterPages(sdb, ch.id), transform);
    if (pv.total === 0) continue;
    const reason = blockedReason(ch, busy, c.get("lockHolder"));
    if (reason) {
      skipped.push({ ...chapterRef(ch), reason });
      continue;
    }
    const samples = [...new Set(pv.matches.map((m) => sample(m.source)))].slice(0, SAMPLES_PER_CHAPTER);
    out.push({
      ...chapterRef(ch),
      boxes: pv.total,
      pages: Object.keys(pv.versions).length,
      samples,
      versions: pv.versions,
    });
  }
  return c.json({ chapters: out, skipped, total_boxes: out.reduce((n, ch) => n + ch.boxes, 0) });
});

/**
 * Ẩn box ở mọi chương áp được; `versions` (gộp từ preview) chốt trang đã xem — chỉ chương có trang trong `versions`
 * được ghi, trang đổi sau đó → chương bị bỏ qua.
 */
seriesIgnoreApplyRoutes.post(`${base}/apply`, async (c) => {
  const body = await parseJson(c, ApplyBody);
  const sdb = c.get("sdb");
  const user = c.get("user");
  const seriesId = c.req.param("seriesId");
  const isIgnored = await ignoreMatcher(sdb, seriesId);
  const { chs, busy } = await chaptersWithBusy(sdb, seriesId);
  const pageIds = Object.keys(body.versions);
  const previewed = new Set(
    pageIds.length ? (await sdb.select(pages, inArray(pages.id, pageIds))).map((p) => p.chapterId) : [],
  );
  const transform = (st: PageState) => hideIgnored(st, isIgnored);
  const batchId = uuidv7();
  const done: (ReturnType<typeof chapterRef> & { boxes: number; pages: number })[] = [];
  const skipped: (ReturnType<typeof chapterRef> & { reason: SkipReason })[] = [];
  for (const ch of chs) {
    if (!previewed.has(ch.id)) {
      // Chương preview đã liệt kê là bị chặn (nên không có trong `versions`): chỉ đọc state của chương đang bị chặn
      // để báo lại nếu còn chữ cần ẩn; chương còn lại không liên quan tới lần áp này.
      const reason = blockedReason(ch, busy, c.get("lockHolder"));
      if (reason && (await chapterPages(sdb, ch.id)).some((p) => transform(p.state).matches.length)) {
        skipped.push({ ...chapterRef(ch), reason });
      }
      continue;
    }
    try {
      const r = await withChapter(user.id, c.get("lockHolder"), ch.id, (tx) =>
        applyBatch(tx, ch.id, user.id, transform, body.versions, batchId, BATCH_TAG),
      );
      if (!r.ok) skipped.push({ ...chapterRef(ch), reason: r.reason });
      else if (r.value.pages) done.push({ ...chapterRef(ch), boxes: r.value.changed, pages: r.value.pages });
    } catch (err) {
      if (!(err instanceof HTTPException) || err.status !== 409) throw err;
      skipped.push({ ...chapterRef(ch), reason: "changed" });
    }
  }
  return c.json({
    batch_id: done.length ? batchId : null,
    boxes: done.reduce((n, ch) => n + ch.boxes, 0),
    chapters: done,
    skipped,
  });
});

/**
 * Hoàn tác theo batch do áp chữ bỏ qua tạo ra (không còn bản ghi — đã hoàn tác hết / bị dọn / batch của chức năng khác
 * → 410): trang đã đổi sau khi áp, chương bị tab khác giữ khoá hoặc đang có job chạy được bỏ qua và báo lại.
 */
seriesIgnoreApplyRoutes.post(`${base}/undo`, async (c) => {
  const body = await parseJson(c, UndoBody);
  const sdb = c.get("sdb");
  const user = c.get("user");
  const seriesId = c.req.param("seriesId");
  await sdb.byId(series, seriesId, "series");
  const chs = (await sdb.select(chapters, eq(chapters.seriesId, seriesId))).sort(byNumber);
  const restoredIn: (ReturnType<typeof chapterRef> & { pages: number })[] = [];
  const skipped: (ReturnType<typeof chapterRef> & { reason: SkipReason; pages: number })[] = [];
  let found = false;
  for (const ch of chs) {
    const hist = await chapterBatchHistory(sdb, ch.id, body.batch_id);
    if (hist.length === 0) continue;
    // Một batch chỉ có một loại actor: kiểm ở chương đầu tiên có bản ghi, trước khi ghi gì.
    if (!hist.every((h) => h.actor.endsWith(`#${BATCH_TAG}`))) throw httpError(410, { error: "batch_not_found" });
    found = true;
    const r = await withChapter(user.id, c.get("lockHolder"), ch.id, (tx) =>
      undoBatch(tx, ch.id, user.id, body.batch_id, "skip"),
    );
    if (!r.ok) {
      skipped.push({ ...chapterRef(ch), reason: r.reason, pages: hist.length });
      continue;
    }
    if (r.value.restored) restoredIn.push({ ...chapterRef(ch), pages: r.value.restored });
    if (r.value.skipped.length) skipped.push({ ...chapterRef(ch), reason: "changed", pages: r.value.skipped.length });
  }
  if (!found) throw httpError(410, { error: "batch_not_found" });
  return c.json({ pages: restoredIn.reduce((n, ch) => n + ch.pages, 0), chapters: restoredIn, skipped });
});
