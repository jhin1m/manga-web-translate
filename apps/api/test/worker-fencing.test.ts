/**
 * Fencing (red team #2): heartbeat/complete/fail/presign-outputs với lease_token sai, attempt cũ, token khác,
 * lease hết hạn → 409 và DB không đổi; worker zombie sau khi job bị claim lại không ghi được page/ledger.
 */
import { jobs, pages, usageLedger } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { reapExpiredLeases } from "../src/jobs/reaper.ts";
import { db, seedWorkspace } from "./helpers.ts";
import {
  addSources,
  type Claimed,
  claimJobs,
  complete,
  doIngest,
  doPrepare,
  expireLease,
  failJob,
  fence,
  jobRow,
  OCR,
  usage,
  VERSION,
  wcall,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;
let token: string;
let otherToken: string;

/** Chương 1 page đã ingest → 1 page.prepare queued; trả job đã claim. */
async function claimPrepare(): Promise<Claimed> {
  const [j] = await claimJobs(token, { caps: ["page.prepare"] });
  if (!j) throw new Error("no page.prepare job");
  return j;
}

beforeAll(async () => {
  A = await seedWorkspace("fence");
  token = (await workerToken(A.workspaceId, "mac-a")).token;
  otherToken = (await workerToken(A.workspaceId, "mac-a-2")).token;
  await addSources(A.workspaceId, A.chapterId, 3);
  await inJobTx((tx) => enqueueIngest(tx, A.workspaceId, A.chapterId));
  const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
  expect((await doIngest(token, ij as Claimed)).status).toBe(200);
});

const snapshot = async (id: string) => {
  const j = await jobRow(id);
  const ledger = await db.select().from(usageLedger).where(eq(usageLedger.jobId, id));
  return { j: { ...j, updatedAt: null }, ledger: ledger.length };
};

describe("worker fencing", () => {
  it("rejects wrong lease_token / stale attempt / other token on every fenced call, without writes", async () => {
    const j = await claimPrepare();
    const before = await snapshot(j.id);
    const variants: [string, string, { lease_token: string; attempt: number }][] = [
      ["wrong token", token, { ...fence(j), lease_token: "x".repeat(48) }],
      ["old attempt", token, { ...fence(j), attempt: j.attempt - 1 || 99 }],
      ["other worker", otherToken, fence(j)],
    ];
    for (const [label, tk, f] of variants) {
      const calls = [
        wcall(tk, `/jobs/${j.id}/heartbeat`, { ...f, progress: 0.5, stage: "x", usage: usage(1) }),
        wcall(tk, `/jobs/${j.id}/presign-outputs`, { ...f, names: ["clean"] }),
        wcall(tk, `/jobs/${j.id}/complete`, {
          ...f,
          result: { type: "page.prepare", clean_rev: 1, mask_rev: 1, ocr_result: OCR },
          usage: usage(2),
          pipeline_version: VERSION,
        }),
        wcall(tk, `/jobs/${j.id}/fail`, {
          ...f,
          error_class: "internal",
          retry_after_s: null,
          message: "x",
          usage: usage(3),
          partial: null,
        }),
      ];
      for (const res of await Promise.all(calls)) expect(res.status, label).toBe(409);
    }
    expect(await snapshot(j.id)).toEqual(before);
    // Lease đúng vẫn hoạt động.
    expect((await doPrepare(token, j)).status).toBe(200);
  });

  it("complete twice with the same lease → one ledger set, second is a no-op", async () => {
    const j = await claimPrepare();
    const r1 = await doPrepare(token, j, usage(5));
    expect(r1.status).toBe(200);
    const after1 = await db.select().from(usageLedger).where(eq(usageLedger.jobId, j.id));
    const r2 = await doPrepare(token, j, usage(5));
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { duplicate: boolean }).duplicate).toBe(true);
    const after2 = await db.select().from(usageLedger).where(eq(usageLedger.jobId, j.id));
    expect(after2).toHaveLength(after1.length);
  });

  it("killed worker: lease expires → reaper requeues → new worker completes; zombie complete → 409, no writes", async () => {
    const zombie = await claimPrepare();
    await expireLease(zombie.id);
    // Lease hết hạn nhưng reaper chưa chạy → vẫn 409.
    expect(
      (
        await wcall(token, `/jobs/${zombie.id}/heartbeat`, {
          ...fence(zombie),
          progress: 0.1,
          stage: null,
          usage: null,
        })
      ).status,
    ).toBe(409);
    // Reaper là toàn cục (file test khác có thể quét trước) → kiểm trạng thái dòng thay vì số đếm.
    await reapExpiredLeases();
    const requeued = await jobRow(zombie.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.leaseToken).toBeNull();
    expect(requeued.attempts).toBe(1);

    const fresh = await claimPrepare();
    expect(fresh.id).toBe(zombie.id);
    expect(fresh.attempt).toBe(zombie.attempt + 1);
    expect(fresh.outputs.clean?.rev).not.toBe(zombie.outputs.clean?.rev);
    expect((await doPrepare(token, fresh)).status).toBe(200);
    const [pg] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, fresh.payload.page_id as string));
    const ledgerBefore = await db.select().from(usageLedger).where(eq(usageLedger.jobId, zombie.id));

    const late = await complete(
      token,
      zombie,
      {
        type: "page.prepare",
        clean_rev: zombie.outputs.clean?.rev ?? 0,
        mask_rev: zombie.outputs.mask?.rev ?? 0,
        ocr_result: OCR,
      },
      usage(9),
    );
    expect(late.status).toBe(409);
    const [pgAfter] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, fresh.payload.page_id as string));
    expect(pgAfter?.cleanRev).toBe(pg?.cleanRev);
    expect(await db.select().from(usageLedger).where(eq(usageLedger.jobId, zombie.id))).toHaveLength(
      ledgerBefore.length,
    );
  });

  it("output rev must be the one granted at claim", async () => {
    // Mọi page đã prepare; tạo job reinpaint để kiểm rev (không cần pipeline thật).
    const [pg] = await db.select().from(pages).where(eq(pages.chapterId, A.chapterId)).limit(1);
    const [row] = await db
      .insert(jobs)
      .values({
        workspaceId: A.workspaceId,
        type: "page.reinpaint",
        payload: {
          type: "page.reinpaint",
          page_id: pg?.id as string,
          base_clean_rev: pg?.cleanRev ?? 0,
          user_mask_key: `ws/${A.workspaceId}/pg/${pg?.id}/user-mask/m.png`,
          offset: { x: 0, y: 0 },
        },
        inputRev: "r",
        idempotencyKey: `reinpaint-${pg?.id}`,
        pageId: pg?.id,
        chapterId: A.chapterId,
      })
      .returning();
    const [j] = await claimJobs(token, { caps: ["page.reinpaint"] });
    expect(j?.id).toBe(row?.id);
    const res = await complete(token, j as Claimed, {
      type: "page.reinpaint",
      clean_rev: (j?.outputs.clean?.rev ?? 0) + 100,
    });
    expect(res.status).toBe(400);
    expect((await failJob(token, j as Claimed, "invalid_input")).status).toBe(200);
    expect((await jobRow(j?.id as string)).status).toBe("failed");
  });
});
