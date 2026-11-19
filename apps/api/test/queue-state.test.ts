/**
 * Chương bận đang chờ worker: `/progress` trả `chapter.queue`, danh sách chương trả `queue_state` — để UI nói "Đang chờ
 * lượt" thay vì "Đang xử lý" khi chương chưa có job nào chạy.
 */
import { jobs, runtimeFlags, workerTokens } from "@mtl/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { chapterQueueStates } from "../src/jobs/queue-state.ts";
import { call, db, seedUser } from "./helpers.ts";
import { addSources, type Claimed, claimJobs, doIngest, failJob, makeRunnable, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type Queue = { state: string; running_chapters: number } | null;

const clearBreaker = () => db.delete(runtimeFlags).where(sql`${runtimeFlags.key} like 'llm_%'`);

async function progressQueue(S: Seed): Promise<Queue> {
  const res = await call(`/api/chapters/${S.chapterId}/progress`, { cookie: S.cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as { chapter: { queue: Queue } }).chapter.queue;
}

async function listQueueState(S: Seed, path: string): Promise<string | null | undefined> {
  const res = await call(path, { cookie: S.cookie });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { chapters?: { id: string; queue_state?: string | null }[] };
  return body.chapters?.find((c) => c.id === S.chapterId)?.queue_state;
}

const busy = (S: Seed) => ({ id: S.chapterId, userId: S.userId, status: "processing" });

describe("chapter queue state", () => {
  let S: Seed;
  let other: Seed;
  let token: { id: string; token: string };
  const localMode = env.MTL_LOCAL_MODE;

  beforeAll(async () => {
    await clearBreaker();
    token = await workerToken("mac", "queue-state-worker");
    // Chương của người khác đang chạy → "N chương đang chạy" đếm nó (chỉ con số).
    other = await seedUser("queueother");
    await addSources(other.userId, other.chapterId, 1);
    await inJobTx((tx) => enqueueIngest(tx, other.userId, other.chapterId));
    const [oj] = await claimJobs(token.token, { caps: ["chapter.ingest"] });
    expect(oj).toBeTruthy();

    S = await seedUser("queuestate");
    await addSources(S.userId, S.chapterId, 1);
  });

  afterEach(async () => {
    env.MTL_LOCAL_MODE = localMode;
    await clearBreaker();
  });

  afterAll(clearBreaker);

  it("idle chapter has no queue state", async () => {
    expect(await progressQueue(S)).toBeNull();
    expect(await listQueueState(S, `/api/series/${S.seriesId}`)).toBeNull();
  });

  it("chapter with a queued job and no worker on it → waiting, in progress and in every chapter list", async () => {
    await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
    expect(await progressQueue(S)).toEqual({ state: "waiting", running_chapters: 1 });
    expect(await listQueueState(S, `/api/series/${S.seriesId}`)).toBe("waiting");
    expect(await listQueueState(S, "/api/recent-chapters")).toBe("waiting");
  });

  it("only busy chapters can be waiting", async () => {
    expect((await chapterQueueStates([{ ...busy(S), status: "review" }])).size).toBe(0);
    // Chương của người khác không lộ qua id lạ: lọc theo user_id của chính chương.
    expect((await chapterQueueStates([{ ...busy(S), userId: other.userId }])).size).toBe(0);
  });

  it("jobs blocked by a paused AI provider are not 'waiting for a free worker'", async () => {
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.chapterId, S.chapterId), eq(jobs.status, "queued")));
    if (!row) throw new Error("no queued job");
    // Giả lập job LLM (không slot DB → breaker env) để breaker env chặn đúng như claim chặn.
    await db.update(jobs).set({ type: "chapter.translate" }).where(eq(jobs.id, row.id));
    await db.insert(runtimeFlags).values({ key: "llm_paused", value: {}, until: sql`now() + interval '2 minutes'` });
    expect((await chapterQueueStates([busy(S)])).size).toBe(0);
    await clearBreaker();
    expect((await chapterQueueStates([busy(S)])).get(S.chapterId)).toBe("waiting");
    await db.update(jobs).set({ type: "chapter.ingest" }).where(eq(jobs.id, row.id));
  });

  it("self-host without any worker seen recently → no_worker; with a recent worker → waiting", async () => {
    await db
      .update(workerTokens)
      .set({ lastSeenAt: sql`now() - interval '1 hour'` })
      .where(sql`${workerTokens.revokedAt} is null`);
    env.MTL_LOCAL_MODE = true;
    expect((await chapterQueueStates([busy(S)])).get(S.chapterId)).toBe("no_worker");
    await db.update(workerTokens).set({ lastSeenAt: sql`now()` }).where(eq(workerTokens.id, token.id));
    expect((await chapterQueueStates([busy(S)])).get(S.chapterId)).toBe("waiting");
    env.MTL_LOCAL_MODE = false;
    expect((await chapterQueueStates([busy(S)])).get(S.chapterId)).toBe("waiting");
  });

  it("running job → not waiting; AI backoff → not waiting; a job that just finished → not waiting yet", async () => {
    const [j] = (await claimJobs(token.token, { caps: ["chapter.ingest"] })) as Claimed[];
    if (!j) throw new Error("no ingest to claim");
    expect(await progressQueue(S)).toBeNull();
    expect(await listQueueState(S, `/api/series/${S.seriesId}`)).toBeNull();

    // AI/provider lỗi tạm → job về hàng đợi có backoff (UI đã có "Chờ AI").
    expect((await failJob(token.token, j, "provider")).status).toBe(200);
    expect(await progressQueue(S)).toBeNull();
    await makeRunnable(sql`${jobs.id} = ${j.id}`);
    expect((await progressQueue(S))?.state).toBe("waiting");

    // Ingest xong → page.prepare xếp hàng ngay; khoảng worker đang claim job kế không phải "chờ lượt".
    const [again] = (await claimJobs(token.token, { caps: ["chapter.ingest"] })) as Claimed[];
    if (!again) throw new Error("no ingest to reclaim");
    expect((await doIngest(token.token, again)).status).toBe(200);
    expect(await progressQueue(S)).toBeNull();
    await db
      .update(jobs)
      .set({ updatedAt: sql`now() - interval '10 seconds'` })
      .where(and(eq(jobs.chapterId, S.chapterId), sql`${jobs.status} not in ('queued', 'running')`));
    expect((await progressQueue(S))?.state).toBe("waiting");
  });
});
