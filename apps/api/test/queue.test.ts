/** Hàng đợi: idempotency, claim song song không trùng, lọc workspace / worker_mode / capability / pipeline_version. */
import { jobs } from "@mtl/db";
import type { JobPayload } from "@mtl/shared";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { inJobTx, insertJob } from "../src/jobs/enqueue.ts";
import { compareVersion } from "../src/jobs/queue.ts";
import { reapExpiredLeases } from "../src/jobs/reaper.ts";
import { db, seedWorkspace } from "./helpers.ts";
import { claimJobs, expireLease, jobRow, setWorkerMode, VERSION, wcall, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;
let B: Seed;
let M: Seed;

const exportPayload = (chapterId: string): JobPayload => ({
  type: "chapter.export",
  chapter_id: chapterId,
  format: "cbz",
  layout: "pages",
  quality: 90,
  include_untranslated: true,
});

/** Job không cần page/output (chapter.export) — đủ để kiểm claim. */
async function addExportJobs(seed: Seed, n: number, key = () => uuidv7()) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { job } = await inJobTx((tx) =>
      insertJob(tx, {
        workspaceId: seed.workspaceId,
        payload: exportPayload(seed.chapterId),
        key: { inputRev: "r", idempotencyKey: key() },
        chapterId: seed.chapterId,
      }),
    );
    ids.push(job.id);
  }
  return ids;
}

beforeAll(async () => {
  [A, B, M] = await Promise.all([seedWorkspace("qa"), seedWorkspace("qb"), seedWorkspace("qm")]);
  await setWorkerMode(M.workspaceId, "modal");
});

describe("enqueue idempotency", () => {
  it("returns the same job while active, creates a new one after the old failed", async () => {
    const key = uuidv7();
    const [first] = await addExportJobs(A, 1, () => key);
    const [again] = await addExportJobs(A, 1, () => key);
    expect(again).toBe(first);
    await db
      .update(jobs)
      .set({ status: "failed" })
      .where(eq(jobs.id, first as string));
    const [fresh] = await addExportJobs(A, 1, () => key);
    expect(fresh).not.toBe(first);
  });
});

describe("claim", () => {
  it("2 workers claiming 1000 jobs concurrently never get the same job", async () => {
    const W = await seedWorkspace("q1000");
    const ids = new Set(await addExportJobs(W, 1000));
    const t1 = (await workerToken(W.workspaceId, "w1")).token;
    const t2 = (await workerToken(W.workspaceId, "w2")).token;
    const seen: string[] = [];
    const drain = async (tk: string) => {
      for (;;) {
        const got = await claimJobs(tk, { caps: ["chapter.export"], max: 8 });
        if (got.length === 0) return;
        seen.push(...got.map((j) => j.id));
      }
    };
    await Promise.all([drain(t1), drain(t2), drain(t1), drain(t2)]);
    expect(seen).toHaveLength(1000);
    expect(new Set(seen).size).toBe(1000);
    expect(seen.every((id) => ids.has(id))).toBe(true);
  }, 120_000);

  it("workspace token only claims its own workspace; mac token skips modal workspaces", async () => {
    const [bJob] = await addExportJobs(B, 1);
    const [mJob] = await addExportJobs(M, 1);
    const tA = (await workerToken(A.workspaceId, "a-only")).token;
    const tM = (await workerToken(M.workspaceId, "m-mac")).token;
    const gotA = await claimJobs(tA, { caps: ["chapter.export"], max: 8 });
    expect(gotA.map((j) => j.id)).not.toContain(bJob);
    expect(await claimJobs(tM, { caps: ["chapter.export"], max: 8 })).toEqual([]);
    // Token nền tảng (Modal) phục vụ workspace chế độ modal.
    const platform = (await workerToken(null, "modal")).token;
    const got = await claimJobs(platform, { caps: ["chapter.export"], max: 8 });
    expect(got.map((j) => j.id)).toContain(mJob);
    expect(got.map((j) => j.id)).not.toContain(bJob);
  });

  it("rejects old pipeline_version (426) and unknown/disallowed capabilities (400)", async () => {
    const tA = (await workerToken(A.workspaceId, "caps", ["page.prepare"])).token;
    const body = { worker_id: "x", max: 1, dispatch_id: null };
    expect(
      (await wcall(tA, "/claim", { ...body, capabilities: ["page.prepare"], pipeline_version: "0.2.9" })).status,
    ).toBe(426);
    expect((await wcall(tA, "/claim", { ...body, capabilities: ["bogus"], pipeline_version: VERSION })).status).toBe(
      400,
    );
    expect(
      (await wcall(tA, "/claim", { ...body, capabilities: ["chapter.export"], pipeline_version: VERSION })).status,
    ).toBe(400);
  });

  it("compares versions numerically", () => {
    expect(compareVersion("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersion("0.3.0", "0.3.0")).toBe(0);
    expect(compareVersion("0.2.9", "0.3.0")).toBe(-1);
  });
});

describe("reaper", () => {
  it("fails a job whose lease expired on its last attempt", async () => {
    const W = await seedWorkspace("reap");
    const [id] = await addExportJobs(W, 1);
    await db
      .update(jobs)
      .set({ maxAttempts: 1 })
      .where(eq(jobs.id, id as string));
    const tk = (await workerToken(W.workspaceId)).token;
    const [j] = await claimJobs(tk, { caps: ["chapter.export"] });
    expect(j?.id).toBe(id);
    await expireLease(id as string);
    await reapExpiredLeases();
    const row = await jobRow(id as string);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/lease expired/);
    const running = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, W.workspaceId), eq(jobs.status, "running")));
    expect(running).toEqual([]);
  });
});
