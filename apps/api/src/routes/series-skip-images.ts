/**
 * Ảnh credit series đã học ("Luôn bỏ ở series này"): học từ 1 ảnh gốc (trước Bước 1) hoặc từ 1 trang (sau Bước 1 —
 * học mọi ảnh gốc nằm trọn trong trang), xem, xoá. Chương tạo sau có ảnh khớp bị bỏ qua sẵn (`creditSkips`).
 * Hash do trình duyệt gửi: tin trong dữ liệu của chính người dùng (sai chỉ làm khớp/không khớp sai, người dùng khôi phục được).
 */
import { chapters, NotFoundError, pages, type Scoped, scoped, series, seriesSkipImages, sourceFiles } from "@mtl/db";
import { DHASH_RE, type ImageFingerprint, isPlainHash, MIN_BAND_PX, sameImage, storageKeys } from "@mtl/shared";
import { and, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { inJobTx } from "../jobs/enqueue.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";
import { copyObject, deleteObject, head, MAX_GET_TTL_S, presignGet } from "../storage.ts";

const SKIP_EDGES = ["top", "bottom"] as const;
type Edge = (typeof SKIP_EDGES)[number];

/** Trần ảnh đã học / series — mỗi lần tạo chương so với cả danh sách. */
export const MAX_SKIP_IMAGES = 100;

const WholeBody = z
  .object({ source_file_id: z.string().uuid().optional(), page_id: z.string().uuid().optional() })
  .strict()
  .refine((b) => (b.source_file_id === undefined) !== (b.page_id === undefined), {
    message: "source_file_id hoặc page_id",
  });

/** Dải mép đã cắt của 1 ảnh gốc; dHash do trình duyệt tính từ đúng vùng dải. */
const BandBody = z
  .object({
    source_file_id: z.string().uuid(),
    edge: z.enum(SKIP_EDGES),
    dhash: z.string().regex(DHASH_RE),
    /** Số px dải mà trình duyệt đã băm; phải bằng trim đang lưu của mép đó. */
    band_px: z.number().int().positive(),
  })
  .strict();

const LearnBody = z.union([WholeBody, BandBody]);

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
  const known = await sdb.select(
    seriesSkipImages,
    and(eq(seriesSkipImages.seriesId, seriesId), isNull(seriesSkipImages.edge)) as SQL,
  );
  return (fp: Partial<ImageFingerprint>): "credit" | null => {
    if (!fp.dhash || !fp.width || !fp.height) return null;
    const f = fp as ImageFingerprint;
    return known.some((k) => sameImage(f, k)) ? "credit" : null;
  };
}

/** Chương của series này (chương series khác / người dùng khác → 404 như không tồn tại). */
async function chapterInSeries(sdb: Scoped, chapterId: string, seriesId: string, what: string) {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  if (ch.seriesId !== seriesId) throw new NotFoundError(what);
  return ch;
}

/**
 * Ảnh gốc nằm trọn trong trang: chỉ trang này tham chiếu tới nó trong source_map của chương. Ảnh đã cắt mép bị loại:
 * trang chỉ chứa phần còn lại, không còn là ảnh gốc nguyên vẹn để học.
 */
async function filesInsidePage(sdb: Scoped, seriesId: string, pageId: string) {
  const p = await sdb.byId(pages, pageId, "page");
  const ch = await chapterInSeries(sdb, p.chapterId, seriesId, "page");
  const ids = new Set((p.sourceMap as SourceMapEntry[]).map((m) => m.source_file_id));
  const others = await sdb.select(pages, and(eq(pages.chapterId, ch.id), ne(pages.id, p.id)) as SQL);
  for (const o of others) for (const m of o.sourceMap as SourceMapEntry[]) ids.delete(m.source_file_id);
  const files = ids.size
    ? await sdb.select(
        sourceFiles,
        and(eq(sourceFiles.chapterId, ch.id), inArray(sourceFiles.id, [...ids]), isNull(sourceFiles.trim)) as SQL,
      )
    : [];
  return { chapterId: ch.id, files };
}

const skipImageView = async (r: SkipImage) => ({
  id: r.id,
  edge: r.edge as Edge | null,
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
seriesSkipImageRoutes.post("/series/:seriesId/skip-images", async (c) => {
  const body = await parseJson(c, LearnBody);
  const userId = c.get("userId");
  const seriesId = c.req.param("seriesId");
  const result = await inJobTx(async (tx) => {
    const [locked] = await tx
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.userId, userId), eq(series.id, seriesId)))
      .for("update");
    if (!locked) throw new NotFoundError("series");
    const sdb = scoped(tx, userId);
    return "edge" in body ? learnBand(sdb, locked.id, body) : learnInto(sdb, locked.id, body);
  });
  return c.json(result);
});

async function learnInto(
  sdb: Scoped,
  seriesId: string,
  body: z.infer<typeof WholeBody>,
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
  const all = await sdb.select(seriesSkipImages, eq(seriesSkipImages.seriesId, seriesId));
  const known: ImageFingerprint[] = all.filter((k) => k.edge === null);
  const fresh: typeof hashed = [];
  for (const h of hashed) {
    if (isPlainHash(h.fp.dhash)) continue;
    if (![...known, ...fresh.map((x) => x.fp)].some((k) => sameImage(h.fp, k))) fresh.push(h);
  }
  assertRoom(all.length, fresh.length);
  for (const { file } of fresh) await assertUploaded(file);
  for (const { file, fp } of fresh) await storeLearned(sdb, seriesId, source.chapterId, file, fp, null);
  return { learned: fresh.length, known: hashed.length - fresh.length };
}

function assertRoom(existing: number, adding: number) {
  if (existing + adding > MAX_SKIP_IMAGES) {
    throw conflict("skip_images_full", `Series đã có ${existing} ảnh tự bỏ (tối đa ${MAX_SKIP_IMAGES}).`);
  }
}

async function assertUploaded(file: SourceFile) {
  if (!(await head(file.storageKey))) throw conflict("not_uploaded", "Ảnh chưa tải lên xong — thử lại sau.");
}

/** Chép ảnh trước, ghi hàng sau: lỗi giữa chừng chỉ để lại object mồ côi, không có hàng trỏ tới object thiếu. */
async function storeLearned(
  sdb: Scoped,
  seriesId: string,
  chapterId: string,
  file: SourceFile,
  fp: ImageFingerprint,
  edge: Edge | null,
) {
  const id = uuidv7();
  const thumbKey = storageKeys.seriesSkip(sdb.userId, seriesId, id, file.storageKey.split(".").pop() ?? "img");
  await copyObject(file.storageKey, thumbKey);
  await sdb.insert(seriesSkipImages, {
    id,
    seriesId,
    ...fp,
    edge,
    thumbKey,
    learnedFromChapterId: chapterId,
    createdBy: sdb.userId,
  });
}

/**
 * Học dải mép đã cắt. Chiều cao dải lấy từ `trim` đã lưu, bề rộng từ ảnh — chỉ dhash do trình duyệt gửi. 409: mép đó
 * chưa cắt (`no_trim`), số px khác trim đã lưu (`trim_changed`), dải dưới `MIN_BAND_PX` (`band_too_small`), ảnh không có bề rộng (`no_hash`), dải gần trơn (`plain_image`), đầy danh sách.
 */
async function learnBand(
  sdb: Scoped,
  seriesId: string,
  body: z.infer<typeof BandBody>,
): Promise<{ learned: number; known: number }> {
  const f = await sdb.byId(sourceFiles, body.source_file_id, "source file");
  const chapter = await chapterInSeries(sdb, f.chapterId, seriesId, "source file");
  const bandHeight = f.trim?.[body.edge] ?? 0;
  if (bandHeight <= 0) throw conflict("no_trim", "Mép này của ảnh chưa được cắt — không học được dải.");
  if (bandHeight !== body.band_px) {
    throw conflict("trim_changed", "Số px cắt của mép này đã đổi — cắt lại rồi học lại.");
  }
  if (bandHeight < MIN_BAND_PX) {
    throw conflict("band_too_small", `Dải cắt dưới ${MIN_BAND_PX} px — quá mỏng để nhận lại.`);
  }
  if (!f.width) throw conflict("no_hash", "Ảnh này không có kích thước — không học được dải.");
  if (isPlainHash(body.dhash)) {
    throw conflict("plain_image", "Dải gần như trơn — không học được (dễ tự cắt nhầm trang truyện).");
  }
  const fp: ImageFingerprint = { dhash: body.dhash, width: f.width, height: bandHeight };
  const all = await sdb.select(seriesSkipImages, eq(seriesSkipImages.seriesId, seriesId));
  if (all.some((k) => k.edge === body.edge && sameImage(fp, k))) return { learned: 0, known: 1 };
  assertRoom(all.length, 1);
  await assertUploaded(f);
  await storeLearned(sdb, seriesId, chapter.id, f, fp, body.edge);
  return { learned: 1, known: 0 };
}

seriesSkipImageRoutes.get("/series/:seriesId/skip-images", async (c) => {
  const sdb = c.get("sdb");
  const s = await sdb.byId(series, c.req.param("seriesId"), "series");
  const rows = await sdb.select(seriesSkipImages, eq(seriesSkipImages.seriesId, s.id));
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return c.json({ images: await Promise.all(rows.map(skipImageView)) });
});

/** Bỏ ảnh khỏi danh sách: chương tạo sau không tự bỏ ảnh đó nữa (chương đã tạo giữ nguyên). */
seriesSkipImageRoutes.delete("/series/:seriesId/skip-images/:imageId", async (c) => {
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
