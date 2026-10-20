/**
 * Cô lập tenant cho MỌI route /api/w/:ws/*:
 *  (a) `:ws` của B, người gọi chỉ thuộc A → 403
 *  (b) `:ws` của A nhưng id tài nguyên thuộc B → 404
 * Phase sau thêm route → thêm case vào RESOURCE_CASES (chỉ append).
 */
import { chapters, jobs, NotFoundError, scoped, series } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { app, call, db, seedWorkspace } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;
let B: Seed;

/** Job mẫu của mỗi workspace (route /jobs/:jobId). */
const jobOf: Record<string, string> = {};

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
  }
});

/** Body hợp lệ tối thiểu cho từng route (để 404 đến từ tra cứu id chứ không phải validate body). */
const BODIES: Record<string, unknown> = {
  "PATCH /api/w/:ws/settings": { worker_mode: "modal" },
  "POST /api/w/:ws/chapters/:chapterId/uploads": { filename: "001.png", content_type: "image/png", bytes: 1024 },
};

/** Route có id tài nguyên ngoài :ws → tham số trỏ vào tài nguyên của B. */
const RESOURCE_CASES: Record<string, (b: Seed) => Record<string, string>> = {
  "POST /api/w/:ws/chapters/:chapterId/uploads": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/invitations/:invitationId/link": (b) => ({ invitationId: b.invitationId }),
  "GET /api/w/:ws/chapters/:chapterId/progress": (b) => ({ chapterId: b.chapterId }),
  "GET /api/w/:ws/jobs/:jobId": (b) => ({ jobId: jobOf[b.workspaceId] ?? "" }),
  "POST /api/w/:ws/jobs/:jobId/cancel": (b) => ({ jobId: jobOf[b.workspaceId] ?? "" }),
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
});

describe("scoped()", () => {
  it("byId never returns another workspace's row", async () => {
    const sA = scoped(db, A.workspaceId);
    await expect(sA.byId(chapters, B.chapterId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sA.byId(chapters, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    expect((await sA.byId(chapters, A.chapterId)).id).toBe(A.chapterId);
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
