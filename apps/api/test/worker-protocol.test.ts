/**
 * Luồng đầy đủ qua HTTP: commit → chapter.ingest → page.prepare × 40 (song song) → chapter.translate → review.
 * Worker giả lập gọi đúng giao thức (fencing, presigned PUT thật vào MinIO).
 */
import { chapters, jobs, pageStates, usageLedger } from "@mtl/db";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { enqueueIngest, inJobTx, retranslate } from "../src/jobs/enqueue.ts";
import { call, db, seedWorkspace } from "./helpers.ts";
import {
  addSources,
  claimJobs,
  doIngest,
  doPrepare,
  doTranslate,
  pageRows,
  translateIfPrepared,
  usage,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;
let token: string;
const N = 40;

beforeAll(async () => {
  A = await seedWorkspace("proto");
  token = (await workerToken(A.workspaceId)).token;
  await addSources(A.workspaceId, A.chapterId, N);
});

async function progress() {
  const res = await call(`/api/w/${A.workspaceId}/chapters/${A.chapterId}/progress`, { cookie: A.cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    chapter: { status: string };
    counts: Record<string, number>;
    pages: { id: string; status: string; job: { type: string; status: string } | null }[];
  };
}

describe("worker protocol end-to-end", () => {
  it("rejects missing/invalid worker tokens", async () => {
    const res = await call("/worker/v1/claim", { method: "POST", body: {}, headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it(`processes a ${N}-slice chapter to review with 0 stuck jobs`, async () => {
    const { job: ingest, created } = await inJobTx((tx) => enqueueIngest(tx, A.workspaceId, A.chapterId));
    expect(created).toBe(true);
    expect((await progress()).chapter.status).toBe("ingesting");

    const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
    expect(ij?.id).toBe(ingest.id);
    expect((ij?.inputs as { sources?: unknown[] } | undefined)?.sources).toHaveLength(N);
    const ir = await doIngest(token, ij as NonNullable<typeof ij>);
    expect(ir.status, await ir.clone().text()).toBe(200);

    let p = await progress();
    expect(p.chapter.status).toBe("processing");
    expect(p.pages).toHaveLength(N);
    expect(p.counts.pending).toBe(N);

    // Giai đoạn 1 song song: 2 worker (cùng token) claim theo lô.
    let done = 0;
    let seq = 1;
    while (done < N) {
      const batch = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
      if (batch.length === 0) break;
      const results = await Promise.all(batch.map((j) => doPrepare(token, j, usage(seq++))));
      for (const r of results) expect(r.status).toBe(200);
      done += batch.length;
    }
    expect(done).toBe(N);

    // Xong bước 1: chương dừng chờ "Dịch", chưa có chapter.translate; bấm Dịch → đúng 1 job.
    p = await progress();
    expect(p.counts.prepared).toBe(N);
    expect(p.chapter.status).toBe("prepared");
    const before = await db.select().from(jobs).where(eq(jobs.chapterId, A.chapterId));
    expect(before.filter((j) => j.type === "chapter.translate")).toHaveLength(0);
    await translateIfPrepared(A.chapterId);
    const translates = await db.select().from(jobs).where(eq(jobs.chapterId, A.chapterId));
    expect(translates.filter((j) => j.type === "chapter.translate")).toHaveLength(1);

    const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(tj?.payload.context).toBe("rolling");
    expect((tj?.inputs as { pages?: unknown[] } | undefined)?.pages).toHaveLength(N);
    const tr = await doTranslate(token, tj as NonNullable<typeof tj>);
    expect(tr.status, await tr.clone().text()).toBe(200);

    p = await progress();
    expect(p.chapter.status).toBe("review");
    expect(p.counts.ready).toBe(N);
    const stuck = await db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ["queued", "running"]));
    expect(stuck.filter((j) => j.workspaceId === A.workspaceId)).toEqual([]);

    const states = await db.select().from(pageStates).where(eq(pageStates.workspaceId, A.workspaceId));
    expect(
      states.every((s) => s.aiRev === 1 && s.version === 1 && s.state?.regions[0]?.translation === "Xin chào"),
    ).toBe(true);
    const ledger = await db.select().from(usageLedger).where(eq(usageLedger.workspaceId, A.workspaceId));
    expect(ledger.filter((l) => l.kind === "pages")).toHaveLength(N);
    expect(ledger.filter((l) => l.kind === "llm_tokens_in")).toHaveLength(N);
  });

  it("re-running translate on a hand-edited page keeps state and flags ai_update_available", async () => {
    const [first] = await pageRows(A.chapterId);
    if (!first) throw new Error("no pages");
    const [before] = await db.select().from(pageStates).where(eq(pageStates.pageId, first.id));
    const edited = { ...(before?.state as NonNullable<NonNullable<typeof before>["state"]>) };
    edited.regions = edited.regions.map((r) => ({ ...r, translation: "Bản sửa tay" }));
    await db
      .update(pageStates)
      .set({ state: edited, stateOrigin: "user", version: (before?.version ?? 0) + 1 })
      .where(eq(pageStates.pageId, first.id));

    await inJobTx((tx) => retranslate(tx, A.workspaceId, A.chapterId, [first.id]));
    const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(tj?.payload.context).toBe("neighbors");
    expect((await doTranslate(token, tj as NonNullable<typeof tj>, "Bản AI mới")).status).toBe(200);

    const [after] = await db.select().from(pageStates).where(eq(pageStates.pageId, first.id));
    expect(after?.state?.regions[0]?.translation).toBe("Bản sửa tay");
    expect(after?.aiState?.regions[0]?.translation).toBe("Bản AI mới");
    expect(after?.aiUpdateAvailable).toBe(true);
    expect(after?.version).toBe((before?.version ?? 0) + 2);
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, A.chapterId));
    expect(ch?.status).toBe("review");
  });

  it("blocks re-ingest once a page has user edits → 409", async () => {
    const res = await inJobTx((tx) => enqueueIngest(tx, A.workspaceId, A.chapterId)).catch((e: unknown) => e);
    expect((res as { status?: number }).status).toBe(409);
  });
});
