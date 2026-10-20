/**
 * Editor (Phase 5): đọc/ghi `page_states` của 1 page + thao tác ảnh (mask người vẽ → reinpaint, OCR vùng chọn).
 *
 * Ghi state = optimistic version: client gửi `If-Match: <version>` đã đọc; khác version hiện tại → 409 kèm
 * version mới (client tự tải lại + rebase patch chưa lưu, không có "ghi đè"). Người ghi phải giữ khoá chương
 * (423 nếu không). Mỗi lần ghi đẩy bản cũ vào `page_state_history` (giữ 50 bản mới nhất/page).
 * `ai_update_available` giữ nguyên khi người sửa lưu — chỉ tắt bằng ack sau khi đã xem kết quả AI mới.
 */
import { chapters, pageStateHistory, pageStates, pages, type Scoped } from "@mtl/db";
import { BBox, PageState, storageKeys } from "@mtl/shared";
import { and, eq, inArray, lt, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { enqueueOcrRegion, enqueueReinpaint, inJobTx } from "../jobs/enqueue.ts";
import { HISTORY_KEEP } from "../jobs/page-state-writer.ts";
import { assertChapterLock } from "../lib/chapter-lock.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { head, MAX_GET_TTL_S, presignGet, presignPost, readPrefix } from "../storage.ts";
import { jobView } from "./jobs.ts";

/** Mask người vẽ: PNG ≤ 5MB (vùng cắt theo nét vẽ, không phải cả page). */
export const MAX_USER_MASK_BYTES = 5 * 1024 * 1024;
const MASK_POST_TTL_S = 5 * 60;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const PutStateBody = z.object({ state: PageState });
const AckBody = z.object({ ai_rev: z.number().int().nonnegative() });
const ReinpaintBody = z.object({
  user_mask_key: z.string().min(1).max(512),
  offset: z.tuple([z.number().int(), z.number().int()]),
  base_clean_rev: z.number().int().nonnegative(),
});
const OcrRegionBody = z.object({ bbox: BBox });

const httpError = (status: 409 | 412 | 428 | 400, body: Record<string, unknown>) =>
  new HTTPException(status, { res: Response.json(body, { status }) });

async function stateOf(sdb: Scoped, pageId: string) {
  const st = await sdb.find(pageStates, eq(pageStates.pageId, pageId));
  if (!st) throw new HTTPException(404, { message: "page state not found" });
  return st;
}

/** `If-Match: 12` hoặc `"12"` (ETag) → 12; thiếu → 428, sai dạng → 400. */
function ifMatchVersion(header: string | undefined): number {
  if (header === undefined) throw httpError(428, { error: "if_match_required" });
  const m = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(header);
  if (!m) throw httpError(400, { error: "invalid_if_match" });
  return Number(m[1]);
}

/** Giữ HISTORY_KEEP bản mới nhất của page (cùng luật với page-state-writer, qua scoped). */
export async function pruneHistory(tx: Scoped, pageId: string) {
  const rows = await tx.select(pageStateHistory, eq(pageStateHistory.pageId, pageId));
  if (rows.length <= HISTORY_KEEP) return;
  const edge = rows.map((r) => r.version).sort((a, b) => b - a)[HISTORY_KEEP - 1];
  if (edge === undefined) return;
  await tx.delete(
    pageStateHistory,
    and(eq(pageStateHistory.pageId, pageId), lt(pageStateHistory.version, edge)) as SQL,
  );
}

export const pageStateRoutes = new Hono<AppEnv>();

/** State + ai_state + ảnh (presigned GET TTL ngắn) cho editor. */
pageStateRoutes.get("/w/:ws/pages/:pageId", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ws = c.get("workspaceId");
  const page = await sdb.byId(pages, c.req.param("pageId"), "page");
  const st = await stateOf(sdb, page.id);
  const ttl = MAX_GET_TTL_S;
  const [original, clean] = await Promise.all([
    presignGet(page.originalKey, ttl),
    page.cleanRev !== null ? presignGet(storageKeys.clean(ws, page.id, page.cleanRev), ttl) : null,
  ]);
  c.header("ETag", `"${st.version}"`);
  return c.json({
    page: {
      id: page.id,
      chapter_id: page.chapterId,
      ord: page.ord,
      width: page.width,
      height: page.height,
      status: page.status,
      clean_rev: page.cleanRev,
    },
    version: st.version,
    state: st.state,
    state_origin: st.stateOrigin,
    ai_state: st.aiState,
    ai_rev: st.aiRev,
    ai_update_available: st.aiUpdateAvailable,
    images: { original, clean },
    expires_at: new Date(Date.now() + ttl * 1000),
  });
});

/**
 * State mọi page của chương (màn chương vẽ cả strip): theo `ord`, KHÔNG kèm `ai_state` (lấy theo page khi cần).
 * 2 truy vấn: pages của chương rồi page_states theo danh sách id.
 */
pageStateRoutes.get("/w/:ws/chapters/:chapterId/states", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const rows = await sdb.select(pages, eq(pages.chapterId, ch.id));
  rows.sort((a, b) => a.ord - b.ord);
  const states = rows.length
    ? await sdb.select(
        pageStates,
        inArray(
          pageStates.pageId,
          rows.map((p) => p.id),
        ),
      )
    : [];
  const byPage = new Map(states.map((s) => [s.pageId, s]));
  return c.json({
    pages: rows.flatMap((p) => {
      const st = byPage.get(p.id);
      return st
        ? [
            {
              page_id: p.id,
              ord: p.ord,
              version: st.version,
              state: st.state,
              state_origin: st.stateOrigin,
              ai_rev: st.aiRev,
              ai_update_available: st.aiUpdateAvailable,
            },
          ]
        : [];
    }),
  });
});

/**
 * Ghi state của người sửa. Điều kiện version nằm trong WHERE của UPDATE → hai lần ghi đua nhau (hoặc job AI ghi
 * giữa chừng, cũng +1 version) thì đúng một bên thắng, bên kia nhận 409.
 */
pageStateRoutes.put("/w/:ws/pages/:pageId/state", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const user = c.get("user");
  const page = await sdb.byId(pages, c.req.param("pageId"), "page");
  const expected = ifMatchVersion(c.req.header("if-match"));
  const body = await parseJson(c, PutStateBody);
  await assertChapterLock(sdb, page.chapterId, user.id);
  if (body.state.size.w !== page.width || body.state.size.h !== page.height) {
    throw httpError(400, { error: "size_mismatch", message: "state.size khác kích thước page" });
  }
  const version = await sdb.transaction(async (tx) => {
    const cur = await stateOf(tx, page.id);
    if (cur.version !== expected) throw httpError(409, { error: "version_conflict", version: cur.version });
    const [row] = await tx.update(
      pageStates,
      and(eq(pageStates.pageId, page.id), eq(pageStates.version, expected)) as SQL,
      { state: body.state, version: expected + 1, stateOrigin: "user", updatedBy: `user:${user.id}` },
    );
    if (!row) throw httpError(409, { error: "version_conflict", version: (await stateOf(tx, page.id)).version });
    await tx.insert(pageStateHistory, {
      pageId: page.id,
      version: cur.version,
      state: cur.state,
      actor: `user:${user.id}`,
    });
    await pruneHistory(tx, page.id);
    return row.version;
  });
  c.header("ETag", `"${version}"`);
  return c.json({ version });
});

/** Đã xem kết quả AI mới → tắt cờ. Chỉ tắt khi đúng ai_rev đã xem (AI ghi bản mới hơn giữa chừng thì cờ giữ nguyên). */
pageStateRoutes.post("/w/:ws/pages/:pageId/ai-update/ack", requireWorkspace(), async (c) => {
  const body = await parseJson(c, AckBody);
  const sdb = c.get("sdb");
  const page = await sdb.byId(pages, c.req.param("pageId"), "page");
  const rows = await sdb.update(
    pageStates,
    and(eq(pageStates.pageId, page.id), eq(pageStates.aiRev, body.ai_rev)) as SQL,
    { aiUpdateAvailable: false },
  );
  const st = rows[0] ?? (await stateOf(sdb, page.id));
  return c.json({ ai_rev: st.aiRev, ai_update_available: st.aiUpdateAvailable });
});

/** Presigned POST cho mask người vẽ (PNG, ≤ 5MB); key bất biến `user-mask/{uuid}.png` của page. */
pageStateRoutes.post("/w/:ws/pages/:pageId/mask-upload", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const page = await sdb.byId(pages, c.req.param("pageId"), "page");
  const key = storageKeys.userMask(c.get("workspaceId"), page.id, uuidv7());
  const post = await presignPost(key, "image/png", MAX_USER_MASK_BYTES, MASK_POST_TTL_S);
  return c.json({ key, url: post.url, fields: post.fields, expires_at: post.expiresAt }, 201);
});

/**
 * Re-inpaint theo mask đã upload. Cần khoá chương; `base_clean_rev` phải là rev ảnh sạch hiện tại (người khác
 * vừa reinpaint → 409, tránh dựng trên ảnh cũ). Mask phải tồn tại, là PNG, ≤ 5MB.
 */
pageStateRoutes.post("/w/:ws/pages/:pageId/reinpaint", requireWorkspace(), async (c) => {
  const body = await parseJson(c, ReinpaintBody);
  const sdb = c.get("sdb");
  const ws = c.get("workspaceId");
  const page = await sdb.byId(pages, c.req.param("pageId"), "page");
  await assertChapterLock(sdb, page.chapterId, c.get("user").id);
  if (page.cleanRev === null) throw httpError(409, { error: "page_not_prepared" });
  if (page.cleanRev !== body.base_clean_rev) {
    throw httpError(409, { error: "clean_rev_changed", clean_rev: page.cleanRev });
  }
  if (!body.user_mask_key.startsWith(`ws/${ws}/pg/${page.id}/user-mask/`) || body.user_mask_key.includes("..")) {
    throw httpError(400, { error: "invalid_mask_key" });
  }
  const h = await head(body.user_mask_key);
  if (!h) throw httpError(400, { error: "mask_missing" });
  const prefix = await readPrefix(body.user_mask_key, PNG_MAGIC.length);
  if (h.bytes > MAX_USER_MASK_BYTES || !PNG_MAGIC.every((b, i) => prefix[i] === b)) {
    throw httpError(400, { error: "invalid_mask" });
  }
  const [x, y] = body.offset;
  const { job, created } = await inJobTx((tx) =>
    enqueueReinpaint(tx, ws, {
      type: "page.reinpaint",
      page_id: page.id,
      base_clean_rev: body.base_clean_rev,
      user_mask_key: body.user_mask_key,
      offset: { x, y },
    }),
  );
  return c.json({ job: jobView(job), created }, 202);
});

/** OCR + dịch 1 vùng người kéo; editor poll `/jobs/:id` rồi tự chèn region (không ghi state ở server). */
pageStateRoutes.post("/w/:ws/pages/:pageId/ocr-region", requireWorkspace(), async (c) => {
  const body = await parseJson(c, OcrRegionBody);
  const sdb = c.get("sdb");
  const page = await sdb.byId(pages, c.req.param("pageId"), "page");
  const [x, y, w, h] = body.bbox;
  if (w < 4 || h < 4 || x < 0 || y < 0 || x + w > page.width || y + h > page.height) {
    throw httpError(400, { error: "bbox_out_of_page" });
  }
  const { job, created } = await inJobTx((tx) =>
    enqueueOcrRegion(tx, c.get("workspaceId"), { type: "page.ocr_region", page_id: page.id, bbox: body.bbox }),
  );
  return c.json({ job: jobView(job), created }, 202);
});
