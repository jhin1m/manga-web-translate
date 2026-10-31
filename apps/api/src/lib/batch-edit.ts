/**
 * Lõi sửa hàng loạt page state của một chương, dùng chung cho find/replace, áp glossary và ẩn chữ bỏ qua.
 *
 * Mỗi phép sửa là một `PageTransform` thuần (state → state mới + danh sách khớp). Luồng: preview (không ghi) → danh
 * sách khớp + `versions` của page bị ảnh hưởng; apply gửi lại `versions`, chạy 1 transaction: mỗi page ghi bản cũ vào
 * `page_state_history` với chung `batch_id`, version +1; page đổi sau preview → 409 `preview_stale`. Hoàn tác = khôi
 * phục theo `batch_id`, chỉ page chưa bị sửa tiếp (version hiện tại = version lúc áp + 1, hoặc nội dung hiện tại vẫn bằng nội dung lượt đã ghi — VD hoàn tác lượt sau trước lượt này).
 *
 * Lõi không kiểm khoá chương — nơi gọi tự đảm bảo (route: `assertChapterLock`; áp theo series: lấy khoá từng chương).
 */

import { isDeepStrictEqual } from "node:util";
import { pageStateHistory, pageStates, pages, type Scoped } from "@mtl/db";
import type { PageState } from "@mtl/shared";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { pruneHistory } from "../routes/page-state.ts";

/** Trần danh sách khớp trả về (tổng `total` vẫn đếm đủ). */
export const MAX_PREVIEW_MATCHES = 1000;

export type PageRow = { id: string; ord: number; version: number; state: PageState };

/** Phép sửa thuần lên 1 page; `matches` rỗng = không đổi gì. `count` = số chỗ đổi của khớp đó. */
export type PageTransform<M extends { count: number }> = (state: PageState) => { state: PageState; matches: M[] };

export const httpError = (status: 404 | 409 | 410, body: Record<string, unknown>) =>
  new HTTPException(status, { res: Response.json(body, { status }) });

export async function chapterPages(sdb: Scoped, chapterId: string): Promise<PageRow[]> {
  // Trang ẩn không bị tìm / thay / áp glossary.
  const ps = await sdb.select(pages, and(eq(pages.chapterId, chapterId), eq(pages.skipped, false)) as SQL);
  if (ps.length === 0) return [];
  const ord = new Map(ps.map((p) => [p.id, p.ord]));
  const states = await sdb.select(
    pageStates,
    inArray(
      pageStates.pageId,
      ps.map((p) => p.id),
    ),
  );
  return states
    .filter((s): s is typeof s & { state: PageState } => s.state !== null)
    .map((s) => ({ id: s.pageId, ord: ord.get(s.pageId) ?? 0, version: s.version, state: s.state }))
    .sort((a, b) => a.ord - b.ord);
}

export function previewPages<M extends { count: number }>(rows: PageRow[], transform: PageTransform<M>) {
  const matches: (M & { page_id: string; ord: number })[] = [];
  const versions: Record<string, number> = {};
  for (const p of rows) {
    const r = transform(p.state);
    if (!r.matches.length) continue;
    versions[p.id] = p.version;
    for (const m of r.matches) matches.push({ ...m, page_id: p.id, ord: p.ord });
  }
  const total = matches.reduce((n, m) => n + m.count, 0);
  return {
    matches: matches.slice(0, MAX_PREVIEW_MATCHES),
    total,
    truncated: matches.length > MAX_PREVIEW_MATCHES,
    versions,
  };
}

/** Ghi các page có khớp trong 1 transaction; page đổi so với preview (hoặc khớp mới xuất hiện) → 409. */
export async function applyBatch<M extends { count: number }>(
  sdb: Scoped,
  chapterId: string,
  userId: string,
  transform: PageTransform<M>,
  versions: Record<string, number>,
  batchId = uuidv7(),
  /** Nhãn loại thao tác ghi vào `actor` của lịch sử (vd để chỉ hoàn tác đúng loại batch). */
  tag?: string,
) {
  return sdb.transaction(async (tx) => {
    const rows = await chapterPages(tx, chapterId);
    const results = rows.map((p) => ({ p, r: transform(p.state) })).filter((x) => x.r.matches.length);
    // Stale: page có khớp mà khác bản đã xem, hoặc page đã xem (có trong `versions`) đổi version — kể cả khi giờ hết
    // khớp (VD bấm áp dụng lần 2 với bản xem trước cũ: không được thành batch rỗng thay cho batch vừa áp).
    const matched = new Set(results.map(({ p }) => p.id));
    const stale = rows
      .filter((p) => (matched.has(p.id) || p.id in versions) && versions[p.id] !== p.version)
      .map((p) => p.id);
    if (stale.length) throw httpError(409, { error: "preview_stale", pages: stale });
    let changed = 0;
    const newVersions: Record<string, number> = {};
    for (const { p, r } of results) {
      const [row] = await tx.update(
        pageStates,
        and(eq(pageStates.pageId, p.id), eq(pageStates.version, p.version)) as SQL,
        { state: r.state, version: p.version + 1, stateOrigin: "user", updatedBy: `user:${userId}` },
      );
      if (!row) throw httpError(409, { error: "preview_stale", pages: [p.id] });
      await tx.insert(pageStateHistory, {
        pageId: p.id,
        version: p.version,
        state: p.state,
        actor: tag ? `user:${userId}#${tag}` : `user:${userId}`,
        batchId,
      });
      await pruneHistory(tx, p.id);
      changed += r.matches.reduce((n, m) => n + m.count, 0);
      newVersions[p.id] = p.version + 1;
    }
    // `versions` = version mới của từng page đã ghi (client biết page đang mở có trong lượt không và bản nạp lại nào là của lượt).
    return { batch_id: batchId, pages: results.length, changed, versions: newVersions };
  });
}

/** Bản ghi lịch sử của batch thuộc các page của 1 chương (không đọc batch của chương khác). */
export async function chapterBatchHistory(sdb: Scoped, chapterId: string, batchId: string) {
  const own = (await sdb.select(pages, eq(pages.chapterId, chapterId))).map((p) => p.id);
  if (own.length === 0) return [];
  return sdb.select(
    pageStateHistory,
    and(eq(pageStateHistory.batchId, batchId), inArray(pageStateHistory.pageId, own)) as SQL,
  );
}

/**
 * Khôi phục state trước batch trong 1 chương. `conflicts`: "fail" = page đã bị sửa tiếp (hoặc đã hoàn tác) → 409,
 * không ghi gì; "skip" = bỏ qua các page đó, khôi phục phần còn lại và trả danh sách `skipped`.
 * `found` = false khi chương không có bản ghi nào của batch.
 */
export async function undoBatch(
  sdb: Scoped,
  chapterId: string,
  userId: string,
  batchId: string,
  conflicts: "fail" | "skip",
) {
  return sdb.transaction(async (tx) => {
    const hist = await chapterBatchHistory(tx, chapterId, batchId);
    if (hist.length === 0) return { found: false, restored: 0, skipped: [] as string[] };
    const cur = new Map(
      (
        await tx.select(
          pageStates,
          inArray(
            pageStates.pageId,
            hist.map((h) => h.pageId),
          ),
        )
      ).map((s) => [s.pageId, s]),
    );
    // Page "đã sửa tiếp" khi nội dung hiện tại khác nội dung lượt đã ghi (state ở version h.version+1). Version tăng mà nội
    // dung không đổi (VD hoàn tác lượt sau rồi mới hoàn tác lượt này, hay sửa rồi Cmd+Z đúng sửa đó) vẫn khôi phục được.
    const moved = hist.filter((h) => cur.get(h.pageId)?.version !== h.version + 1);
    // Chỉ lấy đúng các bản ghi (page, version h.version+1) cần so — không đọc cả lịch sử (tới 50 state/page).
    const wrote = new Map(
      (moved.length
        ? await tx.select(
            pageStateHistory,
            and(
              inArray(
                pageStateHistory.pageId,
                moved.map((h) => h.pageId),
              ),
              inArray(
                pageStateHistory.version,
                moved.map((h) => h.version + 1),
              ),
            ) as SQL,
          )
        : []
      ).map((w) => [`${w.pageId}:${w.version}`, w.state]),
    );
    const unchanged = (h: (typeof hist)[number]) => {
      const now = cur.get(h.pageId);
      if (!now) return false;
      if (now.version === h.version + 1) return true;
      const written = wrote.get(`${h.pageId}:${h.version + 1}`);
      return !!written && isDeepStrictEqual(written, now.state);
    };
    const changedSince = hist.filter((h) => !unchanged(h)).map((h) => h.pageId);
    if (changedSince.length && conflicts === "fail")
      throw httpError(409, { error: "undo_conflict", pages: changedSince });
    const skip = new Set(changedSince);
    let restored = 0;
    for (const h of hist) {
      const now = cur.get(h.pageId);
      if (!now || skip.has(h.pageId)) continue;
      const [row] = await tx.update(
        pageStates,
        and(eq(pageStates.pageId, h.pageId), eq(pageStates.version, now.version)) as SQL,
        { state: h.state, version: now.version + 1, stateOrigin: "user", updatedBy: `user:${userId}` },
      );
      if (!row) throw httpError(409, { error: "undo_conflict", pages: [h.pageId] });
      await tx.insert(pageStateHistory, {
        pageId: h.pageId,
        version: now.version,
        state: now.state,
        actor: `user:${userId}`,
      });
      await pruneHistory(tx, h.pageId);
      restored++;
    }
    return { found: true, restored, skipped: changedSince };
  });
}
