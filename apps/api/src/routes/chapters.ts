/**
 * Vòng đời chương phía người dùng: tạo + presigned POST từng file → commit (HEAD + magic bytes) → ingest,
 * chạy lại trang lỗi / dịch lại / huỷ, khoá chương. Không có endpoint nhận file: trình duyệt upload thẳng
 * MinIO theo policy giới hạn (red team #12), server kiểm lại khi commit.
 */

import { chapters, pages, scoped, series, sourceFiles } from "@mtl/db";
import { storageKeys } from "@mtl/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { enqueueIngest, inJobTx, retranslate, retryFailedPages } from "../jobs/enqueue.ts";
import { acquireChapterLock, activeLockHolder, LOCK_TTL_MS, releaseChapterLock } from "../lib/chapter-lock.ts";
import { cancelChapterJobs, removeChapters } from "../lib/chapter-removal.ts";
import { memberNames } from "../lib/member-names.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { head, MAX_POST_TTL_S, presignPost, readPrefix } from "../storage.ts";
import { jobView } from "./jobs.ts";
import { chapterStats, chapterSummary, exportStatus } from "./series.ts";

/** Ảnh nhận upload → đuôi key. Content-Type nằm trong policy POST nên MinIO giữ đúng giá trị này. */
export const CHAPTER_UPLOAD_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
type UploadMime = keyof typeof CHAPTER_UPLOAD_TYPES;
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_FILES_PER_CHAPTER = 400;

/** Nhận dạng ảnh từ 16 byte đầu; không khớp PNG/JPEG/WEBP → null. */
export function sniffImageMime(b: Uint8Array): UploadMime | null {
  const at = (i: number, ...sig: number[]) => sig.every((v, k) => b[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  // RIFF....WEBP
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export type RejectReason = "missing" | "too_large" | "type_mismatch";

/** Kết quả kiểm 1 object đã upload (tách khỏi I/O để test thuần). */
export function validateUploaded(
  declaredMime: string,
  obj: { bytes: number; prefix: Uint8Array } | null,
): RejectReason | null {
  if (!obj) return "missing";
  if (obj.bytes > MAX_FILE_BYTES || obj.bytes < 1) return "too_large";
  return sniffImageMime(obj.prefix) === declaredMime ? null : "type_mismatch";
}

const UploadFile = z.object({
  name: z.string().min(1).max(255),
  content_type: z.enum(Object.keys(CHAPTER_UPLOAD_TYPES) as [UploadMime, ...UploadMime[]]),
  bytes: z.number().int().min(1).max(MAX_FILE_BYTES),
});

const ChapterNumber = z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(String);

const ChapterCreate = z.object({
  series_id: z.string().uuid(),
  number: ChapterNumber,
  title: z.string().trim().max(200).default(""),
  /** Theo thứ tự trang (client đã sort tên tự nhiên + cho kéo thả). */
  files: z.array(UploadFile).min(1).max(MAX_FILES_PER_CHAPTER),
});

/** Sửa số chương / chuyển series (sửa sau khi thả file tự tạo chương). */
const ChapterPatch = z
  .object({ number: ChapterNumber.optional(), series_id: z.string().uuid().optional() })
  .refine((b) => b.number !== undefined || b.series_id !== undefined, { message: "number hoặc series_id" });

const PresignBody = z.object({ file_ids: z.array(z.string().uuid()).min(1).max(MAX_FILES_PER_CHAPTER) });
const CommitBody = z.object({ mode: z.enum(["strip", "pages"]).default("strip") });
const RecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  open: z.enum(["0", "1"]).default("0"),
});
const TranslateBody = z.object({ page_ids: z.array(z.string().uuid()).min(1).max(1000).optional() });

type SourceFile = typeof sourceFiles.$inferSelect;

const conflict = (error: string, message: string) =>
  new HTTPException(409, { res: Response.json({ error, message }, { status: 409 }) });

async function presignFile(f: SourceFile) {
  const post = await presignPost(f.storageKey, f.mime, f.bytes, MAX_POST_TTL_S);
  return { id: f.id, ord: f.ord, url: post.url, fields: post.fields, expires_at: post.expiresAt };
}

/** Chạy fn trên từng phần tử, tối đa `limit` cùng lúc (giữ thứ tự kết quả). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

export const chapterRoutes = new Hono<AppEnv>();

/**
 * Chương gần đây của workspace cho "Việc cần làm" ở home. Path riêng (không `/chapters/recent`) để không đụng
 * `/chapters/:chapterId`. Thứ tự: chương mình đang giữ khoá trước, rồi `updated_at` mới nhất (heartbeat khoá cũng
 * bump cột này = "đang làm"). `open=1` bỏ chương đã xuất/xong (trừ chương sửa sau lần xuất cuối); nháp upload dở
 * vẫn có.
 */
chapterRoutes.get("/w/:ws/recent-chapters", requireWorkspace(), async (c) => {
  const q = RecentQuery.safeParse(c.req.query());
  if (!q.success) {
    throw new HTTPException(400, {
      res: Response.json({ error: "invalid_query", issues: q.error.issues }, { status: 400 }),
    });
  }
  const sdb = c.get("sdb");
  const me = c.get("user").id;
  const all = await sdb.select(chapters);
  // open=1: bỏ chương đã xuất mà chưa sửa gì sau đó (chương cần "Xuất lại" vẫn còn trong danh sách).
  const exported = q.data.open === "1" ? (await exportStatus(sdb, all)).exported : new Set<string>();
  const mine = (ch: (typeof all)[number]) => activeLockHolder(ch) === me;
  const picked = all
    .filter((ch) => !exported.has(ch.id))
    .sort((a, b) => Number(mine(b)) - Number(mine(a)) || b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, q.data.limit);
  const [seriesRows, pickedStats] = await Promise.all([
    picked.length
      ? sdb.select(series, inArray(series.id, [...new Set(picked.map((ch) => ch.seriesId))]))
      : Promise.resolve([]),
    chapterStats(sdb, picked),
  ]);
  const title = new Map(seriesRows.map((s) => [s.id, s.title]));
  return c.json({
    chapters: picked.map((ch) => ({
      ...chapterSummary(ch),
      series_title: title.get(ch.seriesId) ?? "",
      page_counts: pickedStats.pageCounts(ch.id),
      exported: pickedStats.exported(ch.id),
      reexport: pickedStats.reexport(ch.id),
      lock_holder_is_me: mine(ch),
    })),
  });
});

/** Tạo chương (draft) + source_files theo thứ tự + presigned POST cho từng file. */
chapterRoutes.post("/w/:ws/chapters", requireWorkspace(), async (c) => {
  const body = await parseJson(c, ChapterCreate);
  const ws = c.get("workspaceId");
  const { chapter, files } = await c.get("sdb").transaction(async (tx) => {
    const s = await tx.byId(series, body.series_id, "series");
    const chapter = await tx.insert(chapters, { seriesId: s.id, number: body.number, title: body.title });
    const files: SourceFile[] = [];
    for (const [ord, f] of body.files.entries()) {
      const key = storageKeys.source(ws, chapter.id, uuidv7(), CHAPTER_UPLOAD_TYPES[f.content_type]);
      files.push(
        await tx.insert(sourceFiles, {
          chapterId: chapter.id,
          ord,
          storageKey: key,
          bytes: f.bytes,
          mime: f.content_type,
        }),
      );
    }
    return { chapter, files };
  });
  const uploads = await Promise.all(files.map(presignFile));
  return c.json(
    {
      chapter: chapterSummary(chapter),
      files: uploads.map((u, i) => ({ ...u, name: body.files[i]?.name ?? "" })),
    },
    201,
  );
});

/**
 * Đổi số chương và/hoặc series (series đích cùng workspace, không thì 404). Mọi trạng thái chương: storage key theo
 * id chương nên không phải chép object; lần xuất sau đặt tên file theo số mới. Trùng số trong series đích → 409.
 */
chapterRoutes.patch("/w/:ws/chapters/:chapterId", requireWorkspace(), async (c) => {
  const body = await parseJson(c, ChapterPatch);
  const updated = await c.get("sdb").transaction(async (tx) => {
    const ch = await tx.byId(chapters, c.req.param("chapterId"), "chapter");
    const seriesId = body.series_id ? (await tx.byId(series, body.series_id, "series")).id : ch.seriesId;
    const number = body.number ?? ch.number;
    if (seriesId === ch.seriesId && Number(number) === Number(ch.number)) return ch;
    const siblings = await tx.select(chapters, eq(chapters.seriesId, seriesId));
    if (siblings.some((x) => x.id !== ch.id && Number(x.number) === Number(number))) {
      throw conflict("chapter_number_taken", `series đã có chương ${number}`);
    }
    const [row] = await tx.update(chapters, eq(chapters.id, ch.id), { seriesId, number });
    if (!row) throw new HTTPException(404, { message: "chapter not found" });
    return row;
  });
  return c.json(chapterSummary(updated));
});

/** Ký lại POST cho file chưa upload xong (retry sau mất mạng / policy hết hạn). Chỉ khi chương còn draft. */
chapterRoutes.post("/w/:ws/chapters/:chapterId/presign", requireWorkspace(), async (c) => {
  const body = await parseJson(c, PresignBody);
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  if (ch.status !== "draft") throw conflict("chapter_not_draft", "chương đã commit — không upload thêm");
  const rows = await sdb.select(
    sourceFiles,
    and(eq(sourceFiles.chapterId, ch.id), inArray(sourceFiles.id, body.file_ids)),
  );
  if (rows.length !== new Set(body.file_ids).size) throw new HTTPException(404, { message: "file not found" });
  return c.json({ files: await Promise.all(rows.map(presignFile)) });
});

/**
 * Commit: với từng file HEAD (tồn tại, ≤ 30MB) + 16 byte đầu khớp `mime` khai báo. File sai bị loại (xoá
 * khỏi source_files) và báo lại; còn file hợp lệ → enqueue **chỉ** chapter.ingest (pages do ingest tạo).
 * Chỉ commit chương nháp hoặc chương ingest lỗi (chưa có page) — chương đã xử lý muốn làm lại thì tạo chương
 * mới (tránh xoá bản AI/chỉnh sửa và trả tiền dịch lại). Loại file + enqueue cùng transaction: enqueueIngest
 * từ chối (409) thì không mất source_files nào.
 */
chapterRoutes.post("/w/:ws/chapters/:chapterId/commit", requireWorkspace(), async (c) => {
  const body = await parseJson(c, CommitBody);
  const sdb = c.get("sdb");
  const ws = c.get("workspaceId");
  const user = c.get("user");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const holder = activeLockHolder(ch);
  if (holder && holder !== user.id) {
    throw new HTTPException(423, { res: Response.json({ error: "chapter_locked", holder }, { status: 423 }) });
  }
  const ingestFailed = ch.status === "partial_failed" && !(await sdb.find(pages, eq(pages.chapterId, ch.id)));
  if (ch.status !== "draft" && !ingestFailed) {
    throw conflict("chapter_not_draft", "chương đã xử lý — tạo chương mới để upload lại");
  }
  const files = await sdb.select(sourceFiles, eq(sourceFiles.chapterId, ch.id));
  files.sort((a, b) => a.ord - b.ord);
  if (files.length === 0) throw new HTTPException(400, { message: "chapter has no source files" });

  const checked = await mapLimit(files, 8, async (f) => {
    const h = await head(f.storageKey);
    const obj = h ? { bytes: h.bytes, prefix: await readPrefix(f.storageKey, 16) } : null;
    return { file: f, bytes: h?.bytes ?? 0, reason: validateUploaded(f.mime, obj) };
  });
  const rejected = checked.filter((r) => r.reason !== null);
  const valid = checked.filter((r) => r.reason === null);
  const rejectedView = rejected.map((r) => ({ id: r.file.id, ord: r.file.ord, reason: r.reason }));
  if (valid.length === 0) {
    // Giữ nguyên source_files: chương vẫn nháp, người dùng upload lại file rồi commit tiếp.
    throw new HTTPException(400, {
      res: Response.json({ error: "no_valid_files", rejected: rejectedView }, { status: 400 }),
    });
  }
  const { job, created } = await inJobTx(async (tx) => {
    const t = scoped(tx, ws);
    if (rejected.length) {
      await t.delete(
        sourceFiles,
        inArray(
          sourceFiles.id,
          rejected.map((r) => r.file.id),
        ),
      );
    }
    // Dung lượng thật thay cho số client khai báo.
    for (const r of valid) {
      if (r.bytes !== r.file.bytes) await t.update(sourceFiles, eq(sourceFiles.id, r.file.id), { bytes: r.bytes });
    }
    return enqueueIngest(tx, ws, ch.id, body.mode);
  });
  return c.json({ job: jobView(job), created, accepted: valid.length, rejected: rejectedView }, 202);
});

/** Chi tiết chương + khoá + danh sách source file (để tiếp tục upload/commit chương draft). */
chapterRoutes.get("/w/:ws/chapters/:chapterId", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const [s, files] = await Promise.all([
    sdb.byId(series, ch.seriesId, "series"),
    sdb.select(sourceFiles, eq(sourceFiles.chapterId, ch.id)),
  ]);
  const holder = activeLockHolder(ch);
  const names = holder ? await memberNames(c.get("workspaceId"), [holder]) : new Map<string, string>();
  return c.json({
    ...chapterSummary(ch),
    ingest_rev: ch.ingestRev,
    series: { id: s.id, title: s.title },
    lock:
      holder && ch.lockedAt
        ? {
            holder,
            holder_name: names.get(holder) ?? null,
            is_me: holder === c.get("user").id,
            expires_at: new Date(ch.lockedAt.getTime() + LOCK_TTL_MS),
          }
        : null,
    source_files: files
      .sort((a, b) => a.ord - b.ord)
      .map((f) => ({ id: f.id, ord: f.ord, bytes: f.bytes, mime: f.mime })),
  });
});

/** Page lỗi giai đoạn 1 → page.prepare; lỗi giai đoạn 2 → chapter.translate cho riêng chúng. */
chapterRoutes.post("/w/:ws/chapters/:chapterId/retry-failed", requireWorkspace(), async (c) => {
  const ch = await c.get("sdb").byId(chapters, c.req.param("chapterId"), "chapter");
  const created = await inJobTx((tx) => retryFailedPages(tx, c.get("workspaceId"), ch.id));
  return c.json({ jobs: created.map(jobView) }, 202);
});

/** Dịch lại cả chương (ngữ cảnh cuộn) hoặc tập page (`page_ids`, dùng ngữ cảnh trang lân cận). */
chapterRoutes.post("/w/:ws/chapters/:chapterId/translate", requireWorkspace(), async (c) => {
  const body = await parseJson(c, TranslateBody);
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  if (!(await sdb.find(pages, eq(pages.chapterId, ch.id)))) throw conflict("no_pages", "chương chưa có trang để dịch");
  const { job, created } = await inJobTx((tx) => retranslate(tx, c.get("workspaceId"), ch.id, body.page_ids));
  return c.json({ job: jobView(job), created }, 202);
});

/** Huỷ mọi job đang hoạt động của chương. */
chapterRoutes.post("/w/:ws/chapters/:chapterId/cancel", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const cancelled = await cancelChapterJobs(sdb, c.get("workspaceId"), ch.id);
  const after = await sdb.byId(chapters, ch.id, "chapter");
  return c.json({ cancelled, chapter: chapterSummary(after) });
});

/** Xoá hẳn chương (mọi trạng thái): huỷ job, xoá dữ liệu + file. Người khác đang giữ khoá → 423. */
chapterRoutes.delete("/w/:ws/chapters/:chapterId", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  await removeChapters(sdb, c.get("workspaceId"), c.get("user").id, [ch], async () => {
    await sdb.delete(chapters, eq(chapters.id, ch.id));
  });
  return c.body(null, 204);
});

/** Lấy/gia hạn khoá (heartbeat từ editor). Người khác giữ → 423 kèm tên người giữ. */
chapterRoutes.post("/w/:ws/chapters/:chapterId/lock", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const user = c.get("user");
  const r = await acquireChapterLock(sdb, c.req.param("chapterId"), user.id);
  if (!r.ok) {
    const names = await memberNames(c.get("workspaceId"), [r.holder]);
    return c.json({ error: "chapter_locked", holder: r.holder, holder_name: names.get(r.holder) ?? null }, 423);
  }
  return c.json({ holder: user.id, expires_at: new Date(Date.now() + LOCK_TTL_MS) });
});

chapterRoutes.delete("/w/:ws/chapters/:chapterId/lock", requireWorkspace(), async (c) => {
  await releaseChapterLock(c.get("sdb"), c.req.param("chapterId"), c.get("user").id);
  return c.body(null, 204);
});
