/** Luật AI-không-ghi-đè (red team #1, #6) + khoá chương. */
import { chapters, pageStateHistory, pageStates, pages, scoped } from "@mtl/db";
import { emptyPageState, pageId } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { inJobTx } from "../src/jobs/enqueue.ts";
import { HISTORY_KEEP, writeAiState } from "../src/jobs/page-state-writer.ts";
import { acquireChapterLock, assertChapterLock, isChapterLocked, releaseChapterLock } from "../src/lib/chapter-lock.ts";
import { db, seedUser } from "./helpers.ts";
import { aiState, SHA } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let A: Seed;
let ord = 0;

async function newPage() {
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
  });
  await sdb.insert(pageStates, { pageId: id, state: emptyPageState(720, 3000) });
  return id;
}

const write = (id: string, text: string, locked = false) =>
  inJobTx((tx) =>
    writeAiState(tx, {
      userId: A.userId,
      pageId: id,
      aiState: aiState(720, 3000, text),
      actor: "job:test",
      chapterLocked: locked,
    }),
  );
const stateOf = async (id: string) => (await db.select().from(pageStates).where(eq(pageStates.pageId, id)))[0];

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

  it("does not apply while the chapter is locked by an editor", async () => {
    const id = await newPage();
    expect(await write(id, "khoá", true)).toBe("ai_update_available");
    expect((await stateOf(id))?.state?.regions).toEqual([]);
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

describe("chapter lock", () => {
  it("one holder at a time; non-holders get 423; release frees it", async () => {
    const sdb = scoped(db, A.userId);
    expect(await acquireChapterLock(sdb, A.chapterId, "u1")).toBe(true);
    expect(await acquireChapterLock(sdb, A.chapterId, "u2")).toBe(false);
    await expect(assertChapterLock(sdb, A.chapterId, "u2")).rejects.toMatchObject({ status: 423 });
    await expect(assertChapterLock(sdb, A.chapterId, "u1")).resolves.toBeUndefined();
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, A.chapterId));
    expect(isChapterLocked(ch as NonNullable<typeof ch>)).toBe(true);
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
