/** Route editor: đọc/ghi page_states (If-Match + khoá chương), ack AI, mask-upload → reinpaint, OCR vùng. */
import { jobs, pageStateHistory, pageStates, pages, scoped } from "@mtl/db";
import { emptyPageState, type PageState, pageId, storageKeys } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { HISTORY_KEEP } from "../src/jobs/page-state-writer.ts";
import { call, db, seedWorkspace } from "./helpers.ts";
import { aiState, PNG_1PX, SHA } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;
let ord = 0;

const W = 720;
const H = 3000;

async function newPage(cleanRev: number | null = 1) {
  const sdb = scoped(db, A.workspaceId);
  const id = pageId(A.chapterId, 1, ord++);
  await sdb.insert(pages, {
    id,
    chapterId: A.chapterId,
    ord,
    width: W,
    height: H,
    originalKey: `ws/${A.workspaceId}/ch/${A.chapterId}/ingest/1/${ord}.png`,
    originalSha256: SHA,
    cleanRev,
  });
  await sdb.insert(pageStates, { pageId: id, state: aiState(W, H, "AI"), aiState: aiState(W, H, "AI"), aiRev: 1 });
  return id;
}

const p = (id: string, path = "") => `/api/w/${A.workspaceId}/pages/${id}${path}`;
const lock = () => call(`/api/w/${A.workspaceId}/chapters/${A.chapterId}/lock`, { method: "POST", cookie: A.cookie });
const unlock = () =>
  call(`/api/w/${A.workspaceId}/chapters/${A.chapterId}/lock`, { method: "DELETE", cookie: A.cookie });

function put(id: string, state: PageState, version?: number | string) {
  return call(p(id, "/state"), {
    method: "PUT",
    cookie: A.cookie,
    body: { state },
    headers: version === undefined ? {} : { "if-match": String(version) },
  });
}

const edited = (text: string): PageState => {
  const s = aiState(W, H, text);
  return { ...s, regions: s.regions.map((r) => ({ ...r, translation: text })) };
};

async function upload(post: { url: string; fields: Record<string, string> }, body: Uint8Array) {
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
  form.append("file", new Blob([body], { type: "image/png" }));
  return fetch(post.url, { method: "POST", body: form });
}

beforeAll(async () => {
  A = await seedWorkspace("pst");
});

describe("GET /pages/:id", () => {
  it("returns state, version, ai_state, clean_rev and signed image URLs", async () => {
    const id = await newPage(3);
    const res = await call(p(id), { cookie: A.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"0"');
    const body = (await res.json()) as Record<string, unknown> & {
      page: { clean_rev: number; width: number };
      images: { original: string; clean: string };
    };
    expect(body.version).toBe(0);
    expect(body.ai_rev).toBe(1);
    expect(body.ai_update_available).toBe(false);
    expect(body.page).toMatchObject({ clean_rev: 3, width: W, chapter_id: A.chapterId });
    expect(body.images.clean).toContain(storageKeys.clean(A.workspaceId, id, 3));
    expect(body.images.original).toContain("/ingest/1/");
  });

  it("has no clean URL before stage 1", async () => {
    const id = await newPage(null);
    const body = (await (await call(p(id), { cookie: A.cookie })).json()) as { images: { clean: unknown } };
    expect(body.images.clean).toBeNull();
  });
});

describe("PUT /pages/:id/state", () => {
  it("requires the chapter lock (423)", async () => {
    await unlock();
    const id = await newPage();
    expect((await put(id, edited("x"), 0)).status).toBe(423);
  });

  it("requires If-Match (428) and rejects a malformed one (400)", async () => {
    await lock();
    const id = await newPage();
    expect((await put(id, edited("x"))).status).toBe(428);
    expect((await put(id, edited("x"), "abc")).status).toBe(400);
  });

  it("saves with the current version: version+1, origin user, history row, ai flag untouched", async () => {
    await lock();
    const id = await newPage();
    await db.update(pageStates).set({ aiUpdateAvailable: true }).where(eq(pageStates.pageId, id));
    const res = await put(id, edited("Người sửa"), '"0"');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ version: 1 });
    const [st] = await db.select().from(pageStates).where(eq(pageStates.pageId, id));
    expect(st?.state?.regions[0]?.translation).toBe("Người sửa");
    expect(st?.stateOrigin).toBe("user");
    expect(st?.aiUpdateAvailable).toBe(true);
    const hist = await db.select().from(pageStateHistory).where(eq(pageStateHistory.pageId, id));
    expect(hist).toHaveLength(1);
    expect(hist[0]?.version).toBe(0);
    expect(hist[0]?.state?.regions[0]?.translation).toBe("AI");
    expect(hist[0]?.actor).toBe(`user:${A.ownerId}`);
  });

  it("stale version → 409 with the current version, state unchanged (no blind overwrite)", async () => {
    await lock();
    const id = await newPage();
    expect((await put(id, edited("một"), 0)).status).toBe(200);
    const res = await put(id, edited("hai"), 0);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "version_conflict", version: 1 });
    const [st] = await db.select().from(pageStates).where(eq(pageStates.pageId, id));
    expect(st?.state?.regions[0]?.translation).toBe("một");
  });

  it("rejects invalid state: non-NFC text, size mismatch", async () => {
    await lock();
    const id = await newPage();
    const nfd = edited("Tiếng Việt".normalize("NFD"));
    expect((await put(id, nfd, 0)).status).toBe(400);
    expect((await put(id, emptyPageState(W + 1, H), 0)).status).toBe(400);
  });

  it(`keeps at most ${HISTORY_KEEP} history rows`, async () => {
    await lock();
    const id = await newPage();
    for (let v = 0; v < HISTORY_KEEP + 3; v++) expect((await put(id, edited(`v${v}`), v)).status).toBe(200);
    const hist = await db.select().from(pageStateHistory).where(eq(pageStateHistory.pageId, id));
    expect(hist).toHaveLength(HISTORY_KEEP);
    expect(Math.min(...hist.map((h) => h.version))).toBe(3);
  });
});

describe("POST /pages/:id/ai-update/ack", () => {
  it("clears the flag only for the ai_rev the user has seen", async () => {
    const id = await newPage();
    await db.update(pageStates).set({ aiUpdateAvailable: true, aiRev: 2 }).where(eq(pageStates.pageId, id));
    const stale = await call(p(id, "/ai-update/ack"), { method: "POST", cookie: A.cookie, body: { ai_rev: 1 } });
    expect(await stale.json()).toEqual({ ai_rev: 2, ai_update_available: true });
    const ok = await call(p(id, "/ai-update/ack"), { method: "POST", cookie: A.cookie, body: { ai_rev: 2 } });
    expect(await ok.json()).toEqual({ ai_rev: 2, ai_update_available: false });
  });
});

describe("mask upload → reinpaint", () => {
  const maskUpload = async (id: string) => {
    const res = await call(p(id, "/mask-upload"), { method: "POST", cookie: A.cookie });
    expect(res.status).toBe(201);
    return (await res.json()) as { key: string; url: string; fields: Record<string, string> };
  };
  const reinpaint = (id: string, body: unknown) =>
    call(p(id, "/reinpaint"), { method: "POST", cookie: A.cookie, body });

  it("signs a PNG-only POST under the page's user-mask prefix", async () => {
    const id = await newPage();
    const post = await maskUpload(id);
    expect(post.key).toMatch(new RegExp(`^ws/${A.workspaceId}/pg/${id}/user-mask/[0-9a-f-]{36}\\.png$`));
    expect(post.fields["Content-Type"]).toBe("image/png");
  });

  it("enqueues page.reinpaint for an uploaded mask on the current clean rev", async () => {
    await lock();
    const id = await newPage(4);
    const post = await maskUpload(id);
    expect((await upload(post, PNG_1PX)).status).toBe(204);
    const res = await reinpaint(id, { user_mask_key: post.key, offset: [10, 20], base_clean_rev: 4 });
    expect(res.status, await res.clone().text()).toBe(202);
    const { job } = (await res.json()) as { job: { id: string; type: string } };
    expect(job.type).toBe("page.reinpaint");
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.payload).toEqual({
      type: "page.reinpaint",
      page_id: id,
      base_clean_rev: 4,
      user_mask_key: post.key,
      offset: { x: 10, y: 20 },
      // Cài đặt pipeline mặc định của workspace (snapshot lúc enqueue).
      inpaint: { inpainter: "big_lama", inpaint_size: 512 },
    });
  });

  it("rejects stale clean rev (409), missing/foreign mask (400) and missing lock (423)", async () => {
    await lock();
    const id = await newPage(5);
    const post = await maskUpload(id);
    expect((await reinpaint(id, { user_mask_key: post.key, offset: [0, 0], base_clean_rev: 4 })).status).toBe(409);
    expect((await reinpaint(id, { user_mask_key: post.key, offset: [0, 0], base_clean_rev: 5 })).status).toBe(400);
    const foreign = `ws/${A.workspaceId}/pg/other/user-mask/x.png`;
    expect((await reinpaint(id, { user_mask_key: foreign, offset: [0, 0], base_clean_rev: 5 })).status).toBe(400);
    await unlock();
    expect((await reinpaint(id, { user_mask_key: post.key, offset: [0, 0], base_clean_rev: 5 })).status).toBe(423);
  });
});

describe("POST /pages/:id/ocr-region", () => {
  it("enqueues page.ocr_region for a bbox inside the page; rejects bbox outside", async () => {
    const id = await newPage();
    const out = await call(p(id, "/ocr-region"), {
      method: "POST",
      cookie: A.cookie,
      body: { bbox: [700, 0, 50, 50] },
    });
    expect(out.status).toBe(400);
    const res = await call(p(id, "/ocr-region"), {
      method: "POST",
      cookie: A.cookie,
      body: { bbox: [10, 10, 80, 40] },
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { type: string; page_id: string } };
    expect(job).toMatchObject({ type: "page.ocr_region", page_id: id });
  });
});

describe("GET /chapters/:id/states", () => {
  it("returns every page's state in ord order, without ai_state", async () => {
    const ids = [await newPage(), await newPage(null)];
    expect((await lock()).status).toBe(200);
    const first = ids[0] as string;
    expect((await put(first, edited("Sửa tay"), 0)).status).toBe(200);
    await unlock();
    const res = await call(`/api/w/${A.workspaceId}/chapters/${A.chapterId}/states`, { cookie: A.cookie });
    expect(res.status).toBe(200);
    const { pages: list } = (await res.json()) as { pages: Record<string, unknown>[] };
    const ords = list.map((x) => x.ord as number);
    expect(ords).toEqual([...ords].sort((a, b) => a - b));
    for (const id of ids) expect(list.some((x) => x.page_id === id)).toBe(true);
    for (const x of list) {
      expect(Object.keys(x).sort()).toEqual(
        ["ai_rev", "ai_update_available", "ord", "page_id", "state", "state_origin", "version"].sort(),
      );
    }
    expect(list.find((x) => x.page_id === first)).toMatchObject({
      version: 1,
      state_origin: "user",
      ai_rev: 1,
      state: { regions: [{ translation: "Sửa tay" }] },
    });
  });
});
