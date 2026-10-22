/**
 * Cô lập tenant cho MỌI route /api/w/:ws/*:
 *  (a) `:ws` của B, người gọi chỉ thuộc A → 403
 *  (b) `:ws` của A nhưng id tài nguyên thuộc B → 404
 * Phase sau thêm route → thêm case vào RESOURCE_CASES (chỉ append).
 */
import {
  chapters,
  glossaryEntries,
  jobs,
  NotFoundError,
  pageStates,
  pages,
  scoped,
  series,
  sourceFiles,
} from "@mtl/db";
import { emptyPageState, pageId } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { app, call, db, seedWorkspace } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;
let B: Seed;

/** Job mẫu của mỗi workspace (route /jobs/:jobId). */
const jobOf: Record<string, string> = {};
/** Entry glossary mẫu (route /glossary/:entryId) và source file của chương A (route presign). */
const entryOf: Record<string, string> = {};
/** Page mẫu (route editor /pages/:pageId). */
const pageOf: Record<string, string> = {};
/** Series + chương riêng cho route xoá (đối chứng "own" xoá thật, không đụng tài nguyên mẫu). */
const spareSeriesOf: Record<string, string> = {};
const spareChapterOf: Record<string, string> = {};
let sourceFileA = "";

beforeAll(async () => {
  [A, B] = await Promise.all([seedWorkspace("a"), seedWorkspace("b")]);
  for (const s of [A, B]) {
    const j = await scoped(db, s.workspaceId).insert(jobs, {
      type: "chapter.export",
      payload: {
        type: "chapter.export",
        chapter_id: s.chapterId,
        format: "cbz",
        layout: "pages",
        quality: 90,
        include_untranslated: true,
      },
      inputRev: "r",
      idempotencyKey: `tenant-${s.workspaceId}`,
      chapterId: s.chapterId,
    });
    jobOf[s.workspaceId] = j.id;
    const e = await scoped(db, s.workspaceId).insert(glossaryEntries, {
      sourceLang: "ko",
      targetLang: "vi",
      sourceTerm: "검",
      targetTerm: "kiếm",
    });
    entryOf[s.workspaceId] = e.id;
    const spare = await scoped(db, s.workspaceId).insert(series, { title: "Series dự phòng" });
    spareSeriesOf[s.workspaceId] = spare.id;
    spareChapterOf[s.workspaceId] = (
      await scoped(db, s.workspaceId).insert(chapters, { seriesId: s.seriesId, number: "99" })
    ).id;
    const pid = pageId(s.chapterId, 1, 0);
    await scoped(db, s.workspaceId).insert(pages, {
      id: pid,
      chapterId: s.chapterId,
      ord: 0,
      width: 100,
      height: 100,
      originalKey: `ws/${s.workspaceId}/ch/${s.chapterId}/ingest/1/0.png`,
      originalSha256: "ab".repeat(32),
    });
    await scoped(db, s.workspaceId).insert(pageStates, { pageId: pid, state: emptyPageState(100, 100) });
    pageOf[s.workspaceId] = pid;
  }
  const f = await scoped(db, A.workspaceId).insert(sourceFiles, {
    chapterId: A.chapterId,
    ord: 0,
    storageKey: `ws/${A.workspaceId}/ch/${A.chapterId}/src/tenant-fixture.png`,
    bytes: 100,
    mime: "image/png",
  });
  sourceFileA = f.id;
});

/** Body hợp lệ tối thiểu cho từng route (để 404 đến từ tra cứu id chứ không phải validate body). */
const BODIES: Record<string, unknown> = {
  "PATCH /api/w/:ws/settings": { worker_mode: "modal" },
  "POST /api/w/:ws/chapters/:chapterId/uploads": { filename: "001.png", content_type: "image/png", bytes: 1024 },
  "POST /api/w/:ws/series": { title: "Series mới" },
  "PATCH /api/w/:ws/series/:seriesId": { style_prompt: "ngắn gọn" },
  "POST /api/w/:ws/chapters": {
    series_id: "00000000-0000-7000-8000-000000000000",
    number: "2",
    files: [{ name: "001.png", content_type: "image/png", bytes: 1024 }],
  },
  get "POST /api/w/:ws/chapters/:chapterId/presign"() {
    return { file_ids: [sourceFileA] };
  },
  "POST /api/w/:ws/chapters/:chapterId/commit": {},
  "PATCH /api/w/:ws/chapters/:chapterId": { number: "99" },
  "POST /api/w/:ws/chapters/:chapterId/translate": {},
  "POST /api/w/:ws/glossary": { source_term: "마법", target_term: "ma pháp" },
  "POST /api/w/:ws/series/:seriesId/glossary": { source_term: "마법", target_term: "phép thuật" },
  "PATCH /api/w/:ws/glossary/:entryId": { note: "tên kiếm" },
  "POST /api/w/:ws/glossary/csv": { csv: "source_term,target_term\n용,rồng\n" },
  "POST /api/w/:ws/series/:seriesId/glossary/csv": { csv: "source_term,target_term\n용,long\n" },
  "PUT /api/w/:ws/pages/:pageId/state": { state: emptyPageState(100, 100) },
  "POST /api/w/:ws/pages/:pageId/ai-update/ack": { ai_rev: 0 },
  "POST /api/w/:ws/pages/:pageId/reinpaint": {
    user_mask_key: "ws/x/pg/x/user-mask/x.png",
    offset: [0, 0],
    base_clean_rev: 1,
  },
  "POST /api/w/:ws/pages/:pageId/ocr-region": { bbox: [0, 0, 10, 10] },
  "POST /api/w/:ws/chapters/:chapterId/export": { format: "cbz", layout: "pages" },
  "POST /api/w/:ws/chapters/:chapterId/find-replace/preview": { find: "chào", replace: "xin chào" },
  "POST /api/w/:ws/chapters/:chapterId/find-replace/apply": { find: "chào", replace: "xin chào", versions: {} },
  "POST /api/w/:ws/chapters/:chapterId/find-replace/undo": { batch_id: "00000000-0000-7000-8000-000000000000" },
  "POST /api/w/:ws/chapters/:chapterId/glossary-apply/preview": { rules: [{ source_term: "검", from: "kiếm" }] },
  "POST /api/w/:ws/chapters/:chapterId/glossary-apply/apply": {
    rules: [{ source_term: "검", from: "kiếm" }],
    versions: {},
  },
};

/** Route có id tài nguyên ngoài :ws → tham số trỏ vào tài nguyên của B. */
const RESOURCE_CASES: Record<string, (b: Seed) => Record<string, string>> = {
  "POST /api/w/:ws/chapters/:chapterId/uploads": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/invitations/:invitationId/link": (b) => ({ invitationId: b.invitationId }),
  "GET /api/w/:ws/chapters/:chapterId/progress": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/jobs/:jobId": (b) => ({ jobId: jobOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/jobs/:jobId/cancel": (b) => ({ jobId: jobOf[b.workspaceId] ?? "" }),
  "GET /api/w/:ws/series/:seriesId": (b) => ({ seriesId: b.seriesId }),
  "PATCH /api/w/:ws/series/:seriesId": (b) => ({ seriesId: b.seriesId }),
  "GET /api/w/:ws/chapters/:chapterId": (b) => ({ chapterId: b.chapterId }),
  "PATCH /api/w/:ws/chapters/:chapterId": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/chapters/:chapterId/pages": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/chapters/:chapterId/source-files": (b) => ({ chapterId: b.chapterId }),
  // presign trước commit: commit (own) loại source file giả (không có object) khỏi chương A.
  "POST /api/w/:ws/chapters/:chapterId/presign": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/commit": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/retry-failed": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/translate-prepared": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/translate": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/cancel": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/lock": (b) => ({ chapterId: b.chapterId }),
  "DELETE /api/w/:ws/chapters/:chapterId/lock": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/series/:seriesId/glossary": (b) => ({ seriesId: b.seriesId }),
  "POST /api/w/:ws/series/:seriesId/glossary": (b) => ({ seriesId: b.seriesId }),
  "GET /api/w/:ws/series/:seriesId/glossary/csv": (b) => ({ seriesId: b.seriesId }),
  "POST /api/w/:ws/series/:seriesId/glossary/csv": (b) => ({ seriesId: b.seriesId }),
  // PATCH trước DELETE: DELETE (own) xoá entry mẫu của A.
  "PATCH /api/w/:ws/glossary/:entryId": (b) => ({ entryId: entryOf[b.workspaceId] ?? "" }),
  "DELETE /api/w/:ws/glossary/:entryId": (b) => ({ entryId: entryOf[b.workspaceId] ?? "" }),
  "GET /api/w/:ws/pages/:pageId": (b) => ({ pageId: pageOf[b.workspaceId] ?? "" }),
  "PUT /api/w/:ws/pages/:pageId/state": (b) => ({ pageId: pageOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/pages/:pageId/ai-update/ack": (b) => ({ pageId: pageOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/pages/:pageId/mask-upload": (b) => ({ pageId: pageOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/pages/:pageId/reinpaint": (b) => ({ pageId: pageOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/pages/:pageId/ocr-region": (b) => ({ pageId: pageOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/chapters/:chapterId/export": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/chapters/:chapterId/exports": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/exports/:jobId": (b) => ({ jobId: jobOf[b.workspaceId] ?? "" }),
  "GET /api/w/:ws/exports/:jobId/download": (b) => ({ jobId: jobOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/chapters/:chapterId/find-replace/preview": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/find-replace/apply": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/find-replace/undo": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/glossary-apply/preview": (b) => ({ chapterId: b.chapterId }),
  "POST /api/w/:ws/chapters/:chapterId/glossary-apply/apply": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/chapters/:chapterId/states": (b) => ({ chapterId: b.chapterId }),
  "DELETE /api/w/:ws/chapters/:chapterId": (b) => ({ chapterId: spareChapterOf[b.workspaceId] ?? "" }),
  "DELETE /api/w/:ws/series/:seriesId": (b) => ({ seriesId: spareSeriesOf[b.workspaceId] ?? "" }),
};

/** Mọi (method, path) người dùng dưới /api/w/:ws — lấy từ router thật, không liệt kê tay. */
const workspaceRoutes = () => {
  const seen = new Set<string>();
  for (const r of app.routes) {
    if (r.method === "ALL" || !r.path.startsWith("/api/w/:ws")) continue;
    seen.add(`${r.method} ${r.path}`);
  }
  return [...seen].sort();
};

function fill(path: string, ws: string, params: Record<string, string>) {
  return path
    .replace(":ws", ws)
    .replace(/:(\w+)/g, (_, k: string) => params[k] ?? "00000000-0000-7000-8000-000000000000");
}

describe("tenant isolation", () => {
  it("discovers workspace routes", () => {
    expect(workspaceRoutes().length).toBeGreaterThan(0);
  });

  it("(a) caller from A cannot touch workspace B on any route → 403", async () => {
    for (const route of workspaceRoutes()) {
      const [method = "GET", path = ""] = route.split(" ");
      const params = RESOURCE_CASES[route]?.(B) ?? {};
      const res = await call(fill(path, B.workspaceId, params), { method, cookie: A.cookie, body: BODIES[route] });
      expect(res.status, route).toBe(403);
    }
  });

  it("(b) every route with a resource id has a cross-tenant case", () => {
    const withIds = workspaceRoutes().filter((r) => /:(?!ws\b)\w+/.test(r));
    expect(withIds.filter((r) => !RESOURCE_CASES[r])).toEqual([]);
  });

  it("(b) ws of A with a resource id of B → 404", async () => {
    for (const [route, params] of Object.entries(RESOURCE_CASES)) {
      const [method = "GET", path = ""] = route.split(" ");
      const res = await call(fill(path, A.workspaceId, params(B)), { method, cookie: A.cookie, body: BODIES[route] });
      expect(res.status, route).toBe(404);
      // Đối chứng: cùng route với tài nguyên của chính A thì không phải 404/403.
      const own = await call(fill(path, A.workspaceId, params(A)), { method, cookie: A.cookie, body: BODIES[route] });
      expect([403, 404], `${route} own`).not.toContain(own.status);
    }
  });

  it("rejects unauthenticated callers (401) and non-uuid workspace (404)", async () => {
    expect((await call(`/api/w/${A.workspaceId}`)).status).toBe(401);
    expect((await call("/api/w/not-a-uuid", { cookie: A.cookie })).status).toBe(404);
  });

  it("recent-chapters of A never lists chapters of B", async () => {
    const res = await call(`/api/w/${A.workspaceId}/recent-chapters?limit=100`, { cookie: A.cookie });
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { chapters: { id: string }[] }).chapters.map((c) => c.id);
    expect(ids).toContain(A.chapterId);
    expect(ids).not.toContain(B.chapterId);
  });
});

describe("scoped()", () => {
  it("byId never returns another workspace's row", async () => {
    const sA = scoped(db, A.workspaceId);
    await expect(sA.byId(chapters, B.chapterId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sA.byId(chapters, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    expect((await sA.byId(chapters, A.chapterId)).id).toBe(A.chapterId);
  });

  it("countBy only counts rows of its workspace", async () => {
    const groups = await scoped(db, A.workspaceId).countBy(pages, { chapterId: pages.chapterId });
    expect(groups).toContainEqual({ chapterId: A.chapterId, n: 1 });
    expect(groups.map((g) => g.chapterId)).not.toContain(B.chapterId);
  });

  it("update/delete of another workspace's id affect nothing", async () => {
    const sA = scoped(db, A.workspaceId);
    expect(await sA.update(series, eq(series.id, B.seriesId), { title: "hacked" })).toEqual([]);
    expect(await sA.delete(series, eq(series.id, B.seriesId))).toEqual([]);
    const [still] = await db.select().from(series).where(eq(series.id, B.seriesId));
    expect(still?.title).toBe("Series b");
  });

  it("insert/update force workspace_id of the scope", async () => {
    const sA = scoped(db, A.workspaceId);
    const s = await sA.insert(series, { title: "x", workspaceId: B.workspaceId } as never);
    expect(s.workspaceId).toBe(A.workspaceId);
    const [u] = await sA.update(series, eq(series.id, s.id), { title: "y", workspaceId: B.workspaceId } as never);
    expect(u?.workspaceId).toBe(A.workspaceId);
  });

  it("composite FK blocks a child row pointing at a parent of another workspace", async () => {
    const sA = scoped(db, A.workspaceId);
    await expect(sA.insert(chapters, { seriesId: B.seriesId, number: "2" })).rejects.toThrow();
  });
});
