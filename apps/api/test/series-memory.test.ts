/**
 * Trí nhớ series: carry cuối lượt dịch cả chương làm ngữ cảnh mở đầu chương khác; thuật ngữ / xưng hô AI học được
 * thành gợi ý chờ duyệt (lọc, khử trùng, trần) và route đọc / Bỏ.
 */
import { chapters, glossaryEntries, jobs, pages, scoped, series, seriesSuggestions } from "@mtl/db";
import { type JobResult, type LearnedPronoun, type LearnedTerm, type TranslateMemory, termKey } from "@mtl/shared";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { memoryCarry } from "../src/lib/series-memory.ts";
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
  failJob,
  translateIfPrepared,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type TranslateOut = Extract<JobResult, { type: "chapter.translate" }>;
type Extras = Partial<Pick<TranslateOut, "carry" | "new_terms" | "pronoun_pairs">>;

let token: string;
beforeAll(async () => {
  token = (await workerToken("mac")).token;
});
beforeEach(cancelActiveJobs);

const CARRY = { notes: "Minjun là bạn của Hana", characters: ["Minjun", "Hana"] };
const MEMORY: TranslateMemory = { ...CARRY, source_lang: "ko", target_lang: "vi" };

/** Chương `pageCount` trang: ingest giả → prepare xong hết (lượt dịch cả chương bật từ lúc ingest). */
async function prepared(S: Seed, chapterId: string, pageCount: number) {
  await addSources(S.userId, chapterId, pageCount);
  await inJobTx((tx) => enqueueIngest(tx, S.userId, chapterId, undefined, "translated"));
  const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
  expect((await doIngest(token, ij as Claimed)).status).toBe(200);
  for (const j of await claimJobs(token, { caps: ["page.prepare"], max: 8 })) {
    expect((await doPrepare(token, j)).status).toBe(200);
  }
}

async function addChapter(S: Seed, number: string) {
  return (await scoped(db, S.userId).insert(chapters, { seriesId: S.seriesId, number })).id;
}

function translateResult(j: Claimed, extras: Extras = {}): TranslateOut {
  const ins = j.inputs as { pages: { page_id: string; width: number; height: number }[] };
  return {
    type: "chapter.translate",
    pages: ins.pages.map((p) => ({ page_id: p.page_id, ai_state: aiState(p.width, p.height) })),
    ...extras,
  };
}

/** Dịch hết các lô còn chờ; `extras(i)` là phần result thêm của lô thứ i. Trả payload từng lô. */
async function translateAll(extras: (i: number) => Extras = () => ({})) {
  const payloads: Claimed["payload"][] = [];
  for (let i = 0; ; i++) {
    const [j] = await claimJobs(token, { caps: ["chapter.translate"] });
    if (!j) return payloads;
    payloads.push(j.payload);
    const res = await complete(token, j, translateResult(j, extras(i)));
    expect(res.status, await res.clone().text()).toBe(200);
  }
}

async function memoryOf(chapterId: string) {
  const [row] = await db.select({ m: chapters.translateMemory }).from(chapters).where(eq(chapters.id, chapterId));
  return row?.m ?? null;
}

const term = (source: string, target: string, kind: LearnedTerm["kind"] = "person"): LearnedTerm => ({
  source,
  target,
  kind,
});
const pair = (speaker: string, listener: string, address = "anh/em"): LearnedPronoun => ({
  speaker,
  listener,
  address,
});

async function suggestions(S: Seed) {
  const res = await call(`/api/series/${S.seriesId}/suggestions`, { cookie: S.cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    terms: { id: string; source: string; target: string; kind: string; chapter_number: string | null }[];
    pronouns: { id: string; speaker: string; listener: string; address: string; chapter_number: string | null }[];
  };
}

const rowsOf = (seriesId: string) =>
  db.select().from(seriesSuggestions).where(eq(seriesSuggestions.seriesId, seriesId));

describe("series memory", () => {
  it("full run on chapter 1 writes translate_memory with the language pair", async () => {
    const S = await seedUser("mem-full");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ carry: CARRY }));
    expect(await memoryOf(S.chapterId)).toEqual(MEMORY);
  });

  it("full retranslate through the route writes memory too", async () => {
    const S = await seedUser("mem-retranslate");
    await prepared(S, S.chapterId, 2);
    await translateAll();
    expect(await memoryOf(S.chapterId)).toBeNull();
    const res = await call(`/api/chapters/${S.chapterId}/translate`, { method: "POST", cookie: S.cookie, body: {} });
    expect(res.status).toBe(202);
    await translateAll(() => ({ carry: CARRY }));
    expect(await memoryOf(S.chapterId)).toEqual(MEMORY);
  });

  it("partial retranslate does not overwrite memory", async () => {
    const S = await seedUser("mem-partial");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ carry: CARRY }));
    const [first] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.chapterId, S.chapterId))
      .orderBy(pages.ord);
    const res = await call(`/api/chapters/${S.chapterId}/translate`, {
      method: "POST",
      cookie: S.cookie,
      body: { page_ids: [first?.id] },
    });
    expect(res.status).toBe(202);
    await translateAll(() => ({ carry: { notes: "ghi chú một phần", characters: ["X"] } }));
    expect(await memoryOf(S.chapterId)).toEqual(MEMORY);
  });

  it("memory is written only when a full run closes", async () => {
    const S = await seedUser("mem-last-batch");
    await prepared(S, S.chapterId, 6);
    await translateAll(() => ({ carry: CARRY }));
    expect(await memoryOf(S.chapterId)).toEqual(MEMORY);
    const res = await call(`/api/chapters/${S.chapterId}/translate`, { method: "POST", cookie: S.cookie, body: {} });
    expect(res.status).toBe(202);
    const fresh = { notes: "lượt mới", characters: ["Seo"] };
    const [first] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect((await complete(token, first as Claimed, translateResult(first as Claimed, { carry: fresh }))).status).toBe(
      200,
    );
    expect(await memoryOf(S.chapterId)).toEqual(MEMORY);
    await translateAll(() => ({ carry: fresh }));
    expect(await memoryOf(S.chapterId)).toEqual({ ...fresh, source_lang: "ko", target_lang: "vi" });
  });

  it("default flow with a page failed at step 1 still writes memory after the last batch", async () => {
    const S = await seedUser("mem-prepared-flow");
    await addSources(S.userId, S.chapterId, 3);
    await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId, undefined, "prepared"));
    const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
    expect((await doIngest(token, ij as Claimed)).status).toBe(200);
    const prep = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
    expect(prep).toHaveLength(3);
    for (const [i, j] of prep.entries()) {
      const res = i === 0 ? await failJob(token, j, "invalid_input") : await doPrepare(token, j);
      expect(res.status).toBe(200);
    }
    expect(await translateIfPrepared(S.chapterId)).not.toBeNull();
    await translateAll(() => ({ carry: CARRY }));
    expect(await memoryOf(S.chapterId)).toEqual(MEMORY);
  });

  it("writes memory when the last batch finishes before a page fails at step 1", async () => {
    const S = await seedUser("mem-late-step1-failure");
    await addSources(S.userId, S.chapterId, 6);
    await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId, undefined, "translated"));
    const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
    expect((await doIngest(token, ij as Claimed)).status).toBe(200);
    const prep = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
    expect(prep).toHaveLength(6);
    const translateNext = async () => {
      const [j] = await claimJobs(token, { caps: ["chapter.translate"] });
      expect(j).toBeDefined();
      return j as Claimed;
    };
    expect((await doPrepare(token, prep[0] as Claimed)).status).toBe(200);
    const lot1 = await translateNext();
    for (const j of prep.slice(1, 5)) expect((await doPrepare(token, j)).status).toBe(200);
    expect((await complete(token, lot1, translateResult(lot1, { carry: CARRY }))).status).toBe(200);
    const lot2 = await translateNext();
    expect((lot2.inputs as { pages: unknown[] }).pages).toHaveLength(4);
    expect((await complete(token, lot2, translateResult(lot2, { carry: CARRY }))).status).toBe(200);
    expect(await memoryOf(S.chapterId)).toBeNull();
    expect((await failJob(token, prep[5] as Claimed, "invalid_input")).status).toBe(200);
    expect(await memoryOf(S.chapterId)).toEqual(MEMORY);
    const [ch] = await db.select({ t: chapters.runTarget }).from(chapters).where(eq(chapters.id, S.chapterId));
    expect(ch?.t).toBeNull();
  });

  it("a run stopped by cancelling the next batch does not write memory", async () => {
    const S = await seedUser("mem-cancel");
    await prepared(S, S.chapterId, 6);
    const [lot1] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect((await complete(token, lot1 as Claimed, translateResult(lot1 as Claimed, { carry: CARRY }))).status).toBe(
      200,
    );
    const [lot2] = await claimJobs(token, { caps: ["chapter.translate"] });
    const res = await call(`/api/jobs/${(lot2 as Claimed).id}/cancel`, { method: "POST", cookie: S.cookie });
    expect(res.status).toBe(200);
    expect(await memoryOf(S.chapterId)).toBeNull();
  });

  it("a run stopped by the daily quota does not write memory", async () => {
    const S = await seedUser("mem-quota");
    await prepared(S, S.chapterId, 6);
    const [lot1] = await claimJobs(token, { caps: ["chapter.translate"] });
    const prev = env.USER_DAILY_USD;
    try {
      env.USER_DAILY_USD = 0;
      expect((await complete(token, lot1 as Claimed, translateResult(lot1 as Claimed, { carry: CARRY }))).status).toBe(
        200,
      );
    } finally {
      env.USER_DAILY_USD = prev;
    }
    expect(await memoryOf(S.chapterId)).toBeNull();
  });

  it("first batch of chapter 2 starts from chapter 1 memory", async () => {
    const S = await seedUser("mem-next-chapter");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ carry: CARRY }));
    const ch2 = await addChapter(S, "2");
    await prepared(S, ch2, 2);
    const [lot1] = await translateAll();
    expect(lot1?.carry).toEqual(CARRY);
  });

  it("next batch uses the run carry, not memory", async () => {
    const S = await seedUser("mem-run-carry");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ carry: CARRY }));
    const ch2 = await addChapter(S, "2");
    await prepared(S, ch2, 5);
    const runCarry = { notes: "carry của lượt này", characters: ["Seo"] };
    const payloads = await translateAll((i) => (i === 0 ? { carry: runCarry } : {}));
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    expect(payloads[0]?.carry).toEqual(CARRY);
    expect(payloads[1]?.carry).toEqual(runCarry);
  });

  it("picks the nearest lower chapter, else the nearest higher, never itself", async () => {
    const S = await seedUser("mem-nearest");
    const sdb = scoped(db, S.userId);
    const memo = (tag: string): TranslateMemory => ({ ...MEMORY, notes: tag });
    const make = async (number: string, tag?: string) =>
      sdb.insert(chapters, { seriesId: S.seriesId, number, ...(tag ? { translateMemory: memo(tag) } : {}) });
    await db
      .update(chapters)
      .set({ translateMemory: memo("c1") })
      .where(eq(chapters.id, S.chapterId));
    await make("3", "c3");
    await make("5", "c5");
    const c4 = await make("4");
    const c10 = await make("10");
    const c05 = await make("0.5");
    const [s] = await db.select().from(series).where(eq(series.id, S.seriesId));
    const notes = async (ch: typeof c4) => (await memoryCarry(db, ch, s as typeof series.$inferSelect))?.notes;
    expect(await notes(c4)).toBe("c3");
    // 10 > 5 theo số (so chuỗi sẽ chọn nhầm).
    expect(await notes(c10)).toBe("c5");
    expect(await notes(c05)).toBe("c1");
    const [c3] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.seriesId, S.seriesId), eq(chapters.number, "3")));
    expect(await notes(c3 as typeof c4)).toBe("c1");
    const carry = await memoryCarry(db, c4, s as typeof series.$inferSelect);
    expect(carry).toEqual({ notes: "c3", characters: CARRY.characters });
  });

  it("memory of another language pair is ignored", async () => {
    const S = await seedUser("mem-lang");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ carry: CARRY }));
    await db.update(series).set({ targetLang: "en" }).where(eq(series.id, S.seriesId));
    const ch2 = await addChapter(S, "2");
    await prepared(S, ch2, 2);
    const [lot1] = await translateAll();
    expect(lot1?.carry).toBeUndefined();
  });
});

describe("series suggestions", () => {
  it("old worker result without new keys completes and stores nothing", async () => {
    const S = await seedUser("sug-old");
    await prepared(S, S.chapterId, 2);
    await translateAll();
    expect(await rowsOf(S.seriesId)).toHaveLength(0);
    expect(await suggestions(S)).toEqual({ terms: [], pronouns: [] });
  });

  it("suggestions skip glossary, shared pair glossary, rules, identical and '?' (ASCII and full-width)", async () => {
    const S = await seedUser("sug-filter");
    const sdb = scoped(db, S.userId);
    await sdb.insert(glossaryEntries, {
      seriesId: S.seriesId,
      sourceLang: "ko",
      targetLang: "vi",
      sourceTerm: "검",
      targetTerm: "kiếm",
    });
    await sdb.insert(glossaryEntries, {
      sourceLang: "ko",
      targetLang: "vi",
      sourceTerm: "마법",
      targetTerm: "ma pháp",
    });
    // Glossary chung của cặp ngôn ngữ khác không che gợi ý.
    await sdb.insert(glossaryEntries, { sourceLang: "ja", targetLang: "vi", sourceTerm: "城", targetTerm: "thành" });
    await db
      .update(series)
      .set({ pronounRules: [{ speaker: "Minjun", listener: "Hana", address: "anh/em", note: "" }] })
      .where(eq(series.id, S.seriesId));
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({
      new_terms: [
        term("검", "kiếm"),
        term(" 마법 ", "phép"),
        term("Seoul", "seoul", "place"),
        term("   ", "x"),
        term("城", "thành", "place"),
        term("민준", "Minjun"),
        term("민 준", "Min Jun"),
        term("민준", "Min-jun"),
      ],
      pronoun_pairs: [
        pair("MINJUN", "hana"),
        pair("?", "Hana"),
        pair("？", "Hana"),
        pair("Hana", "？"),
        pair("Hana", "Minjun", "？"),
        pair("Hana", "Hana"),
        pair("Hana", "Minjun", "em/anh"),
        pair("Hana", "Minjun", "Em / Anh"),
      ],
    }));
    const got = await suggestions(S);
    expect(got.terms.map((t) => [t.source, t.target, t.kind, t.chapter_number])).toEqual([
      ["城", "thành", "place", "1"],
      ["민 준", "Min Jun", "person", "1"],
      ["민준", "Minjun", "person", "1"],
    ]);
    expect(got.pronouns.map((p) => [p.speaker, p.listener, p.address])).toEqual([["Hana", "Minjun", "em/anh"]]);
  });

  it("duplicate across chapters and dismissed never come back", async () => {
    const S = await seedUser("sug-dismiss");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("민준", "Minjun")], pronoun_pairs: [pair("Hana", "Minjun")] }));
    let got = await suggestions(S);
    expect(got.terms).toHaveLength(1);
    expect(got.pronouns).toHaveLength(1);
    for (const id of [got.terms[0]?.id, got.pronouns[0]?.id]) {
      const res = await call(`/api/series-suggestions/${id}`, {
        method: "PATCH",
        cookie: S.cookie,
        body: { dismissed: true },
      });
      expect(res.status).toBe(200);
    }
    const ch2 = await addChapter(S, "2");
    await prepared(S, ch2, 2);
    await translateAll(() => ({ new_terms: [term("민준", "Minjun")], pronoun_pairs: [pair("hana", "minjun")] }));
    got = await suggestions(S);
    expect(got).toEqual({ terms: [], pronouns: [] });
    expect(await rowsOf(S.seriesId)).toHaveLength(2);
  });

  it("accepting via glossary POST / series PATCH hides the suggestion", async () => {
    const S = await seedUser("sug-accept");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({
      new_terms: [term("Minjun Kim", "Kim Minjun"), term("Seoul", "Seul", "place")],
      pronoun_pairs: [pair("Hana", "Minjun"), pair("Minjun", "Hana", "em/anh")],
    }));
    expect((await suggestions(S)).terms).toHaveLength(2);
    const post = await call(`/api/series/${S.seriesId}/glossary`, {
      method: "POST",
      cookie: S.cookie,
      body: { source_term: "minjun kim", target_term: "Kim Minjun" },
    });
    expect(post.status, await post.clone().text()).toBeLessThan(300);
    const patch = await call(`/api/series/${S.seriesId}`, {
      method: "PATCH",
      cookie: S.cookie,
      body: { pronoun_rules: [{ speaker: "hana", listener: "MINJUN", address: "em/anh" }] },
    });
    expect(patch.status, await patch.clone().text()).toBe(200);
    const got = await suggestions(S);
    expect(got.terms.map((t) => t.source)).toEqual(["Seoul"]);
    expect(got.pronouns.map((p) => [p.speaker, p.listener])).toEqual([["Minjun", "Hana"]]);
  });

  it("pending cap per kind", async () => {
    const S = await seedUser("sug-cap");
    await db.insert(seriesSuggestions).values(
      Array.from({ length: 200 }, (_, i) => ({
        userId: S.userId,
        seriesId: S.seriesId,
        kind: "term" as const,
        key: termKey(`용${i}`),
        data: term(`용${i}`, `rồng ${i}`),
      })),
    );
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("신규", "mới")], pronoun_pairs: [pair("Hana", "Minjun")] }));
    const rows = await rowsOf(S.seriesId);
    expect(rows.filter((r) => r.kind === "term")).toHaveLength(200);
    expect(rows.some((r) => r.key === termKey("신규"))).toBe(false);
    expect(rows.filter((r) => r.kind === "pronoun")).toHaveLength(1);
    // Bỏ bớt một gợi ý thì còn chỗ cho gợi ý mới.
    await db
      .update(seriesSuggestions)
      .set({ dismissedAt: new Date() })
      .where(and(eq(seriesSuggestions.seriesId, S.seriesId), eq(seriesSuggestions.key, termKey("용0"))));
    const ch2 = await addChapter(S, "2");
    await prepared(S, ch2, 2);
    await translateAll(() => ({ new_terms: [term("신규", "mới")] }));
    expect((await rowsOf(S.seriesId)).some((r) => r.key === termKey("신규"))).toBe(true);
  });

  it("accepting a suggestion frees a slot under the cap", async () => {
    const S = await seedUser("sug-cap-accept");
    await db.insert(seriesSuggestions).values(
      Array.from({ length: 200 }, (_, i) => ({
        userId: S.userId,
        seriesId: S.seriesId,
        kind: "term" as const,
        key: termKey(`용${i}`),
        data: term(`용${i}`, `rồng ${i}`),
      })),
    );
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("신규", "mới")] }));
    expect((await rowsOf(S.seriesId)).some((r) => r.key === termKey("신규"))).toBe(false);
    const post = await call(`/api/series/${S.seriesId}/glossary`, {
      method: "POST",
      cookie: S.cookie,
      body: { source_term: "용0", target_term: "rồng 0" },
    });
    expect(post.status, await post.clone().text()).toBeLessThan(300);
    const ch2 = await addChapter(S, "2");
    await prepared(S, ch2, 2);
    await translateAll(() => ({ new_terms: [term("신규", "mới")] }));
    expect((await rowsOf(S.seriesId)).some((r) => r.key === termKey("신규"))).toBe(true);
  });

  it("an already known dismissed key does not take the last free slot", async () => {
    const S = await seedUser("sug-cap-known");
    await db.insert(seriesSuggestions).values([
      ...Array.from({ length: 199 }, (_, i) => ({
        userId: S.userId,
        seriesId: S.seriesId,
        kind: "term" as const,
        key: termKey(`용${i}`),
        data: term(`용${i}`, `rồng ${i}`),
      })),
      {
        userId: S.userId,
        seriesId: S.seriesId,
        kind: "term" as const,
        key: termKey("옛"),
        data: term("옛", "cũ"),
        dismissedAt: new Date(),
      },
    ]);
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("옛", "cũ"), term("신규", "mới")] }));
    const rows = await rowsOf(S.seriesId);
    expect(rows.some((r) => r.key === termKey("신규"))).toBe(true);
    expect(rows.filter((r) => r.kind === "term")).toHaveLength(201);
  });

  it("PATCH dismissed true/false toggles visibility", async () => {
    const S = await seedUser("sug-toggle");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("민준", "Minjun")] }));
    const id = (await suggestions(S)).terms[0]?.id;
    const patch = (dismissed: boolean) =>
      call(`/api/series-suggestions/${id}`, { method: "PATCH", cookie: S.cookie, body: { dismissed } });
    const off = await patch(true);
    expect(await off.json()).toEqual({ id, dismissed: true });
    expect((await suggestions(S)).terms).toHaveLength(0);
    const on = await patch(false);
    expect(await on.json()).toEqual({ id, dismissed: false });
    expect((await suggestions(S)).terms).toHaveLength(1);
    expect((await patch("x" as unknown as boolean)).status).toBe(400);
  });

  it("deleted source chapter leaves chapter_number null", async () => {
    const S = await seedUser("sug-orphan");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("민준", "Minjun")] }));
    await db.delete(jobs).where(eq(jobs.chapterId, S.chapterId));
    await db
      .update(seriesSuggestions)
      .set({ chapterId: "00000000-0000-7000-8000-000000000000" })
      .where(eq(seriesSuggestions.seriesId, S.seriesId));
    expect((await suggestions(S)).terms[0]?.chapter_number).toBeNull();
  });
});
