/**
 * Cô lập dữ liệu người dùng cho MỌI route người dùng dưới /api (trừ /api/auth, /api/dev) — lấy từ router thật:
 *  (a) không đăng nhập → 401
 *  (b) A gọi với id tài nguyên của B → 404 (đối chứng: id của chính A thì không 404/403)
 * Thêm route có id → thêm case vào RESOURCE_CASES (meta-test bắt thiếu).
 */
import {
  chapters,
  glossaryEntries,
  jobs,
  NotFoundError,
  pageStates,
  pages,
  proofreadSuggestions,
  scoped,
  series,
  seriesSkipImages,
  sourceFiles,
  userFonts,
} from "@mtl/db";
import { DEFAULT_PIPELINE_SETTINGS, emptyPageState, pageId } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { app, call, db, seedUser } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let A: Seed;
let B: Seed;

/** Job mẫu của mỗi người dùng (route /jobs/:jobId). */
const jobOf: Record<string, string> = {};
/** Entry glossary mẫu (route /glossary/:entryId) và source file của chương A (route presign). */
const entryOf: Record<string, string> = {};
/** Page mẫu (route editor /pages/:pageId). */
const pageOf: Record<string, string> = {};
/** Series + chương riêng cho route xoá (đối chứng "own" xoá thật, không đụng tài nguyên mẫu). */
const spareSeriesOf: Record<string, string> = {};
const spareChapterOf: Record<string, string> = {};
/** Ảnh gốc của chương dự phòng (route bỏ qua ảnh; chương nháp chưa có page). */
const spareSourceOf: Record<string, string> = {};
let sourceFileA = "";
/** Ảnh credit đã học của series mẫu (route skip-images). */
const skipImageOf: Record<string, string> = {};
/** Font tuỳ chỉnh mẫu (route DELETE /fonts/:fontId) — id dạng custom-<8 hex>. */
const fontOf: Record<string, string> = {};
/** Gợi ý hiệu đính mẫu (route PATCH /proofread-suggestions/:id). */
const suggestionOf: Record<string, string> = {};

beforeAll(async () => {
  [A, B] = await Promise.all([seedUser("a"), seedUser("b")]);
  for (const s of [A, B]) {
    const j = await scoped(db, s.userId).insert(jobs, {
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
      idempotencyKey: `tenant-${s.userId}`,
      chapterId: s.chapterId,
    });
    jobOf[s.userId] = j.id;
    const e = await scoped(db, s.userId).insert(glossaryEntries, {
      sourceLang: "ko",
      targetLang: "vi",
      sourceTerm: "검",
      targetTerm: "kiếm",
    });
    entryOf[s.userId] = e.id;
    const spare = await scoped(db, s.userId).insert(series, { title: "Series dự phòng" });
    spareSeriesOf[s.userId] = spare.id;
    spareChapterOf[s.userId] = (await scoped(db, s.userId).insert(chapters, { seriesId: s.seriesId, number: "99" })).id;
    spareSourceOf[s.userId] = (
      await scoped(db, s.userId).insert(sourceFiles, {
        chapterId: spareChapterOf[s.userId] ?? "",
        ord: 0,
        storageKey: `u/${s.userId}/ch/${spareChapterOf[s.userId]}/src/tenant-spare.png`,
        bytes: 100,
        mime: "image/png",
      })
    ).id;
    const pid = pageId(s.chapterId, 1, 0);
    await scoped(db, s.userId).insert(pages, {
      id: pid,
      chapterId: s.chapterId,
      ord: 0,
      width: 100,
      height: 100,
      originalKey: `u/${s.userId}/ch/${s.chapterId}/ingest/1/0.png`,
      originalSha256: "ab".repeat(32),
    });
    await scoped(db, s.userId).insert(pageStates, { pageId: pid, state: emptyPageState(100, 100) });
    pageOf[s.userId] = pid;
    suggestionOf[s.userId] = (
      await scoped(db, s.userId).insert(proofreadSuggestions, {
        chapterId: s.chapterId,
        pageId: pid,
        regionId: "r0",
        oldText: "cũ",
        suggestion: "mới",
      })
    ).id;
    skipImageOf[s.userId] = (
      await scoped(db, s.userId).insert(seriesSkipImages, {
        seriesId: s.seriesId,
        dhash: "0f0f0f0f0f0f0f0f",
        width: 800,
        height: 1200,
        thumbKey: `u/${s.userId}/series/${s.seriesId}/skip/tenant.png`,
      })
    ).id;
    const fontId = `custom-${s.userId.slice(-8)}`;
    await scoped(db, s.userId).insert(userFonts, {
      fontId,
      name: "Font mẫu",
      fileKey: `u/${s.userId}/fonts/tenant-fixture`,
      sha256: s.userId.replaceAll("-", "").padEnd(64, "0"),
      bytes: 1,
      unitsPerEm: 1000,
      ascent: 900,
      descent: 200,
      metricsSource: "hhea",
      viComplete: true,
      missing: [],
    });
    fontOf[s.userId] = fontId;
  }
  const f = await scoped(db, A.userId).insert(sourceFiles, {
    chapterId: A.chapterId,
    ord: 0,
    storageKey: `u/${A.userId}/ch/${A.chapterId}/src/tenant-fixture.png`,
    bytes: 100,
    mime: "image/png",
  });
  sourceFileA = f.id;
});

/** Body hợp lệ tối thiểu cho từng route (để 404 đến từ tra cứu id chứ không phải validate body). */
const BODIES: Record<string, unknown> = {
  "PUT /api/settings/pipeline": { pipeline: DEFAULT_PIPELINE_SETTINGS },
  "POST /api/chapters/:chapterId/uploads": { filename: "001.png", content_type: "image/png", bytes: 1024 },
  "POST /api/series": { title: "Series mới" },
  "PATCH /api/series/:seriesId": { style_prompt: "ngắn gọn" },
  "POST /api/chapters": {
    series_id: "00000000-0000-7000-8000-000000000000",
    number: "2",
    files: [{ name: "001.png", content_type: "image/png", bytes: 1024 }],
  },
  get "POST /api/chapters/:chapterId/presign"() {
    return { file_ids: [sourceFileA] };
  },
  "POST /api/chapters/:chapterId/commit": {},
  "PATCH /api/chapters/:chapterId": { number: "99" },
  "POST /api/chapters/:chapterId/translate": {},
  "PATCH /api/chapters/:chapterId/source-files/:fileId": { skip: "user" },
  get "PUT /api/chapters/:chapterId/source-files/order"() {
    return { ids: [spareSourceOf[A.userId]] };
  },
  // Ảnh dự phòng của A không có hash → own trả 409 no_hash (qua được tra series + ảnh).
  get "POST /api/series/:seriesId/skip-images"() {
    return { source_file_id: spareSourceOf[A.userId] };
  },
  "POST /api/fonts/upload-url": { bytes: 1024 },
  "POST /api/fonts": { key: "u/x/fonts/x" },
  "POST /api/glossary": { source_term: "마법", target_term: "ma pháp" },
  "POST /api/series/:seriesId/glossary": { source_term: "마법", target_term: "phép thuật" },
  "PATCH /api/glossary/:entryId": { note: "tên kiếm" },
  "POST /api/glossary/csv": { csv: "source_term,target_term\n용,rồng\n" },
  "POST /api/series/:seriesId/glossary/csv": { csv: "source_term,target_term\n용,long\n" },
  "PUT /api/pages/:pageId/state": { state: emptyPageState(100, 100) },
  get "PUT /api/chapters/:chapterId/states"() {
    return { pages: [{ page_id: pageOf[A.userId], version: 0, state: emptyPageState(100, 100) }] };
  },
  "PATCH /api/pages/:pageId": { skipped: false },
  "POST /api/pages/:pageId/ai-update/ack": { ai_rev: 0 },
  "POST /api/pages/:pageId/reinpaint": {
    user_mask_key: "u/x/pg/x/user-mask/x.png",
    offset: [0, 0],
    base_clean_rev: 1,
  },
  "POST /api/pages/:pageId/ocr-region": { bbox: [0, 0, 10, 10] },
  "PATCH /api/proofread-suggestions/:suggestionId": { dismissed: true },
  "POST /api/chapters/:chapterId/export": { format: "cbz", layout: "pages" },
  "POST /api/series/:seriesId/ignore-apply/preview": {},
  "POST /api/series/:seriesId/ignore-apply/apply": { versions: {} },
  "POST /api/series/:seriesId/ignore-apply/undo": { batch_id: "00000000-0000-7000-8000-000000000000" },
  "POST /api/chapters/:chapterId/find-replace/preview": { find: "chào", replace: "xin chào" },
  "POST /api/chapters/:chapterId/find-replace/apply": { find: "chào", replace: "xin chào", versions: {} },
  "POST /api/chapters/:chapterId/find-replace/undo": { batch_id: "00000000-0000-7000-8000-000000000000" },
  "POST /api/chapters/:chapterId/glossary-apply/preview": { rules: [{ source_term: "검", from: "kiếm" }] },
  "POST /api/chapters/:chapterId/glossary-apply/apply": {
    rules: [{ source_term: "검", from: "kiếm" }],
    versions: {},
  },
};

/** Route có id tài nguyên → tham số trỏ vào tài nguyên của B. */
const RESOURCE_CASES: Record<string, (b: Seed) => Record<string, string>> = {
  "POST /api/chapters/:chapterId/uploads": (b) => ({ chapterId: b.chapterId }),
  "GET /api/chapters/:chapterId/progress": (b) => ({ chapterId: b.chapterId }),
  "GET /api/jobs/:jobId": (b) => ({ jobId: jobOf[b.userId] ?? "" }),
  "POST /api/jobs/:jobId/cancel": (b) => ({ jobId: jobOf[b.userId] ?? "" }),
  "GET /api/series/:seriesId": (b) => ({ seriesId: b.seriesId }),
  "PATCH /api/series/:seriesId": (b) => ({ seriesId: b.seriesId }),
  "GET /api/chapters/:chapterId": (b) => ({ chapterId: b.chapterId }),
  "PATCH /api/chapters/:chapterId": (b) => ({ chapterId: b.chapterId }),
  "GET /api/chapters/:chapterId/pages": (b) => ({ chapterId: b.chapterId }),
  "GET /api/chapters/:chapterId/source-files": (b) => ({ chapterId: b.chapterId }),
  "PATCH /api/chapters/:chapterId/source-files/:fileId": (b) => ({
    chapterId: spareChapterOf[b.userId] ?? "",
    fileId: spareSourceOf[b.userId] ?? "",
  }),
  "PUT /api/chapters/:chapterId/source-files/order": (b) => ({ chapterId: spareChapterOf[b.userId] ?? "" }),
  // presign trước commit: commit (own) loại source file giả (không có object) khỏi chương A.
  "POST /api/chapters/:chapterId/presign": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/commit": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/retry-failed": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/translate-prepared": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/translate": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/cancel": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/lock": (b) => ({ chapterId: b.chapterId }),
  "DELETE /api/chapters/:chapterId/lock": (b) => ({ chapterId: b.chapterId }),
  "GET /api/series/:seriesId/glossary": (b) => ({ seriesId: b.seriesId }),
  "POST /api/series/:seriesId/glossary": (b) => ({ seriesId: b.seriesId }),
  "GET /api/series/:seriesId/glossary/csv": (b) => ({ seriesId: b.seriesId }),
  "POST /api/series/:seriesId/glossary/csv": (b) => ({ seriesId: b.seriesId }),
  // PATCH trước DELETE: DELETE (own) xoá entry mẫu của A.
  "PATCH /api/glossary/:entryId": (b) => ({ entryId: entryOf[b.userId] ?? "" }),
  "DELETE /api/glossary/:entryId": (b) => ({ entryId: entryOf[b.userId] ?? "" }),
  "GET /api/pages/:pageId": (b) => ({ pageId: pageOf[b.userId] ?? "" }),
  "PUT /api/pages/:pageId/state": (b) => ({ pageId: pageOf[b.userId] ?? "" }),
  "PATCH /api/pages/:pageId": (b) => ({ pageId: pageOf[b.userId] ?? "" }),
  "POST /api/pages/:pageId/ai-update/ack": (b) => ({ pageId: pageOf[b.userId] ?? "" }),
  "POST /api/pages/:pageId/mask-upload": (b) => ({ pageId: pageOf[b.userId] ?? "" }),
  "POST /api/pages/:pageId/reinpaint": (b) => ({ pageId: pageOf[b.userId] ?? "" }),
  "POST /api/pages/:pageId/ocr-region": (b) => ({ pageId: pageOf[b.userId] ?? "" }),
  "POST /api/chapters/:chapterId/export": (b) => ({ chapterId: b.chapterId }),
  "GET /api/chapters/:chapterId/exports": (b) => ({ chapterId: b.chapterId }),
  "GET /api/exports/:jobId": (b) => ({ jobId: jobOf[b.userId] ?? "" }),
  "GET /api/exports/:jobId/download": (b) => ({ jobId: jobOf[b.userId] ?? "" }),
  "POST /api/series/:seriesId/ignore-apply/preview": (b) => ({ seriesId: b.seriesId }),
  "POST /api/series/:seriesId/ignore-apply/apply": (b) => ({ seriesId: b.seriesId }),
  "POST /api/series/:seriesId/ignore-apply/undo": (b) => ({ seriesId: b.seriesId }),
  "POST /api/chapters/:chapterId/find-replace/preview": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/find-replace/apply": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/find-replace/undo": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/glossary-apply/preview": (b) => ({ chapterId: b.chapterId }),
  "POST /api/chapters/:chapterId/glossary-apply/apply": (b) => ({ chapterId: b.chapterId }),
  "GET /api/chapters/:chapterId/states": (b) => ({ chapterId: b.chapterId }),
  "PUT /api/chapters/:chapterId/states": (b) => ({ chapterId: b.chapterId }),
  "GET /api/series/:seriesId/skip-images": (b) => ({ seriesId: b.seriesId }),
  "POST /api/series/:seriesId/skip-images": (b) => ({ seriesId: b.seriesId }),
  "DELETE /api/series/:seriesId/skip-images/:imageId": (b) => ({
    seriesId: b.seriesId,
    imageId: skipImageOf[b.userId] ?? "",
  }),
  "DELETE /api/fonts/:fontId": (b) => ({ fontId: fontOf[b.userId] ?? "" }),
  "POST /api/chapters/:chapterId/proofread": (b) => ({ chapterId: b.chapterId }),
  "GET /api/chapters/:chapterId/proofread": (b) => ({ chapterId: b.chapterId }),
  "PATCH /api/proofread-suggestions/:suggestionId": (b) => ({ suggestionId: suggestionOf[b.userId] ?? "" }),
  "DELETE /api/chapters/:chapterId": (b) => ({ chapterId: spareChapterOf[b.userId] ?? "" }),
  "DELETE /api/series/:seriesId": (b) => ({ seriesId: spareSeriesOf[b.userId] ?? "" }),
};

/** Mọi (method, path) người dùng dưới /api — lấy từ router thật, không liệt kê tay. */
const userRoutes = () => {
  const seen = new Set<string>();
  for (const r of app.routes) {
    if (r.method === "ALL" || !r.path.startsWith("/api/")) continue;
    if (r.path.startsWith("/api/auth/") || r.path.startsWith("/api/dev/")) continue;
    seen.add(`${r.method} ${r.path}`);
  }
  return [...seen].sort();
};

function fill(path: string, params: Record<string, string>) {
  return path.replace(/:(\w+)/g, (_, k: string) => params[k] ?? "00000000-0000-7000-8000-000000000000");
}

describe("tenant isolation", () => {
  it("discovers user routes (incl. /api/me and /api/settings/pipeline)", () => {
    const routes = userRoutes();
    expect(routes).toEqual(expect.arrayContaining(["GET /api/me", "PUT /api/settings/pipeline"]));
    expect(routes.length).toBeGreaterThan(50);
  });

  it("(a) no session → 401 on every user route (also for a bogus cookie)", async () => {
    for (const route of userRoutes()) {
      const [method = "GET", path = ""] = route.split(" ");
      const params = RESOURCE_CASES[route]?.(A) ?? {};
      for (const cookie of [undefined, "better-auth.session_token=bogus"]) {
        const res = await call(fill(path, params), { method, cookie, body: BODIES[route] });
        expect(res.status, `${route} cookie=${cookie}`).toBe(401);
      }
    }
  });

  it("(b) every route with a resource id has a cross-user case", () => {
    const withIds = userRoutes().filter((r) => /:\w+/.test(r));
    expect(withIds.filter((r) => !RESOURCE_CASES[r])).toEqual([]);
    expect(Object.keys(RESOURCE_CASES).filter((r) => !withIds.includes(r))).toEqual([]);
  });

  it("(b) A with a resource id of B → 404", async () => {
    for (const [route, params] of Object.entries(RESOURCE_CASES)) {
      const [method = "GET", path = ""] = route.split(" ");
      const res = await call(fill(path, params(B)), { method, cookie: A.cookie, body: BODIES[route] });
      expect(res.status, route).toBe(404);
      // Đối chứng: cùng route với tài nguyên của chính A thì không phải 404/403.
      const own = await call(fill(path, params(A)), { method, cookie: A.cookie, body: BODIES[route] });
      expect([403, 404], `${route} own`).not.toContain(own.status);
    }
  });

  it("recent-chapters of A never lists chapters of B", async () => {
    const res = await call(`/api/recent-chapters?limit=100`, { cookie: A.cookie });
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { chapters: { id: string }[] }).chapters.map((c) => c.id);
    expect(ids).toContain(A.chapterId);
    expect(ids).not.toContain(B.chapterId);
  });
});

describe("scoped()", () => {
  it("byId never returns another user's row", async () => {
    const sA = scoped(db, A.userId);
    await expect(sA.byId(chapters, B.chapterId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sA.byId(chapters, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    expect((await sA.byId(chapters, A.chapterId)).id).toBe(A.chapterId);
  });

  it("countBy only counts rows of its user", async () => {
    const groups = await scoped(db, A.userId).countBy(pages, { chapterId: pages.chapterId });
    expect(groups).toContainEqual({ chapterId: A.chapterId, n: 1 });
    expect(groups.map((g) => g.chapterId)).not.toContain(B.chapterId);
  });

  it("update/delete of another user's id affect nothing", async () => {
    const sA = scoped(db, A.userId);
    expect(await sA.update(series, eq(series.id, B.seriesId), { title: "hacked" })).toEqual([]);
    expect(await sA.delete(series, eq(series.id, B.seriesId))).toEqual([]);
    const [still] = await db.select().from(series).where(eq(series.id, B.seriesId));
    expect(still?.title).toBe("Series b");
  });

  it("insert/update force user_id of the scope", async () => {
    const sA = scoped(db, A.userId);
    const s = await sA.insert(series, { title: "x", userId: B.userId } as never);
    expect(s.userId).toBe(A.userId);
    const [u] = await sA.update(series, eq(series.id, s.id), { title: "y", userId: B.userId } as never);
    expect(u?.userId).toBe(A.userId);
  });

  it("composite FK blocks a child row pointing at a parent of another user", async () => {
    const sA = scoped(db, A.userId);
    await expect(sA.insert(chapters, { seriesId: B.seriesId, number: "2" })).rejects.toThrow();
  });
});
