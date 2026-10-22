/**
 * Ảnh credit series đã học ("Luôn bỏ ở series này"): học từ 1 ảnh gốc (trước Bước 1) hoặc từ 1 trang (sau Bước 1 —
 * học mọi ảnh gốc nằm trọn trong trang), xem, xoá. Chương tạo sau có ảnh khớp bị bỏ qua sẵn (`creditSkips`).
 * Hash do trình duyệt gửi: tin trong workspace (sai chỉ làm khớp/không khớp sai, người dùng khôi phục được).
 */
import { chapters, NotFoundError, pages, type Scoped, scoped, series, seriesSkipImages, sourceFiles } from "@mtl/db";
import { type ImageFingerprint, isPlainHash, sameImage, storageKeys } from "@mtl/shared";
import { and, eq, inArray, ne, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { inJobTx } from "../jobs/enqueue.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { copyObject, deleteObject, head, MAX_GET_TTL_S, presignGet } from "../storage.ts";

/** Trần ảnh đã học / series — mỗi lần tạo chương so với cả danh sách. */
export const MAX_SKIP_IMAGES = 100;

const LearnBody = z
  .object({ source_file_id: z.string().uuid().optional(), page_id: z.string().uuid().optional() })
  .refine((b) => (b.source_file_id === undefined) !== (b.page_id === undefined), {
    message: "source_file_id hoặc page_id",
  });

type SourceFile = typeof sourceFiles.$inferSelect;
type SkipImage = typeof seriesSkipImages.$inferSelect;
type SourceMapEntry = { source_file_id: string };

const conflict = (error: string, message: string) =>
  new HTTPException(409, { res: Response.json({ error, message }, { status: 409 }) });

const fingerprintOf = (f: SourceFile): ImageFingerprint | null =>
  f.dhash && f.width && f.height ? { dhash: f.dhash, width: f.width, height: f.height } : null;

/**
 * Bộ so khớp ảnh credit đã học của series (đọc 1 lần cho cả chương). Trả 'credit' khi ảnh khớp, null khi không
 * (hoặc ảnh không có hash).
 */
export async function creditMatcher(sdb: Scoped, seriesId: string) {
  const known = await sdb.select(seriesSkipImages, eq(seriesSkipImages.seriesId, seriesId));
  return (fp: Partial<ImageFingerprint>): "credit" | null => {
    if (!fp.dhash || !fp.width || !fp.height) return null;
    const f = fp as ImageFingerprint;
    return known.some((k) => sameImage(f, k)) ? "credit" : null;
  };
}

/** Chương của series này (chương series khác / workspace khác → 404 như không tồn tại). */
async function chapterInSeries(sdb: Scoped, chapterId: string, seriesId: string, what: string) {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  if (ch.seriesId !== seriesId) throw new NotFoundError(what);
  return ch;
}

/** Ảnh gốc nằm trọn trong trang: chỉ trang này tham chiếu tới nó trong source_map của chương. */
async function filesInsidePage(sdb: Scoped, seriesId: string, pageId: string) {
  const p = await sdb.byId(pages, pageId, "page");
  const ch = await chapterInSeries(sdb, p.chapterId, seriesId, "page");
  const ids = new Set((p.sourceMap as SourceMapEntry[]).map((m) => m.source_file_id));
  const others = await sdb.select(pages, and(eq(pages.chapterId, ch.id), ne(pages.id, p.id)) as SQL);
  for (const o of others) for (const m of o.sourceMap as SourceMapEntry[]) ids.delete(m.source_file_id);
  const files = ids.size
    ? await sdb.select(sourceFiles, and(eq(sourceFiles.chapterId, ch.id), inArray(sourceFiles.id, [...ids])) as SQL)
    : [];
  return { chapterId: ch.id, files };
}

const skipImageView = async (r: SkipImage) => ({
  id: r.id,
  width: r.width,
  height: r.height,
  url: await presignGet(r.thumbKey, MAX_GET_TTL_S),
  created_at: r.createdAt,
});

export const seriesSkipImageRoutes = new Hono<AppEnv>();

/**
 * Học ảnh credit. Ảnh đã có trong danh sách (hash khớp) bỏ qua, không tạo bản sao. 409: trang không chứa trọn ảnh
 * gốc nào (`no_whole_image`), không ảnh nào có hash (`no_hash`), ảnh gần trơn (`plain_image`), chưa tải lên xong
 * (`not_uploaded`), đầy danh sách. Khoá hàng series suốt lượt học → bấm 2 lần / 2 tab cùng lúc không học trùng, không
 * vượt trần. Trả số ảnh học mới + số ảnh đã có sẵn.
 */
seriesSkipImageRoutes.post("/w/:ws/series/:seriesId/skip-images", requireWorkspace(), async (c) => {
  const body = await parseJson(c, LearnBody);
  const ws = c.get("workspaceId");
  const seriesId = c.req.param("seriesId");
  const userId = c.get("user").id;
  const result = await inJobTx(async (tx) => {
    const [locked] = await tx
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.workspaceId, ws), eq(series.id, seriesId)))
      .for("update");
    if (!locked) throw new NotFoundError("series");
    return learnInto(scoped(tx, ws), ws, locked.id, body, userId);
  });
  return c.json(result);
});

async function learnInto(
  sdb: Scoped,
  ws: string,
  seriesId: string,
  body: z.infer<typeof LearnBody>,
  userId: string,
): Promise<{ learned: number; known: number }> {
  let source: { chapterId: string; files: SourceFile[] };
  if (body.source_file_id) {
    const f = await sdb.byId(sourceFiles, body.source_file_id, "source file");
    source = { chapterId: (await chapterInSeries(sdb, f.chapterId, seriesId, "source file")).id, files: [f] };
  } else {
    source = await filesInsidePage(sdb, seriesId, body.page_id as string);
    if (!source.files.length) {
      throw conflict("no_whole_image", "Trang không chứa trọn ảnh gốc nào — không học được.");
    }
  }

  const hashed = source.files.flatMap((f) => {
    const fp = fingerprintOf(f);
    return fp ? [{ file: f, fp }] : [];
  });
  if (!hashed.length) throw conflict("no_hash", "Ảnh này không có dấu nhận dạng — không học được.");
  if (hashed.every((h) => isPlainHash(h.fp.dhash))) {
    throw conflict("plain_image", "Ảnh gần như trơn — không học được (dễ tự bỏ nhầm trang truyện).");
  }
  const known: ImageFingerprint[] = await sdb.select(seriesSkipImages, eq(seriesSkipImages.seriesId, seriesId));
  const fresh: typeof hashed = [];
  for (const h of hashed) {
    if (isPlainHash(h.fp.dhash)) continue;
    if (![...known, ...fresh.map((x) => x.fp)].some((k) => sameImage(h.fp, k))) fresh.push(h);
  }
  if (known.length + fresh.length > MAX_SKIP_IMAGES) {
    throw conflict("skip_images_full", `Series đã có ${known.length} ảnh tự bỏ (tối đa ${MAX_SKIP_IMAGES}).`);
  }
  for (const { file } of fresh) {
    if (!(await head(file.storageKey))) throw conflict("not_uploaded", "Ảnh chưa tải lên xong — thử lại sau.");
  }
  // Chép ảnh trước, ghi hàng sau: lỗi giữa chừng chỉ để lại object mồ côi, không có hàng trỏ tới object thiếu.
  for (const { file, fp } of fresh) {
    const id = uuidv7();
    const thumbKey = storageKeys.seriesSkip(ws, seriesId, id, file.storageKey.split(".").pop() ?? "img");
    await copyObject(file.storageKey, thumbKey);
    await sdb.insert(seriesSkipImages, {
      id,
      seriesId: seriesId,
      ...fp,
      thumbKey,
      learnedFromChapterId: source.chapterId,
      createdBy: userId,
    });
  }
  return { learned: fresh.length, known: hashed.length - fresh.length };
}

seriesSkipImageRoutes.get("/w/:ws/series/:seriesId/skip-images", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const s = await sdb.byId(series, c.req.param("seriesId"), "series");
  const rows = await sdb.select(seriesSkipImages, eq(seriesSkipImages.seriesId, s.id));
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return c.json({ images: await Promise.all(rows.map(skipImageView)) });
});

/** Bỏ ảnh khỏi danh sách: chương tạo sau không tự bỏ ảnh đó nữa (chương đã tạo giữ nguyên). */
seriesSkipImageRoutes.delete("/w/:ws/series/:seriesId/skip-images/:imageId", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const s = await sdb.byId(series, c.req.param("seriesId"), "series");
  const img = await sdb.byId(seriesSkipImages, c.req.param("imageId"), "skip image");
  if (img.seriesId !== s.id) throw new NotFoundError("skip image");
  await sdb.delete(seriesSkipImages, eq(seriesSkipImages.id, img.id));
  try {
    await deleteObject(img.thumbKey);
  } catch (err) {
    console.error("[series-skip-images] xoá ảnh thất bại", err);
  }
  return c.body(null, 204);
});
