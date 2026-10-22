/**
 * Danh sách page của chương cho lưới thumbnail: ảnh sạch rev hiện tại khi có, fallback ảnh gốc sau ingest.
 * `images` = cả ảnh gốc lẫn ảnh sạch (canvas màn chương vẽ từng page, so sánh gốc/dịch); `image` giữ cho client cũ.
 * URL là presigned GET TTL ngắn trên FILES_DOMAIN (bucket private) — tách khỏi /progress để polling 2–3s
 * không ký lại URL mỗi lượt.
 */
import { chapters, pages, scoped, sourceFiles } from "@mtl/db";
import { storageKeys } from "@mtl/shared";
import { and, eq, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { inJobTx, lockChapter, refreshChapter } from "../jobs/enqueue.ts";
import { assertChapterLock } from "../lib/chapter-lock.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { MAX_GET_TTL_S, presignGet } from "../storage.ts";

const THUMB_TTL_S = MAX_GET_TTL_S;
const PageSkipBody = z.object({ skipped: z.boolean() });

const conflict = (error: string, message: string) =>
  new HTTPException(409, { res: Response.json({ error, message }, { status: 409 }) });

export const pageRoutes = new Hono<AppEnv>();

pageRoutes.get("/w/:ws/chapters/:chapterId/pages", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ws = c.get("workspaceId");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const rows = await sdb.select(pages, eq(pages.chapterId, ch.id));
  rows.sort((a, b) => a.ord - b.ord);
  const expiresAt = new Date(Date.now() + THUMB_TTL_S * 1000);
  return c.json({
    expires_at: expiresAt,
    pages: await Promise.all(
      rows.map(async (p) => {
        const [original, clean] = await Promise.all([
          presignGet(p.originalKey, THUMB_TTL_S),
          p.cleanRev !== null ? presignGet(storageKeys.clean(ws, p.id, p.cleanRev), THUMB_TTL_S) : null,
        ]);
        return {
          id: p.id,
          ord: p.ord,
          width: p.width,
          height: p.height,
          status: p.status,
          clean_rev: p.cleanRev,
          cut_flag: p.cutFlag,
          image: { kind: clean !== null ? "clean" : "original", url: clean ?? original },
          images: { original, clean },
        };
      }),
    ),
  });
});

/**
 * Ảnh gốc đã khai báo của chương theo thứ tự upload — xem trước khi chưa có page (nháp, đang cắt trang). Không HEAD
 * từng object: file chưa upload xong thì URL trả 404, client hiện ô "chưa tải".
 */
pageRoutes.get("/w/:ws/chapters/:chapterId/source-files", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const rows = await sdb.select(sourceFiles, eq(sourceFiles.chapterId, ch.id));
  rows.sort((a, b) => a.ord - b.ord);
  return c.json({
    expires_at: new Date(Date.now() + THUMB_TTL_S * 1000),
    files: await Promise.all(
      rows.map(async (f) => ({
        id: f.id,
        ord: f.ord,
        skip: f.skip,
        /** Trình duyệt đo lúc thả ảnh (null = không đo được) — rail gợi ý ảnh lệch khổ có thể là credit. */
        width: f.width,
        url: await presignGet(f.storageKey, THUMB_TTL_S),
      })),
    ),
  });
});

/**
 * Xoá (ẩn) / khôi phục 1 trang sau Bước 1/2 — không tốn job. Cần giữ khoá chương; chương đang cắt trang / chạy AI →
 * 409. Không cho ẩn trang cuối cùng còn hiện (chương rỗng không có trạng thái hợp lý). Trạng thái chương tính lại ngay
 * (ẩn trang lỗi cuối → "Chờ duyệt"; khôi phục trang chưa dịch → "Chờ dịch").
 */
pageRoutes.patch("/w/:ws/pages/:pageId", requireWorkspace(), async (c) => {
  const body = await parseJson(c, PageSkipBody);
  const sdb = c.get("sdb");
  const ws = c.get("workspaceId");
  const page = await sdb.byId(pages, c.req.param("pageId"), "page");
  await assertChapterLock(sdb, page.chapterId, c.get("user").id);
  const row = await inJobTx(async (tx) => {
    const ch = await lockChapter(tx, ws, page.chapterId);
    if (ch.status === "ingesting" || ch.status === "processing") {
      throw conflict("chapter_busy", "chương đang xử lý — chờ xong rồi xoá / khôi phục trang");
    }
    const t = scoped(tx, ws);
    if (body.skipped) {
      const visible = await t.select(pages, and(eq(pages.chapterId, ch.id), eq(pages.skipped, false)) as SQL);
      if (visible.every((p) => p.id === page.id)) throw conflict("last_page", "không xoá được trang cuối cùng");
    }
    const [r] = await t.update(pages, eq(pages.id, page.id), { skipped: body.skipped });
    await refreshChapter(tx, ws, ch.id);
    return r;
  });
  return c.json({ id: page.id, skipped: row?.skipped ?? body.skipped });
});
