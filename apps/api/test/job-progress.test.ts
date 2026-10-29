/**
 * Tiến độ đếm của job: heartbeat ghi `done/total` (ảnh/trang/đoạn đã xong của bước), màn chương đọc lại qua
 * `/progress`; về hàng đợi hoặc claim lại thì xoá số đếm cũ.
 */
import { jobs, runtimeFlags } from "@mtl/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { call, db, seedUser } from "./helpers.ts";
import {
  addSources,
  type Claimed,
  claimJobs,
  doIngest,
  failJob,
  fence,
  jobRow,
  makeRunnable,
  wcall,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type PageJob = { id: string; stage: string | null; progress_done: number | null; progress_total: number | null };

const clearBreaker = () => db.delete(runtimeFlags).where(sql`${runtimeFlags.key} in ('llm_paused', 'llm_errors')`);

beforeAll(clearBreaker);
afterAll(clearBreaker);

function heartbeat(token: string, j: Claimed, body: Record<string, unknown>) {
  return wcall(token, `/jobs/${j.id}/heartbeat`, { ...fence(j), progress: 0.5, stage: null, usage: null, ...body });
}

async function pageJob(S: Seed, jobId: string): Promise<PageJob | undefined> {
  const res = await call(`/api/chapters/${S.chapterId}/progress`, { cookie: S.cookie });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { pages: { job: PageJob | null }[] };
  return body.pages.find((p) => p.job?.id === jobId)?.job ?? undefined;
}

describe("job progress counts", () => {
  let S: Seed;
  let token: string;
  let j: Claimed;

  beforeAll(async () => {
    S = await seedUser("jobprog");
    token = (await workerToken("mac")).token;
    await addSources(S.userId, S.chapterId, 1);
    await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
    const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
    expect((await doIngest(token, ij as Claimed)).status).toBe(200);
    const [pj] = await claimJobs(token, { caps: ["page.prepare"] });
    if (!pj) throw new Error("no page.prepare to claim");
    j = pj;
  });

  it("heartbeat stores done/total and the progress view returns them", async () => {
    expect((await heartbeat(token, j, { stage: "upload", done: 3, total: 12 })).status).toBe(200);
    const view = await pageJob(S, j.id);
    expect(view?.stage).toBe("upload");
    expect(view?.progress_done).toBe(3);
    expect(view?.progress_total).toBe(12);
  });

  it("a heartbeat without counts clears them", async () => {
    expect((await heartbeat(token, j, { stage: "ocr" })).status).toBe(200);
    const view = await pageJob(S, j.id);
    expect(view?.stage).toBe("ocr");
    expect(view?.progress_done).toBeNull();
    expect(view?.progress_total).toBeNull();
  });

  it("requeue and a new claim reset the counts", async () => {
    expect((await heartbeat(token, j, { stage: "upload", done: 2, total: 4 })).status).toBe(200);
    expect((await failJob(token, j, "provider")).status).toBe(200);
    const queued = await jobRow(j.id);
    expect(queued.status).toBe("queued");
    expect(queued.progressDone).toBeNull();
    expect(queued.progressTotal).toBeNull();
    expect((await pageJob(S, j.id))?.progress_done).toBeNull();
    // Cột ghi tay (giả lập dữ liệu sót từ attempt trước) → claim mới phải xoá.
    await db.update(jobs).set({ progressDone: 1, progressTotal: 4 }).where(eq(jobs.id, j.id));
    await makeRunnable(eq(jobs.id, j.id));
    const [again] = await claimJobs(token, { caps: ["page.prepare"] });
    expect(again?.id).toBe(j.id);
    const running = await jobRow(j.id);
    expect(running.status).toBe("running");
    expect(running.progressDone).toBeNull();
    expect(running.progressTotal).toBeNull();
  });
});
