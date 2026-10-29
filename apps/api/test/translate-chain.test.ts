/**
 * Dịch theo chuỗi job lô (≤ 4 trang, ≤ 40 khối): lô đầu chạy ngay khi có trang prepared, lô kế enqueue khi lô trước
 * xong/lỗi; lô lỗi hẳn không chặn chuỗi; huỷ dừng chuỗi; advance lặp / đồng thời chỉ tạo 1 job; ngữ cảnh `carry` từ
 * result lô trước sang payload lô sau.
 */
import { chapters, jobs, pages, series } from "@mtl/db";
import type { OcrResult } from "@mtl/shared";
import { ACTIVE_JOB_STATUSES, DEFAULT_PIPELINE_SETTINGS } from "@mtl/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { advanceTranslateChain, planBatches, type RunTarget, regionCount } from "../src/jobs/translate-chain.ts";
import { call, db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import {
  addSources,
  aiState,
  type Claimed,
  claimJobs,
  complete,
  doIngest,
  doPrepare,
  doTranslate,
  failJob,
  OCR,
  PNG_1PX,
  pageRows,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type TranslatePayload = { page_ids: string[]; context: string; carry?: unknown };

const N = 9;
let token: string;

beforeAll(async () => {
  token = (await workerToken("mac")).token;
});
// Worker chung: job còn lại của ca trước không được lọt vào claim của ca sau.
beforeEach(cancelActiveJobs);

/** Chương N trang đã ingest; mọi page.prepare đã claim sẵn (giữ `running`), `prep[i]` là job của trang thứ i. */
async function ingested(label: string, opts: { target?: RunTarget; manga?: boolean } = {}) {
  const S = await seedUser(label);
  await addSources(S.userId, S.chapterId, N);
  if (opts.manga) await db.update(series).set({ pageFormat: "pages" }).where(eq(series.id, S.seriesId));
  await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId, undefined, opts.target));
  const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
  expect((await doIngest(token, ij as Claimed)).status).toBe(200);
  const ids = (await pageRows(S.chapterId)).map((p) => p.id);
  // Claim tối đa 8 job/lần.
  const claimed = [
    ...(await claimJobs(token, { caps: ["page.prepare"], max: 8 })),
    ...(await claimJobs(token, { caps: ["page.prepare"], max: 8 })),
  ];
  expect(claimed).toHaveLength(N);
  const prep = ids.map((id) => claimed.find((j) => j.payload.page_id === id) as Claimed);
  return { S, ids, prep };
}

async function prepare(prep: Claimed[], idx: number[]) {
  for (const i of idx) expect((await doPrepare(token, prep[i] as Claimed)).status).toBe(200);
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

async function translateJobs(chapterId: string, active = true) {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.chapterId, chapterId),
        eq(jobs.type, "chapter.translate"),
        active ? inArray(jobs.status, [...ACTIVE_JOB_STATUSES]) : undefined,
      ),
    )
    .orderBy(jobs.createdAt);
  return rows.map((j) => ({ ...j, p: j.payload as unknown as TranslatePayload }));
}

async function chapterRow(id: string) {
  const [ch] = await db.select().from(chapters).where(eq(chapters.id, id));
  if (!ch) throw new Error("chapter missing");
  return ch;
}

async function claimTranslate() {
  const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
  if (!tj) throw new Error("no translate job to claim");
  return tj;
}

/** Chương đã prepare hết (target prepared) rồi tự bật lượt dịch trong DB — chưa có job dịch nào. */
async function armedRun(label: string) {
  const { S, ids, prep } = await ingested(label, { target: "prepared" });
  await prepare(prep, range(0, N));
  await db
    .update(chapters)
    .set({ runTarget: "translated", runStartedAt: sql`now()`, runTotal: N })
    .where(eq(chapters.id, S.chapterId));
  await db.update(pages).set({ translateQueued: true }).where(eq(pages.chapterId, S.chapterId));
  return { S, ids };
}

const api = (S: Seed, path: string, body?: unknown) =>
  call(`/api/chapters/${S.chapterId}${path}`, { method: "POST", cookie: S.cookie, body });

/**
 * Chương manga 2 ảnh upload thật qua API (commit kiểm HEAD + magic bytes), OCR local (paddle, $0) → bản thân Bước 1
 * không cần hạn mức. Trả chương chưa commit.
 */
async function uploadedMangaChapter(label: string) {
  const S = await seedUser(label);
  await db.update(series).set({ pageFormat: "pages" }).where(eq(series.id, S.seriesId));
  const ocr = { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "paddle_ocr" };
  const put = await call("/api/settings/pipeline", {
    method: "PUT",
    cookie: S.cookie,
    body: { pipeline: { ...DEFAULT_PIPELINE_SETTINGS, ocr_engines: ocr } },
  });
  expect(put.status, await put.clone().text()).toBe(200);
  const files = [1, 2].map((i) => ({ name: `${i}.png`, content_type: "image/png", bytes: PNG_1PX.length }));
  const res = await call("/api/chapters", {
    method: "POST",
    cookie: S.cookie,
    body: { series_id: S.seriesId, number: "2", files },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const created = (await res.json()) as {
    chapter: { id: string };
    files: { url: string; fields: Record<string, string> }[];
  };
  for (const f of created.files) {
    const form = new FormData();
    for (const [k, v] of Object.entries(f.fields)) form.append(k, v);
    form.append("file", new Blob([PNG_1PX]));
    expect((await fetch(f.url, { method: "POST", body: form })).status).toBe(204);
  }
  return { ...S, chapterId: created.chapter.id };
}

describe("translate chain", () => {
  it("planBatches matches make_batches", () => {
    const pg = (n: number, r: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, regions: r }));
    const lens = (b: { id: string }[][]) => b.map((x) => x.length);
    expect(lens(planBatches(pg(6, 1)))).toEqual([4, 2]);
    expect(lens(planBatches(pg(10, 3)))).toEqual([4, 4, 2]);
    expect(lens(planBatches(pg(5, 15)))).toEqual([2, 2, 1]);
    expect(lens(planBatches(pg(3, 15)))).toEqual([2, 1]);
    const big = [
      { id: "a", regions: 1 },
      { id: "b", regions: 41 },
      { id: "c", regions: 1 },
    ];
    expect(planBatches(big).map((b) => b.map((p) => p.id))).toEqual([["a"], ["b"], ["c"]]);
    // Trang 0 khối đi kèm lô, không tính vào trần 4 trang.
    const withEmpty = ["a", "z", "b", "c", "d", "e"].map((id) => ({ id, regions: id === "z" ? 0 : 1 }));
    expect(planBatches(withEmpty).map((b) => b.map((p) => p.id))).toEqual([["a", "z", "b", "c", "d"], ["e"]]);
    expect(planBatches([])).toEqual([]);

    const ocr: OcrResult = {
      ...OCR,
      items: [
        ...OCR.items,
        { id: "s", source: "쾅", is_sfx: true, empty: false, confidence: 0.9, low_conf: false },
        { id: "e", source: "x", is_sfx: false, empty: true, confidence: 0.9, low_conf: false },
        { id: "w", source: "  ", is_sfx: false, empty: false, confidence: 0.9, low_conf: false },
      ],
    };
    expect(regionCount(ocr)).toBe(1);
    expect(regionCount(null)).toBe(0);
  });

  it("first batch starts as soon as one page is prepared", async () => {
    const { S, ids, prep } = await ingested("chain-first", { target: "translated" });
    expect(await translateJobs(S.chapterId)).toHaveLength(0);
    await prepare(prep, [0]);
    const [first, ...rest] = await translateJobs(S.chapterId);
    expect(rest).toHaveLength(0);
    expect(first?.p.page_ids).toEqual([ids[0]]);
    expect(first?.priority).toBe(50);
    expect(first?.p.context).toBe("rolling");
    await prepare(prep, range(1, N));
    const after = await translateJobs(S.chapterId);
    expect(after.map((j) => j.id)).toEqual([first?.id]);
    expect((await chapterRow(S.chapterId)).status).toBe("processing");
  });

  it("chain advances batch by batch in page order", async () => {
    const { S, ids, prep } = await ingested("chain-advance", { target: "translated" });
    await prepare(prep, range(0, N));
    expect((await doTranslate(token, await claimTranslate())).status).toBe(200);

    const [second] = await translateJobs(S.chapterId);
    expect(second?.p.page_ids).toEqual(ids.slice(1, 5));
    expect(second?.p.context).toBe("neighbors");
    expect(second?.status).toBe("queued");
    // Trang lô 1 xong trong khi lô 2 còn chờ.
    const p0 = (await pageRows(S.chapterId))[0];
    expect(p0?.status).toBe("ready");
    expect(p0?.translateQueued).toBe(false);

    const res = await call(`/api/chapters/${S.chapterId}/progress`, { cookie: S.cookie });
    const prog = (await res.json()) as {
      chapter: { run: { target: string; total: number; remaining: number; batch: number; batches: number } | null };
      pages: { id: string; translate_queued: boolean; run_batch: number | null }[];
    };
    expect(prog.chapter.run).toEqual({ target: "translated", total: N, remaining: 8, batch: 2, batches: 3 });
    expect(prog.pages.map((p) => p.run_batch)).toEqual([null, 2, 2, 2, 2, 3, 3, 3, 3]);
    expect(prog.pages.map((p) => p.translate_queued)).toEqual([false, ...Array(8).fill(true)]);

    expect((await doTranslate(token, await claimTranslate())).status).toBe(200);
    const [third] = await translateJobs(S.chapterId);
    expect(third?.p.page_ids).toEqual(ids.slice(5, 9));
    expect((await doTranslate(token, await claimTranslate())).status).toBe(200);

    const ch = await chapterRow(S.chapterId);
    expect(ch.status).toBe("review");
    expect(ch.runTarget).toBeNull();
    expect(await translateJobs(S.chapterId, false)).toHaveLength(3);
    expect((await pageRows(S.chapterId)).every((p) => p.status === "ready" && !p.translateQueued)).toBe(true);
  });

  it("a later batch waits to fill while pages are still in step 1", async () => {
    const { S, ids, prep } = await ingested("chain-wait", { target: "translated" });
    await prepare(prep, [0]);
    const lot1 = await claimTranslate();
    await prepare(prep, [1, 2]);
    expect((await doTranslate(token, lot1)).status).toBe(200);
    expect(await translateJobs(S.chapterId)).toHaveLength(0);
    await prepare(prep, [3]);
    expect(await translateJobs(S.chapterId)).toHaveLength(0);
    await prepare(prep, [4]);
    const [lot2] = await translateJobs(S.chapterId);
    expect(lot2?.p.page_ids).toEqual(ids.slice(1, 5));
    expect((await chapterRow(S.chapterId)).status).toBe("processing");
  });

  it("a failed batch does not stop the chain", async () => {
    for (const variant of ["invalid_input", "provider"] as const) {
      const { S, ids, prep } = await ingested(`chain-fail-${variant}`, { target: "translated" });
      await prepare(prep, range(0, N));
      expect((await doTranslate(token, await claimTranslate())).status).toBe(200);
      if (variant === "provider") {
        // Hết lượt thử lại provider: lần lỗi kế là lỗi hẳn.
        await db
          .update(jobs)
          .set({ providerRetries: 20 })
          .where(and(eq(jobs.chapterId, S.chapterId), eq(jobs.status, "queued")));
      }
      const lot2 = await claimTranslate();
      expect(lot2.payload.page_ids).toEqual(ids.slice(1, 5));
      expect((await failJob(token, lot2, variant)).status).toBe(200);

      const rows = await pageRows(S.chapterId);
      expect(rows.slice(1, 5).every((p) => p.status === "failed" && !p.translateQueued)).toBe(true);
      expect(rows[0]?.status).toBe("ready");
      const [lot3] = await translateJobs(S.chapterId);
      expect(lot3?.p.page_ids).toEqual(ids.slice(5, 9));
      expect((await doTranslate(token, await claimTranslate())).status).toBe(200);
      const ch = await chapterRow(S.chapterId);
      expect(ch.status).toBe("partial_failed");
      expect(ch.runTarget).toBeNull();
    }
  });

  it("carry from the previous batch result goes into the next payload", async () => {
    const { S, prep } = await ingested("chain-carry", { target: "translated" });
    await prepare(prep, range(0, N));
    // Worker chưa hiểu `carry` không được nhận job.
    await expect(claimJobs(token, { caps: ["chapter.translate"], version: "0.6.0" })).rejects.toThrow(/claim 426/);
    const lot1 = await claimTranslate();
    expect(lot1.payload.carry).toBeUndefined();
    const carry = { notes: "Minjun = Min-jun", characters: ["Minjun"] };
    const ins = lot1.inputs as { pages: { page_id: string; width: number; height: number }[] };
    const res = await complete(token, lot1, {
      type: "chapter.translate",
      pages: ins.pages.map((p) => ({ page_id: p.page_id, ai_state: aiState(p.width, p.height) })),
      carry,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const [lot2] = await translateJobs(S.chapterId);
    expect(lot2?.p.carry).toEqual(carry);
  });

  it("advance called twice in a row creates one job", async () => {
    const { S, ids } = await armedRun("chain-twice");
    const a = await inJobTx((tx) => advanceTranslateChain(tx, S.userId, S.chapterId));
    const b = await inJobTx((tx) => advanceTranslateChain(tx, S.userId, S.chapterId));
    expect(a?.id).toBeDefined();
    expect(b).toBeNull();
    const active = await translateJobs(S.chapterId);
    expect(active.map((j) => j.id)).toEqual([a?.id]);
    expect(active[0]?.p.page_ids).toEqual(ids.slice(0, 4));
  });

  it("concurrent advances create exactly one job", async () => {
    const { S } = await armedRun("chain-race");
    const out = await Promise.all(
      Array.from({ length: 5 }, () => inJobTx((tx) => advanceTranslateChain(tx, S.userId, S.chapterId))),
    );
    expect(out.filter((j) => j !== null)).toHaveLength(1);
    expect(await translateJobs(S.chapterId)).toHaveLength(1);
  });

  it("cancelling stops the chain", async () => {
    const { S, prep } = await ingested("chain-cancel", { target: "translated" });
    await prepare(prep, [0]);
    expect(await translateJobs(S.chapterId)).toHaveLength(1);
    expect((await api(S, "/cancel", {})).status).toBe(200);

    const ch = await chapterRow(S.chapterId);
    expect(ch.runTarget).toBeNull();
    expect((await pageRows(S.chapterId)).every((p) => !p.translateQueued)).toBe(true);
    // Worker còn cầm page.prepare đã bị huỷ: complete bị từ chối, không sinh job dịch.
    expect((await doPrepare(token, prep[1] as Claimed)).status).toBe(409);
    expect(await translateJobs(S.chapterId)).toHaveLength(0);
    expect((await chapterRow(S.chapterId)).status).not.toBe("processing");
  });

  it("step-1 failures are skipped by the frontier", async () => {
    const { S, ids, prep } = await ingested("chain-skip", { target: "translated" });
    expect((await failJob(token, prep[0] as Claimed, "invalid_input")).status).toBe(200);
    expect(await translateJobs(S.chapterId)).toHaveLength(0);
    await prepare(prep, [1]);
    const [lot1] = await translateJobs(S.chapterId);
    expect(lot1?.p.page_ids).toEqual([ids[1]]);
    expect((await pageRows(S.chapterId))[0]?.translateQueued).toBe(false);
  });

  it("progress says which pages have OCR, even when their last job is older than a day", async () => {
    const { S, prep } = await ingested("chain-ocr-ready", { target: "prepared" });
    expect((await failJob(token, prep[0] as Claimed, "invalid_input")).status).toBe(200);
    await prepare(prep, [1]);
    // Mọi job của chương cũ hơn 24h → progress không còn trả job nào cho trang.
    await db.update(jobs).set({ updatedAt: sql`now() - interval '2 days'` }).where(eq(jobs.chapterId, S.chapterId));
    const res = await call(`/api/chapters/${S.chapterId}/progress`, { cookie: S.cookie });
    const prog = (await res.json()) as { pages: { status: string; ocr_ready: boolean; job: unknown }[] };
    expect(prog.pages[0]).toMatchObject({ status: "failed", ocr_ready: false, job: null });
    expect(prog.pages[1]).toMatchObject({ status: "prepared", ocr_ready: true });
    expect(prog.pages[2]?.ocr_ready).toBe(false);
  });

  it("commit with target prepared stops at prepared", async () => {
    const { S, prep } = await ingested("chain-prepared", { target: "prepared" });
    await prepare(prep, range(0, N));
    const ch = await chapterRow(S.chapterId);
    expect(ch.status).toBe("prepared");
    expect(ch.runTarget).toBeNull();
    expect(await translateJobs(S.chapterId, false)).toHaveLength(0);
  });

  it("translating three selected pages translates only them", async () => {
    const { S, ids, prep } = await ingested("chain-select", { target: "prepared" });
    await prepare(prep, range(0, N));
    const picked = [ids[2], ids[5], ids[7]] as string[];
    expect((await api(S, "/translate", { page_ids: picked })).status).toBe(202);
    for (let i = 0; i < 5; i++) {
      const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
      if (!tj) break;
      expect((tj.payload.page_ids as string[]).every((id) => picked.includes(id))).toBe(true);
      expect((await doTranslate(token, tj)).status).toBe(200);
    }
    for (const j of await translateJobs(S.chapterId, false)) {
      expect(j.p.page_ids.every((id) => picked.includes(id))).toBe(true);
    }
    const rows = await pageRows(S.chapterId);
    expect(rows.filter((p) => p.status === "ready").map((p) => p.id)).toEqual(picked);
    expect(rows.filter((p) => !picked.includes(p.id)).every((p) => p.status === "prepared")).toBe(true);
    const ch = await chapterRow(S.chapterId);
    expect(ch.status).toBe("prepared");
    expect(ch.runTarget).toBeNull();
  });

  it("a second run while one is active is rejected", async () => {
    const { S, ids, prep } = await ingested("chain-409", { target: "prepared" });
    await prepare(prep, range(0, N));
    expect((await api(S, "/translate-prepared")).status).toBe(202);
    for (const body of [{ page_ids: [ids[0]] }, {}]) {
      const res = await api(S, "/translate", body);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe("translate_running");
    }
    expect(await translateJobs(S.chapterId)).toHaveLength(1);
  });

  it("manga commits default to the translated target", async () => {
    const { S, ids, prep } = await ingested("chain-manga", { manga: true });
    expect((await chapterRow(S.chapterId)).runTarget).toBe("translated");
    await prepare(prep, [0]);
    const [lot1] = await translateJobs(S.chapterId);
    expect(lot1?.p.page_ids).toEqual([ids[0]]);
  });

  it("an over-quota manga commit without a target runs step 1 and stops at prepared", async () => {
    const S = await uploadedMangaChapter("chain-quota-manga");
    const prev = env.USER_DAILY_USD;
    try {
      env.USER_DAILY_USD = 0;
      expect((await api(S, "/commit", {})).status).toBe(202);
      expect((await chapterRow(S.chapterId)).runTarget).toBe("prepared");
      const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
      expect((await doIngest(token, ij as Claimed)).status).toBe(200);
      const prep = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
      expect(prep).toHaveLength(2);
      for (const j of prep) expect((await doPrepare(token, j)).status).toBe(200);
      const ch = await chapterRow(S.chapterId);
      expect(ch.status).toBe("prepared");
      expect(ch.runTarget).toBeNull();
      expect(await translateJobs(S.chapterId, false)).toHaveLength(0);
    } finally {
      env.USER_DAILY_USD = prev;
    }
  });

  it("an over-quota commit asking for translated explicitly is rejected", async () => {
    const S = await uploadedMangaChapter("chain-quota-explicit");
    const prev = env.USER_DAILY_USD;
    try {
      env.USER_DAILY_USD = 0;
      const res = await api(S, "/commit", { target: "translated" });
      expect(res.status).toBe(402);
      expect((await chapterRow(S.chapterId)).status).toBe("draft");
    } finally {
      env.USER_DAILY_USD = prev;
    }
  });

  it("retranslating the first page alone keeps the next page as context", async () => {
    const { S, ids, prep } = await ingested("chain-lookahead", { target: "prepared" });
    await prepare(prep, range(0, N));
    expect((await api(S, "/translate", { page_ids: [ids[0]] })).status).toBe(202);
    const tj = await claimTranslate();
    expect(tj.payload.page_ids).toEqual([ids[0]]);
    expect(tj.payload.context).toBe("neighbors");
    expect((tj.inputs as { context_lines: unknown[] }).context_lines.length).toBeGreaterThan(0);
  });

  /** Chương manga: lô 1 `[p0]` đang chạy, lượt đã đóng vì người dùng huỷ page.prepare của p1; p2, p3 đã prepare. */
  async function staleBatch(label: string) {
    const { S, ids, prep } = await ingested(label, { manga: true });
    await prepare(prep, [0]);
    const lot1 = await claimTranslate();
    expect(lot1.payload.page_ids).toEqual([ids[0]]);
    const cancel = await call(`/api/jobs/${(prep[1] as Claimed).id}/cancel`, { method: "POST", cookie: S.cookie });
    expect(cancel.status).toBe(200);
    expect((await chapterRow(S.chapterId)).runTarget).toBeNull();
    await prepare(prep, [2, 3]);
    return { S, lot1, picked: [ids[0], ids[2], ids[3]] as string[] };
  }

  async function expectTranslateRunning(res: Response) {
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("translate_running");
  }

  it("a new run waits until the previous run's batch has finished", async () => {
    const { S, lot1, picked } = await staleBatch("chain-stale-complete");
    await expectTranslateRunning(await api(S, "/translate", { page_ids: picked }));
    expect((await doTranslate(token, lot1)).status).toBe(200);
    // Lô cũ xong rồi mới mở lượt: trang của lô cũ vẫn nằm trong lượt mới và được dịch lại.
    expect((await api(S, "/translate", { page_ids: picked })).status).toBe(202);
    const [lot] = await translateJobs(S.chapterId);
    expect(lot?.p.page_ids).toEqual(picked);
    expect((await pageRows(S.chapterId)).filter((p) => p.translateQueued).map((p) => p.id)).toEqual(picked);
  });

  it("no run starts while a batch of the previous run is still active", async () => {
    const { S, lot1, picked } = await staleBatch("chain-stale-cancel");
    await expectTranslateRunning(await api(S, "/translate", { page_ids: picked }));
    await expectTranslateRunning(await api(S, "/translate", {}));
    await expectTranslateRunning(await api(S, "/retry-failed"));
    expect(await translateJobs(S.chapterId)).toHaveLength(1);
    // Huỷ lô cũ xong mới mở lượt mới → lượt mới không bị huỷ lây.
    const cancel = await call(`/api/jobs/${lot1.id}/cancel`, { method: "POST", cookie: S.cookie });
    expect(cancel.status).toBe(200);
    expect((await api(S, "/translate", { page_ids: picked })).status).toBe(202);
    expect((await chapterRow(S.chapterId)).runTarget).toBe("translated");
    const [lot] = await translateJobs(S.chapterId);
    expect(lot?.p.page_ids).toEqual(picked);
  });

  it("over-quota while the next batch waits keeps its pages prepared", async () => {
    const { S, ids, prep } = await ingested("chain-quota-queued", { target: "translated" });
    await prepare(prep, range(0, N));
    expect((await doTranslate(token, await claimTranslate())).status).toBe(200);
    const [lot2] = await translateJobs(S.chapterId);
    expect(lot2?.p.page_ids).toEqual(ids.slice(1, 5));
    const prev = env.USER_DAILY_USD;
    try {
      env.USER_DAILY_USD = 0;
      // Claim của worker bỏ job LLM đang chờ của người vượt hạn mức.
      await claimJobs(token, { caps: ["chapter.translate"] });
      expect((await translateJobs(S.chapterId, false)).find((j) => j.id === lot2?.id)?.status).toBe("failed");
      const rows = await pageRows(S.chapterId);
      expect(rows[0]?.status).toBe("ready");
      expect(rows.slice(1).map((p) => p.status)).toEqual(Array(N - 1).fill("prepared"));
      expect(rows.every((p) => !p.translateQueued)).toBe(true);
      const ch = await chapterRow(S.chapterId);
      expect(ch.status).toBe("prepared");
      expect(ch.runTarget).toBeNull();
    } finally {
      env.USER_DAILY_USD = prev;
    }
  });

  it("cancelling a running batch leaves its pages untranslated, not failed", async () => {
    const { S, ids, prep } = await ingested("chain-cancel-running", { target: "translated" });
    await prepare(prep, range(0, N));
    const lot1 = await claimTranslate();
    expect((await pageRows(S.chapterId))[0]?.status).toBe("translating");
    const cancel = await call(`/api/jobs/${lot1.id}/cancel`, { method: "POST", cookie: S.cookie });
    expect(cancel.status).toBe(200);
    const rows = await pageRows(S.chapterId);
    expect(rows[0]?.id).toBe(ids[0]);
    expect(rows.map((p) => p.status)).toEqual(Array(N).fill("prepared"));
    const ch = await chapterRow(S.chapterId);
    expect(ch.status).toBe("prepared");
    expect(ch.runTarget).toBeNull();
  });

  it("over-quota stops the chain", async () => {
    const { S, ids, prep } = await ingested("chain-quota", { target: "translated" });
    await prepare(prep, range(0, N));
    const lot1 = await claimTranslate();
    const prev = env.USER_DAILY_USD;
    try {
      env.USER_DAILY_USD = 0;
      expect((await doTranslate(token, lot1)).status).toBe(200);
      expect(await translateJobs(S.chapterId)).toHaveLength(0);
      const ch = await chapterRow(S.chapterId);
      expect(ch.runTarget).toBeNull();
      expect(ch.status).toBe("prepared");
      const rows = await pageRows(S.chapterId);
      expect(rows[0]?.id).toBe(ids[0]);
      expect(rows[0]?.status).toBe("ready");
      expect(rows.slice(1).every((p) => p.status === "prepared" && !p.translateQueued)).toBe(true);
    } finally {
      env.USER_DAILY_USD = prev;
    }
  });
});
