/** Huỷ job / input hỏng / ingest lại khi còn job: chương không bao giờ kẹt `processing`/`ingesting`. */
import { chapters, jobs, pages } from "@mtl/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enqueueIngest, enqueueReinpaint, inJobTx } from "../src/jobs/enqueue.ts";
import { cancelJob } from "../src/jobs/queue.ts";
import { retranslate } from "../src/jobs/translate-chain.ts";
import { db, seedUser } from "./helpers.ts";
import {
  addSources,
  type Claimed,
  claimJobs,
  doIngest,
  doPrepare,
  doTranslate,
  failJob,
  jobRow,
  pageRows,
  translateIfPrepared,
  workerToken,
} from "./worker-helpers.ts";

async function ingested(label: string, n: number) {
  const S = await seedUser(label);
  const token = (await workerToken("mac")).token;
  await addSources(S.userId, S.chapterId, n);
  await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
  const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
  expect((await doIngest(token, ij as Claimed)).status).toBe(200);
  return { S, token };
}

const chapterStatus = async (id: string) => (await db.select().from(chapters).where(eq(chapters.id, id)))[0]?.status;

describe("cancel paths", () => {
  it("cancelling an unclaimed ingest returns the chapter to draft", async () => {
    const S = await seedUser("cing");
    await addSources(S.userId, S.chapterId, 1);
    const { job } = await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
    await cancelJob(S.userId, job.id);
    expect(await chapterStatus(S.chapterId)).toBe("draft");
  });

  it("cancelling the last page.prepare leaves the prepared pages waiting for Dịch, not stuck processing", async () => {
    const { S, token } = await ingested("cprep", 2);
    const [a] = await claimJobs(token, { caps: ["page.prepare"] });
    expect((await doPrepare(token, a as Claimed)).status).toBe(200);
    const queued = (await db.select().from(jobs).where(eq(jobs.chapterId, S.chapterId))).find(
      (j) => j.type === "page.prepare" && j.status === "queued",
    );
    expect(queued).toBeDefined();
    await cancelJob(S.userId, queued?.id as string);
    expect(await chapterStatus(S.chapterId)).toBe("prepared");
    await translateIfPrepared(S.chapterId);
    const [t] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(t).toBeDefined();
    expect((await doTranslate(token, t as Claimed)).status).toBe(200);
    expect(await chapterStatus(S.chapterId)).toBe("partial_failed");
  });

  it("cancelling an unclaimed translate does not leave the chapter processing", async () => {
    const { S, token } = await ingested("ctr", 1);
    const [a] = await claimJobs(token, { caps: ["page.prepare"] });
    expect((await doPrepare(token, a as Claimed)).status).toBe(200);
    await translateIfPrepared(S.chapterId);
    const tr = (await db.select().from(jobs).where(eq(jobs.chapterId, S.chapterId))).find(
      (j) => j.type === "chapter.translate",
    );
    await cancelJob(S.userId, tr?.id as string);
    // Trang chưa từng được dịch: không phải lỗi, về `prepared` chờ "Dịch" lại.
    expect(await chapterStatus(S.chapterId)).toBe("prepared");
    expect((await pageRows(S.chapterId))[0]?.status).toBe("prepared");
  });

  it("a failed re-translate keeps previously translated pages ready", async () => {
    const { S, token } = await ingested("crtr", 1);
    const [a] = await claimJobs(token, { caps: ["page.prepare"] });
    await doPrepare(token, a as Claimed);
    await translateIfPrepared(S.chapterId);
    const [t] = await claimJobs(token, { caps: ["chapter.translate"] });
    await doTranslate(token, t as Claimed);
    const [pg] = await pageRows(S.chapterId);
    await inJobTx((tx) => retranslate(tx, S.userId, S.chapterId, [pg?.id as string]));
    const [t2] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect((await failJob(token, t2 as Claimed, "invalid_input")).status).toBe(200);
    expect((await pageRows(S.chapterId))[0]?.status).toBe("ready");
    expect(await chapterStatus(S.chapterId)).toBe("review");
  });
});

describe("recovery", () => {
  it("a job whose inputs cannot be built is failed at claim instead of blocking the queue", async () => {
    const { S, token } = await ingested("cbad", 1);
    const [a] = await claimJobs(token, { caps: ["page.prepare"] });
    await doPrepare(token, a as Claimed);
    const [pg] = await pageRows(S.chapterId);
    // Job hỏng: base_clean_rev hợp lệ nhưng key mask thuộc người dùng khác (chèn thẳng, bỏ qua kiểm ở enqueue).
    const [bad] = await db
      .insert(jobs)
      .values({
        userId: S.userId,
        type: "page.reinpaint",
        payload: {
          type: "page.reinpaint",
          page_id: pg?.id as string,
          base_clean_rev: pg?.cleanRev ?? 0,
          user_mask_key: "ws/other/pg/x/user-mask/m.png",
          offset: { x: 0, y: 0 },
        },
        inputRev: "r",
        idempotencyKey: `bad-${pg?.id}`,
        pageId: pg?.id,
        chapterId: S.chapterId,
        priority: 0,
      })
      .returning();
    expect(await claimJobs(token, { caps: ["page.reinpaint"] })).toEqual([]);
    const row = await jobRow(bad?.id as string);
    expect(row.status).toBe("failed");
    expect(row.errorClass).toBe("invalid_input");
  });

  it("enqueueReinpaint rejects a mask key outside the page", async () => {
    const { S } = await ingested("cmask", 1);
    const [pg] = await pageRows(S.chapterId);
    const err = await inJobTx((tx) =>
      enqueueReinpaint(tx, S.userId, {
        type: "page.reinpaint",
        page_id: pg?.id as string,
        base_clean_rev: 0,
        user_mask_key: `u/${S.userId}/pg/other/user-mask/m.png`,
        offset: { x: 0, y: 0 },
      }),
    ).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(400);
  });

  it("re-ingest while page jobs are active → 409 chapter_busy", async () => {
    const { S } = await ingested("cbusy", 2);
    const err = await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId)).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(409);
    expect((await db.select().from(pages).where(eq(pages.chapterId, S.chapterId))).length).toBe(2);
  });
});
