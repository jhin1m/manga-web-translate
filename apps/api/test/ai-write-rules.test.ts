/**
 * Luật AI-không-ghi-đè (red team #1, #6) + khoá chương: AI ghi trang chưa sửa tay kể cả khi tab đang giữ khoá; trang
 * đang dịch/chờ lượt chỉ xem (409 `page_busy`); thao tác hàng loạt bị chặn khi chương đang chạy (409 `chapter_busy`).
 */
import { chapters, pageStateHistory, pageStates, pages, scoped } from "@mtl/db";
import { emptyPageState, type PageState, pageId } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { HISTORY_KEEP, writeAiState } from "../src/jobs/page-state-writer.ts";
import {
  acquireChapterLock,
  activeLockHolder,
  assertChapterLock,
  releaseChapterLock,
} from "../src/lib/chapter-lock.ts";
import { call, db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import {
  addSources,
  aiState,
  type Claimed,
  claimJobs,
  doIngest,
  doPrepare,
  doTranslate,
  pageRows,
  SHA,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let A: Seed;
let ord = 0;

async function newPage(opts: { status?: "ready" | "translating"; queued?: boolean } = {}) {
  const sdb = scoped(db, A.userId);
  const id = pageId(A.chapterId, 1, ord++);
  await sdb.insert(pages, {
    id,
    chapterId: A.chapterId,
    ord,
    width: 720,
    height: 3000,
    originalKey: `u/${A.userId}/x/${id}.png`,
    originalSha256: SHA,
    cleanRev: 1,
    status: opts.status ?? "ready",
    translateQueued: opts.queued ?? false,
  });
  await sdb.insert(pageStates, { pageId: id, state: emptyPageState(720, 3000) });
  return id;
}

const write = (id: string, text: string) =>
  inJobTx((tx) =>
    writeAiState(tx, { userId: A.userId, pageId: id, aiState: aiState(720, 3000, text), actor: "job:test" }),
  );
const stateOf = async (id: string) => (await db.select().from(pageStates).where(eq(pageStates.pageId, id)))[0];

const lock = (S: Seed = A) => call(`/api/chapters/${S.chapterId}/lock`, { method: "POST", cookie: S.cookie });
const unlock = (S: Seed = A) => call(`/api/chapters/${S.chapterId}/lock`, { method: "DELETE", cookie: S.cookie });
const put = (id: string, state: PageState, version: number, S: Seed = A) =>
  call(`/api/pages/${id}/state`, {
    method: "PUT",
    cookie: S.cookie,
    body: { state },
    headers: { "if-match": `${version}` },
  });
const reinpaint = (id: string, S: Seed = A) =>
  call(`/api/pages/${id}/reinpaint`, {
    method: "POST",
    cookie: S.cookie,
    body: { user_mask_key: `u/${S.userId}/pg/${id}/user-mask/x.png`, offset: [0, 0], base_clean_rev: 1 },
  });
const edited = (text: string): PageState => aiState(720, 3000, text);

beforeAll(async () => {
  A = await seedUser("aiw");
});

describe("AI write rules", () => {
  it("applies AI state while nobody has edited and the chapter is not locked", async () => {
    const id = await newPage();
    expect(await write(id, "một")).toBe("applied");
    const s = await stateOf(id);
    expect(s?.state?.regions[0]?.translation).toBe("một");
    expect(s?.version).toBe(1);
    expect(s?.aiRev).toBe(1);
    expect(s?.aiUpdateAvailable).toBe(false);
  });

  it("never overwrites a hand-edited state; flags ai_update_available and bumps version", async () => {
    const id = await newPage();
    await write(id, "AI 1");
    await db.update(pageStates).set({ stateOrigin: "user", version: 5 }).where(eq(pageStates.pageId, id));
    expect(await write(id, "AI 2")).toBe("ai_update_available");
    const s = await stateOf(id);
    expect(s?.state?.regions[0]?.translation).toBe("AI 1");
    expect(s?.aiState?.regions[0]?.translation).toBe("AI 2");
    expect(s?.aiUpdateAvailable).toBe(true);
    expect(s?.version).toBe(6);
    expect(s?.aiRev).toBe(2);
  });

  it("applies AI state on an untouched page even while an editor holds the chapter lock", async () => {
    expect((await lock()).status).toBe(200);
    const id = await newPage();
    expect(await write(id, "khoá")).toBe("applied");
    const s = await stateOf(id);
    expect(s?.state?.regions[0]?.translation).toBe("khoá");
    expect(s?.aiUpdateAvailable).toBe(false);
    expect(s?.version).toBe(1);
    await unlock();
  });

  it("still never overwrites a hand-edited page while locked", async () => {
    expect((await lock()).status).toBe(200);
    const id = await newPage();
    expect(await write(id, "AI 1")).toBe("applied");
    expect((await put(id, edited("Sửa tay"), 1)).status).toBe(200);
    expect(await write(id, "AI 2")).toBe("ai_update_available");
    const s = await stateOf(id);
    expect(s?.state?.regions[0]?.translation).toBe("Sửa tay");
    expect(s?.aiState?.regions[0]?.translation).toBe("AI 2");
    expect(s?.stateOrigin).toBe("user");
    expect(s?.aiUpdateAvailable).toBe(true);
    expect(s?.version).toBe(3);
    await unlock();
  });

  it("a stale If-Match after the AI wrote the page gets 409 version_conflict", async () => {
    expect((await lock()).status).toBe(200);
    const id = await newPage();
    const v = (await stateOf(id))?.version ?? -1;
    expect(await write(id, "AI mới")).toBe("applied");
    const res = await put(id, edited("Sửa trên bản cũ"), v);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "version_conflict", version: v + 1 });
    expect((await stateOf(id))?.state?.regions[0]?.translation).toBe("AI mới");
    await unlock();
  });

  it(`keeps at most ${HISTORY_KEEP} history rows per page`, async () => {
    const id = await newPage();
    for (let i = 0; i < HISTORY_KEEP + 5; i++) await write(id, `v${i}`);
    const hist = await db.select().from(pageStateHistory).where(eq(pageStateHistory.pageId, id));
    expect(hist).toHaveLength(HISTORY_KEEP);
    expect(Math.min(...hist.map((h) => h.version))).toBe(5);
    expect((await stateOf(id))?.version).toBe(HISTORY_KEEP + 5);
  });
});

describe("busy pages are read-only", () => {
  it("PUT on a page waiting in the translate run returns 409 page_busy", async () => {
    expect((await lock()).status).toBe(200);
    const id = await newPage({ queued: true });
    const res = await put(id, edited("x"), 0);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "page_busy" });
    const ri = await reinpaint(id);
    expect(ri.status).toBe(409);
    expect(await ri.json()).toEqual({ error: "page_busy" });
    expect((await stateOf(id))?.version).toBe(0);
    await unlock();
  });

  it("PUT on a page being translated returns 409 page_busy", async () => {
    expect((await lock()).status).toBe(200);
    const id = await newPage({ status: "translating" });
    expect((await put(id, edited("x"), 0)).status).toBe(409);
    await unlock();
  });

  it("the chapter lock is still checked first (423 without it)", async () => {
    await unlock();
    const id = await newPage({ queued: true });
    expect((await put(id, edited("x"), 0)).status).toBe(423);
  });
});

describe("editing while the chapter translates batch by batch", () => {
  const N = 9;

  beforeEach(cancelActiveJobs);

  it("PUT on a finished page succeeds while the next batch is still queued", async () => {
    const { token } = await workerToken("mac");
    const S = await seedUser("aiw-chain");
    await addSources(S.userId, S.chapterId, N);
    await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId, undefined, "translated"));
    const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
    expect((await doIngest(token, ij as Claimed)).status).toBe(200);
    const prep = [
      ...(await claimJobs(token, { caps: ["page.prepare"], max: 8 })),
      ...(await claimJobs(token, { caps: ["page.prepare"], max: 8 })),
    ];
    expect(prep).toHaveLength(N);
    const ids = (await pageRows(S.chapterId)).map((p) => p.id);
    // Job prepare của một chương cùng `created_at` (một giao dịch) nên claim trả theo thứ tự tuỳ ý. Lô 1 gồm mọi trang
    // đã prepare liền từ đầu chương → hoàn tất theo thứ tự đọc để lô 1 luôn chỉ có trang 1 (lô 2 còn chờ).
    prep.sort((a, b) => ids.indexOf(String(a.payload.page_id)) - ids.indexOf(String(b.payload.page_id)));
    for (const j of prep) expect((await doPrepare(token, j)).status).toBe(200);
    const [p0, p1] = ids as [string, string];

    // Tab mở editor và giữ khoá suốt lượt dịch.
    expect((await lock(S)).status).toBe(200);
    const [lot1] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect((await put(p0, edited("sớm"), 0, S)).status).toBe(409);
    expect((await doTranslate(token, lot1 as Claimed, "AI lô 1")).status).toBe(200);

    // Lô 1 xong (AI đã ghi dù chương đang khoá), lô 2 còn chờ.
    const s0 = await stateOf(p0);
    expect(s0?.state?.regions[0]?.translation).toBe("AI lô 1");
    expect(s0?.aiUpdateAvailable).toBe(false);
    const rows = await pageRows(S.chapterId);
    expect(rows[1]?.translateQueued).toBe(true);
    expect((await db.select().from(chapters).where(eq(chapters.id, S.chapterId)))[0]?.status).toBe("processing");

    const ok = await put(p0, edited("Sửa tay lô 1"), s0?.version ?? -1, S);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const busy = await put(p1, edited("x"), (await stateOf(p1))?.version ?? -1, S);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: "page_busy" });

    // Lô 2 xong: trang 2 có bản AI và sửa được; trang 1 đã sửa tay giữ nguyên.
    const [lot2] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect((await doTranslate(token, lot2 as Claimed, "AI lô 2")).status).toBe(200);
    const s1 = await stateOf(p1);
    expect(s1?.state?.regions[0]?.translation).toBe("AI lô 2");
    expect((await put(p1, edited("Sửa tay lô 2"), s1?.version ?? -1, S)).status).toBe(200);
    expect((await stateOf(p0))?.state?.regions[0]?.translation).toBe("Sửa tay lô 1");
    await unlock(S);
  });

  it("batch edits are refused while the chapter is processing", async () => {
    const S = await seedUser("aiw-busy");
    await db.update(chapters).set({ status: "processing" }).where(eq(chapters.id, S.chapterId));
    expect((await lock(S)).status).toBe(200);
    const post = (path: string, body: unknown) =>
      call(`/api/chapters/${S.chapterId}${path}`, { method: "POST", cookie: S.cookie, body });
    const fr = await post("/find-replace/apply", { find: "a", replace: "b", versions: {} });
    expect(fr.status).toBe(409);
    expect(await fr.json()).toMatchObject({ error: "chapter_busy" });
    const gl = await post("/glossary-apply/apply", { rules: [{ source_term: "a", from: "b" }], versions: {} });
    expect(gl.status).toBe(409);
    expect(await gl.json()).toMatchObject({ error: "chapter_busy" });
    const undo = await post("/find-replace/undo", { batch_id: "0190a000-0000-7000-8000-00000000dead" });
    expect(undo.status).toBe(409);
    expect(await undo.json()).toMatchObject({ error: "chapter_busy" });
    await unlock(S);
  });
});

describe("chapter lock", () => {
  it("one holder at a time; non-holders get 423; release frees it", async () => {
    const sdb = scoped(db, A.userId);
    expect(await acquireChapterLock(sdb, A.chapterId, "u1")).toBe(true);
    expect(await acquireChapterLock(sdb, A.chapterId, "u2")).toBe(false);
    await expect(assertChapterLock(sdb, A.chapterId, "u2")).rejects.toMatchObject({ status: 423 });
    await expect(assertChapterLock(sdb, A.chapterId, "u1")).resolves.toBeUndefined();
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, A.chapterId));
    expect(activeLockHolder(ch as NonNullable<typeof ch>)).toBe("u1");
    // Holder khác (tab khác) nhả không ảnh hưởng; đúng holder nhả mới tự do.
    await releaseChapterLock(sdb, A.chapterId, "u2");
    expect(await acquireChapterLock(sdb, A.chapterId, "u2")).toBe(false);
    await releaseChapterLock(sdb, A.chapterId, "u1");
    expect(await acquireChapterLock(sdb, A.chapterId, "u2")).toBe(true);
  });

  it("an expired lock can be taken over", async () => {
    const sdb = scoped(db, A.userId);
    await db
      .update(chapters)
      .set({ lockedBy: "old", lockedAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(chapters.id, A.chapterId));
    expect(await acquireChapterLock(sdb, A.chapterId, "u3")).toBe(true);
  });
});
