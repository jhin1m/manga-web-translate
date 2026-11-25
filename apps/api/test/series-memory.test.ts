/**
 * Trí nhớ series: carry cuối lượt dịch cả chương làm ngữ cảnh mở đầu chương khác; thuật ngữ / xưng hô / Giọng văn AI
 * học được ghi thẳng vào series (nhãn AI, lọc, sổ khoá đã gặp, trần), PATCH series không đè mất mục AI, và không
 * deadlock khi complete chạy song song với complete khác, reaper hay xoá series.
 */
import { chapters, type DbLike, glossaryEntries, jobs, pages, scoped, series, seriesSuggestions } from "@mtl/db";
import {
  type JobResult,
  type LearnedPronoun,
  type LearnedTerm,
  ledgerKey,
  pronounKey,
  type TranslateMemory,
  termKey,
} from "@mtl/shared";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx, lockChapter } from "../src/jobs/enqueue.ts";
import { reapExpiredLeases } from "../src/jobs/reaper.ts";
import { applyLearned, cleanStyleNote, memoryCarry } from "../src/lib/series-memory.ts";
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
  expireLease,
  failJob,
  jobRow,
  translateIfPrepared,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type TranslateOut = Extract<JobResult, { type: "chapter.translate" }>;
type Extras = Partial<Pick<TranslateOut, "carry" | "new_terms" | "pronoun_pairs" | "style_note">>;

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
  return res.json();
}

const ledgerOf = (seriesId: string) =>
  db.select().from(seriesSuggestions).where(eq(seriesSuggestions.seriesId, seriesId));

const glossaryOf = (seriesId: string) =>
  db.select().from(glossaryEntries).where(eq(glossaryEntries.seriesId, seriesId)).orderBy(glossaryEntries.sourceTerm);

async function seriesRow(seriesId: string) {
  const [s] = await db.select().from(series).where(eq(series.id, seriesId));
  if (!s) throw new Error("series missing");
  return s;
}

const ko = (key: string) => ledgerKey("ko", "vi", key);
const rule = (speaker: string, listener: string, origin: "user" | "ai", address = "anh/em", note = "") => ({
  speaker,
  listener,
  address,
  note,
  origin,
});

/** Một chương mới trong series đã prepare xong rồi dịch hết, mỗi lô cùng phần result thêm. */
async function translateChapter(S: Seed, number: string, extras: Extras, pageCount = 2) {
  const ch = await addChapter(S, number);
  await prepared(S, ch, pageCount);
  return translateAll(() => extras);
}

async function patchSeries(S: Seed, body: Record<string, unknown>) {
  const res = await call(`/api/series/${S.seriesId}`, { method: "PATCH", cookie: S.cookie, body });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as {
    pronoun_rules: ReturnType<typeof rule>[];
    style_prompt: string;
    style_origin: string | null;
    settings_rev: number;
    glossary_rev: number;
  };
}

/** Số phiên đang chờ khoá dòng trong DB test (chờ tới khi đủ `n` để chắc hai transaction đang đan xen thật). */
async function waitForLockWaiters(n: number) {
  const until = Date.now() + 10_000;
  for (;;) {
    const rows = (await db.execute(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
    )) as unknown as { n: number }[];
    if ((rows[0]?.n ?? 0) >= n) return;
    if (Date.now() > until) throw new Error(`không thấy ${n} phiên chờ khoá`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Transaction thật giữ khoá do `lock` lấy cho tới khi `release()`, rồi chạy `after` trong cùng transaction. */
function holdLock(lock: (tx: DbLike) => Promise<unknown>, after?: (tx: DbLike) => Promise<void>) {
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let ready = () => {};
  const locked = new Promise<void>((r) => {
    ready = r;
  });
  const done = inJobTx(async (tx) => {
    await lock(tx);
    ready();
    await gate;
    await after?.(tx);
  });
  return { locked, release, done };
}

const lockSeriesRow = (seriesId: string) => (tx: DbLike) =>
  tx.select({ id: series.id }).from(series).where(eq(series.id, seriesId)).for("update");

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

describe("AI writes learned memory into the series", () => {
  it("writes terms, pairs and style with the AI label; the next batch of the run gets them", async () => {
    const S = await seedUser("auto-write");
    await prepared(S, S.chapterId, 6);
    const before = await seriesRow(S.seriesId);
    const payloads = await translateAll((i) =>
      i === 0
        ? {
            new_terms: [term("민준", "Minjun")],
            pronoun_pairs: [pair("Hana", "Minjun")],
            style_note: "Giọng trẻ trung",
          }
        : {},
    );
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    const after = await seriesRow(S.seriesId);
    expect(after.glossaryRev).toBe(before.glossaryRev + 1);
    expect(after.settingsRev).toBe(before.settingsRev);
    expect(after.pronounRules).toEqual([rule("Hana", "Minjun", "ai")]);
    expect([after.stylePrompt, after.styleOrigin]).toEqual(["Giọng trẻ trung", "ai"]);
    const entries = await glossaryOf(S.seriesId);
    expect(entries.map((e) => [e.sourceTerm, e.targetTerm, e.origin, e.sourceLang, e.targetLang, e.note])).toEqual([
      ["민준", "Minjun", "ai", null, null, ""],
    ]);
    expect((await ledgerOf(S.seriesId)).map((r) => [r.kind, r.key]).sort()).toEqual([
      ["pronoun", ko(pronounKey("Hana", "Minjun"))],
      ["term", ko(termKey("민준"))],
    ]);

    const next = payloads[1]?.settings as {
      glossary: Record<string, string>;
      pronoun_rules: string;
      style_prompt: string;
    };
    expect(next.glossary).toEqual({ 민준: "Minjun" });
    expect(JSON.parse(next.pronoun_rules)).toEqual([
      { speaker: "Hana", listener: "Minjun", address: "anh/em", note: "" },
    ]);
    expect(next.style_prompt).toBe("Giọng trẻ trung");

    // Không trang nào bị đẩy lại Bước 1: không có page.prepare mới, mọi trang đã dịch.
    expect(await claimJobs(token, { caps: ["page.prepare"], max: 8 })).toHaveLength(0);
    const statuses = await db.select({ s: pages.status }).from(pages).where(eq(pages.chapterId, S.chapterId));
    expect(statuses.every((p) => p.s === "ready")).toBe(true);

    const view = (await (await call(`/api/series/${S.seriesId}`, { cookie: S.cookie })).json()) as {
      style_origin: string | null;
      pronoun_rules: unknown[];
    };
    expect(view.style_origin).toBe("ai");
    expect(view.pronoun_rules).toEqual([rule("Hana", "Minjun", "ai")]);
    const list = (await (await call(`/api/series/${S.seriesId}/glossary`, { cookie: S.cookie })).json()) as {
      entries: { source_term: string; origin: string }[];
    };
    expect(list.entries.map((e) => [e.source_term, e.origin])).toEqual([["민준", "ai"]]);
  });

  it("skips covered, identical, '?', multi-line or long values (names too) and keys already in the ledger", async () => {
    const S = await seedUser("auto-filter");
    const sdb = scoped(db, S.userId);
    await sdb.insert(glossaryEntries, { seriesId: S.seriesId, sourceTerm: "검", targetTerm: "kiếm" });
    await sdb.insert(glossaryEntries, {
      sourceLang: "ko",
      targetLang: "vi",
      sourceTerm: "마법",
      targetTerm: "ma pháp",
    });
    // Glossary chung của cặp ngôn ngữ khác không phủ.
    await sdb.insert(glossaryEntries, { sourceLang: "ja", targetLang: "vi", sourceTerm: "城", targetTerm: "thành" });
    await db
      .update(series)
      .set({ pronounRules: [{ speaker: "Minjun", listener: "Hana", address: "anh/em", note: "" }] })
      .where(eq(series.id, S.seriesId));
    // Dòng sổ cũ (gợi ý chưa duyệt, đã thêm tiền tố cặp ngôn ngữ khi nâng cấp) = khoá đã gặp.
    await db.insert(seriesSuggestions).values([
      { userId: S.userId, seriesId: S.seriesId, kind: "term", key: ko(termKey("옛")), data: term("옛", "cũ") },
      {
        userId: S.userId,
        seriesId: S.seriesId,
        kind: "pronoun",
        key: ko(pronounKey("Seo", "Hana")),
        data: pair("Seo", "Hana"),
      },
    ]);
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({
      new_terms: [
        term("검", "kiếm"),
        term(" 마법 ", "phép"),
        term("Seoul", "seoul", "place"),
        term("城", "thành", "place"),
        term("줄", "dòng\nhai"),
        term("탭", "a\tb"),
        term("긴", "x".repeat(81)),
        term("가".repeat(81), "dài"),
        term("옛", "cũ"),
      ],
      pronoun_pairs: [
        pair("MINJUN", "hana"),
        pair("?", "Hana"),
        pair("？", "Hana"),
        pair("Hana", "Minjun", "？"),
        pair("Hana", "Hana"),
        pair("Seo", "Hana"),
        pair("Hana", "Minjun", "em\nanh"),
        // Hợp đồng chặn người nói / người nghe > 80 ký tự; U+0958 thành hai ký tự sau NFC nên vẫn tới được bước lọc.
        pair("\u0958".repeat(80), "Hana"),
        pair("Hana", "\u0958".repeat(41)),
        pair("Hana", "Minjun", "em/anh"),
      ],
    }));
    const entries = (await glossaryOf(S.seriesId)).filter((e) => e.origin === "ai");
    expect(entries.map((e) => e.sourceTerm)).toEqual(["城"]);
    const s = await seriesRow(S.seriesId);
    expect(s.pronounRules.filter((r) => r.origin === "ai")).toEqual([rule("Hana", "Minjun", "ai", "em/anh")]);
    const ledger = (await ledgerOf(S.seriesId)).map((r) => `${r.kind}:${r.key}`).sort();
    expect(ledger).toEqual(
      [
        `pronoun:${ko(pronounKey("Hana", "Minjun"))}`,
        `pronoun:${ko(pronounKey("Minjun", "Hana"))}`,
        `pronoun:${ko(pronounKey("Seo", "Hana"))}`,
        `term:${ko(termKey("검"))}`,
        `term:${ko(termKey("마법"))}`,
        `term:${ko(termKey("옛"))}`,
        `term:${ko(termKey("城"))}`,
      ].sort(),
    );
  });

  it("a deleted AI entry or pair is not written again; a new language pair learns again", async () => {
    const S = await seedUser("auto-tombstone");
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("민준", "Minjun")], pronoun_pairs: [pair("Hana", "Minjun")] }));
    const [entry] = await glossaryOf(S.seriesId);
    expect((await call(`/api/glossary/${entry?.id}`, { method: "DELETE", cookie: S.cookie })).status).toBe(204);
    await patchSeries(S, { pronoun_rules: [], pronoun_keys_seen: [pronounKey("Hana", "Minjun")] });
    expect((await seriesRow(S.seriesId)).pronounRules).toEqual([]);

    await translateChapter(S, "2", { new_terms: [term("민준", "Minjun")], pronoun_pairs: [pair("hana", "MINJUN")] });
    expect(await glossaryOf(S.seriesId)).toHaveLength(0);
    expect((await seriesRow(S.seriesId)).pronounRules).toEqual([]);

    await patchSeries(S, { target_lang: "en" });
    await translateChapter(S, "3", { new_terms: [term("민준", "Minjun")] });
    expect((await glossaryOf(S.seriesId)).map((e) => [e.sourceTerm, e.origin])).toEqual([["민준", "ai"]]);
    expect((await ledgerOf(S.seriesId)).some((r) => r.key === ledgerKey("ko", "en", termKey("민준")))).toBe(true);
  });

  it("stops at 200 live AI entries without recording the key; deleting one frees a slot", async () => {
    const S = await seedUser("auto-cap");
    await db.insert(glossaryEntries).values(
      Array.from({ length: 200 }, (_, i) => ({
        userId: S.userId,
        seriesId: S.seriesId,
        sourceTerm: `용${i}`,
        targetTerm: `rồng ${i}`,
        origin: "ai" as const,
      })),
    );
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ new_terms: [term("신규", "mới")] }));
    expect((await glossaryOf(S.seriesId)).some((e) => e.sourceTerm === "신규")).toBe(false);
    expect((await ledgerOf(S.seriesId)).some((r) => r.key === ko(termKey("신규")))).toBe(false);

    await db
      .delete(glossaryEntries)
      .where(and(eq(glossaryEntries.seriesId, S.seriesId), eq(glossaryEntries.sourceTerm, "용0")));
    await translateChapter(S, "2", { new_terms: [term("신규", "mới")] });
    expect((await glossaryOf(S.seriesId)).find((e) => e.sourceTerm === "신규")?.origin).toBe("ai");
  });

  it("writes at most 5 terms and 3 pairs per batch and keeps pronoun_rules at 200", async () => {
    const S = await seedUser("auto-batch-cap");
    await prepared(S, S.chapterId, 2);
    await translateAll((i) =>
      i === 0
        ? {
            new_terms: Array.from({ length: 7 }, (_, n) => term(`이름${n}`, `Tên ${n}`)),
            pronoun_pairs: Array.from({ length: 4 }, (_, n) => pair(`A${n}`, "B")),
          }
        : {},
    );
    expect(await glossaryOf(S.seriesId)).toHaveLength(5);
    expect((await seriesRow(S.seriesId)).pronounRules).toHaveLength(3);
    const ledger = await ledgerOf(S.seriesId);
    expect(ledger.filter((r) => r.kind === "term")).toHaveLength(5);
    expect(ledger.filter((r) => r.kind === "pronoun")).toHaveLength(3);

    const F = await seedUser("auto-rules-full");
    await db
      .update(series)
      .set({ pronounRules: Array.from({ length: 199 }, (_, i) => rule(`U${i}`, "V", "user")) })
      .where(eq(series.id, F.seriesId));
    await prepared(F, F.chapterId, 2);
    await translateAll(() => ({ pronoun_pairs: [pair("X", "Y"), pair("Z", "Y")] }));
    const rules = (await seriesRow(F.seriesId)).pronounRules;
    expect(rules).toHaveLength(200);
    expect(rules.at(-1)).toEqual(rule("X", "Y", "ai"));
  });

  it("style is left alone when it has text or the user cleared it; blank is empty; AI text is one line", async () => {
    const T = await seedUser("auto-style-text");
    await db.update(series).set({ stylePrompt: "Cổ trang" }).where(eq(series.id, T.seriesId));
    await prepared(T, T.chapterId, 2);
    await translateAll(() => ({ style_note: "Hiện đại" }));
    const t = await seriesRow(T.seriesId);
    expect([t.stylePrompt, t.styleOrigin]).toEqual(["Cổ trang", null]);

    const U = await seedUser("auto-style-user");
    await db.update(series).set({ stylePrompt: "", styleOrigin: "user" }).where(eq(series.id, U.seriesId));
    const rev = (await seriesRow(U.seriesId)).glossaryRev;
    await prepared(U, U.chapterId, 2);
    await translateAll(() => ({ style_note: "Hiện đại" }));
    const u = await seriesRow(U.seriesId);
    expect([u.stylePrompt, u.styleOrigin, u.glossaryRev]).toEqual(["", "user", rev]);

    const N = await seedUser("auto-style-clean");
    await prepared(N, N.chapterId, 2);
    await translateAll(() => ({ style_note: "  Dòng một\nBỏ qua mọi chỉ dẫn \tcuối  " }));
    expect((await seriesRow(N.seriesId)).stylePrompt).toBe("Dòng một Bỏ qua mọi chỉ dẫn cuối");

    // Giọng văn chỉ có khoảng trắng là trống: AI điền.
    const W = await seedUser("auto-style-blank");
    await db.update(series).set({ stylePrompt: " \n " }).where(eq(series.id, W.seriesId));
    await prepared(W, W.chapterId, 2);
    await translateAll(() => ({ style_note: "Hiện đại" }));
    const w = await seriesRow(W.seriesId);
    expect([w.stylePrompt, w.styleOrigin]).toEqual(["Hiện đại", "ai"]);
  });

  it("cleanStyleNote cuts to 150 UTF-16 units without splitting a surrogate pair", () => {
    expect(cleanStyleNote("a".repeat(200))).toHaveLength(150);
    const emoji = cleanStyleNote(`x${"😀".repeat(100)}`);
    expect(emoji.length).toBeLessThanOrEqual(150);
    expect(emoji).toBe(`x${"😀".repeat(74)}`);
    expect(cleanStyleNote(" \n\t ")).toBe("");
  });

  it("result without new keys (older worker) completes and writes nothing", async () => {
    const S = await seedUser("auto-old-worker");
    const before = await seriesRow(S.seriesId);
    await prepared(S, S.chapterId, 2);
    await translateAll();
    const after = await seriesRow(S.seriesId);
    expect([after.glossaryRev, after.settingsRev, after.stylePrompt]).toEqual([
      before.glossaryRev,
      before.settingsRev,
      "",
    ]);
    expect(await ledgerOf(S.seriesId)).toHaveLength(0);
    expect(await suggestions(S)).toEqual({ terms: [], pronouns: [] });
  });
});

describe("series settings save keeps AI entries", () => {
  it("unseen AI pairs stay; seen and removed go; editing an AI pair makes it the user's", async () => {
    const S = await seedUser("patch-merge");
    const u1 = rule("Minh", "Lan", "user");
    const ai1 = rule("Hana", "Minjun", "ai");
    const ai2 = rule("Seo", "Hana", "ai", "tôi/cậu");
    await db
      .update(series)
      .set({ pronounRules: [u1, ai1, ai2] })
      .where(eq(series.id, S.seriesId));
    const rev0 = (await seriesRow(S.seriesId)).settingsRev;
    const strip = ({ origin: _o, ...r }: ReturnType<typeof rule>) => r;
    const key = (r: ReturnType<typeof rule>) => pronounKey(r.speaker, r.listener);

    // Form đã thấy u1 + ai1, người dùng xoá ai1; ai2 do AI thêm sau lúc form mở → giữ.
    let v = await patchSeries(S, { pronoun_rules: [strip(u1)], pronoun_keys_seen: [key(u1), key(ai1)] });
    expect(v.pronoun_rules).toEqual([u1, ai2]);
    expect(v.settings_rev).toBe(rev0 + 1);

    // Lưu lại y nguyên (kể cả cặp AI) → nhãn giữ, rev không tăng.
    v = await patchSeries(S, { pronoun_rules: [strip(u1), strip(ai2)], pronoun_keys_seen: [key(u1), " SEO → hana "] });
    expect(v.pronoun_rules).toEqual([u1, ai2]);
    expect(v.settings_rev).toBe(rev0 + 1);

    // Client gửi origin cũng bị bỏ qua; sửa note cặp AI → của người dùng.
    v = await patchSeries(S, {
      pronoun_rules: [strip(u1), { ...strip(ai2), note: "bạn thân", origin: "ai" }],
      pronoun_keys_seen: [key(u1), key(ai2)],
    });
    expect(v.pronoun_rules).toEqual([u1, { ...ai2, note: "bạn thân", origin: "user" }]);
    expect(v.settings_rev).toBe(rev0 + 2);
  });

  it("merge over 200 drops unseen pairs past the cap", async () => {
    const S = await seedUser("patch-cap");
    const unseen = Array.from({ length: 150 }, (_, i) => rule(`A${i}`, "X", "ai"));
    await db.update(series).set({ pronounRules: unseen }).where(eq(series.id, S.seriesId));
    const body = Array.from({ length: 100 }, (_, i) => ({ speaker: `U${i}`, listener: "Y", address: "anh/em" }));
    const v = await patchSeries(S, { pronoun_rules: body, pronoun_keys_seen: [] });
    expect(v.pronoun_rules).toHaveLength(200);
    expect(v.pronoun_rules.slice(0, 100).every((r) => r.origin === "user")).toBe(true);
    expect(v.pronoun_rules.slice(100)).toEqual(unseen.slice(0, 100));
  });

  it("an old tab body keeps AI pairs and does not clear the AI style", async () => {
    const S = await seedUser("patch-legacy");
    const u1 = rule("Minh", "Lan", "user");
    const ai1 = rule("Hana", "Minjun", "ai");
    await db
      .update(series)
      .set({ pronounRules: [u1, ai1], stylePrompt: "Giọng AI", styleOrigin: "ai" })
      .where(eq(series.id, S.seriesId));
    const rev0 = (await seriesRow(S.seriesId)).settingsRev;
    let v = await patchSeries(S, {
      pronoun_rules: [{ speaker: "Minh", listener: "Lan", address: "anh/em" }],
      style_prompt: "",
    });
    expect(v.pronoun_rules).toEqual([u1, ai1]);
    expect([v.style_prompt, v.style_origin, v.settings_rev]).toEqual(["Giọng AI", "ai", rev0]);

    v = await patchSeries(S, { style_prompt: "Giọng của tôi" });
    expect([v.style_prompt, v.style_origin, v.settings_rev]).toEqual(["Giọng của tôi", "user", rev0 + 1]);
  });

  it("new web: changing the style marks it the user's, even when cleared", async () => {
    const S = await seedUser("patch-style");
    await db.update(series).set({ stylePrompt: "Giọng AI", styleOrigin: "ai" }).where(eq(series.id, S.seriesId));
    const v = await patchSeries(S, { style_prompt: "", pronoun_keys_seen: [] });
    expect([v.style_prompt, v.style_origin]).toEqual(["", "user"]);
    // Người dùng đã cố ý để trống → AI không điền lại.
    await prepared(S, S.chapterId, 2);
    await translateAll(() => ({ style_note: "Hiện đại" }));
    expect((await seriesRow(S.seriesId)).stylePrompt).toBe("");
  });

  it("POST series labels pairs as the user's; glossary create and edit are the user's", async () => {
    const S = await seedUser("patch-post");
    const res = await call("/api/series", {
      method: "POST",
      cookie: S.cookie,
      body: { title: "Mới", pronoun_rules: [{ speaker: "A", listener: "B", address: "anh/em", origin: "ai" }] },
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { pronoun_rules: unknown[]; style_origin: string | null };
    expect(created.pronoun_rules).toEqual([rule("A", "B", "user")]);
    expect(created.style_origin).toBeNull();

    await scoped(db, S.userId).insert(glossaryEntries, {
      seriesId: S.seriesId,
      sourceTerm: "민준",
      targetTerm: "Minjun",
      origin: "ai",
    });
    const [ai] = await glossaryOf(S.seriesId);
    const edit = await call(`/api/glossary/${ai?.id}`, {
      method: "PATCH",
      cookie: S.cookie,
      body: { note: "nam chính" },
    });
    expect(((await edit.json()) as { origin: string }).origin).toBe("user");
    const post = await call(`/api/series/${S.seriesId}/glossary`, {
      method: "POST",
      cookie: S.cookie,
      body: { source_term: "하나", target_term: "Hana" },
    });
    expect(((await post.json()) as { origin: string }).origin).toBe("user");
  });
});

describe("no deadlock with concurrent writers", () => {
  it("two completes of two chapters in one series with the same term write one entry", async () => {
    const S = await seedUser("race-two");
    await prepared(S, S.chapterId, 2);
    const ch2 = await addChapter(S, "2");
    await prepared(S, ch2, 2);
    const [j1] = await claimJobs(token, { caps: ["chapter.translate"] });
    const [j2] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(j1 && j2).toBeTruthy();
    const learned = { new_terms: [term("민준", "Minjun")], pronoun_pairs: [pair("Hana", "Minjun")] };
    const hold = holdLock(lockSeriesRow(S.seriesId));
    await hold.locked;
    const calls = [j1, j2].map((j) => complete(token, j as Claimed, translateResult(j as Claimed, learned)));
    await waitForLockWaiters(2);
    hold.release();
    await hold.done;
    expect(await Promise.all(calls.map(async (r) => (await r).status))).toEqual([200, 200]);
    expect((await glossaryOf(S.seriesId)).map((e) => e.sourceTerm)).toEqual(["민준"]);
    expect((await seriesRow(S.seriesId)).pronounRules).toHaveLength(1);
  });

  it("complete runs alongside the reaper closing jobs of two chapters in the same series", async () => {
    const S = await seedUser("race-reaper");
    const ch2 = await addChapter(S, "2");
    // Chương 1: một page.prepare đang chạy. Chương 2: lô dịch đầu đang chạy + page.prepare trang 2 đang chạy.
    for (const [ch, n] of [
      [S.chapterId, 1],
      [ch2, 2],
    ] as const) {
      await addSources(S.userId, ch, n);
      await inJobTx((tx) => enqueueIngest(tx, S.userId, ch, undefined, "translated"));
      const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
      expect((await doIngest(token, ij as Claimed)).status).toBe(200);
    }
    const prep = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
    expect(prep).toHaveLength(3);
    const byChapter = async (j: Claimed) => (await jobRow(j.id)).chapterId;
    const ch2Prep: Claimed[] = [];
    for (const j of prep) if ((await byChapter(j)) === ch2) ch2Prep.push(j);
    expect((await doPrepare(token, ch2Prep[0] as Claimed)).status).toBe(200);
    const [lot] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(lot).toBeDefined();
    const stale = prep.filter((j) => j.id !== ch2Prep[0]?.id);
    for (const j of stale) {
      await expireLease(j.id);
      await db
        .update(jobs)
        .set({ attempts: sql`${jobs.maxAttempts}` })
        .where(eq(jobs.id, j.id));
    }

    const hold = holdLock(lockSeriesRow(S.seriesId));
    await hold.locked;
    const done = complete(
      token,
      lot as Claimed,
      translateResult(lot as Claimed, { new_terms: [term("민준", "Minjun")] }),
    );
    await waitForLockWaiters(1);
    const reaped = reapExpiredLeases();
    hold.release();
    await hold.done;
    expect((await done).status).toBe(200);
    expect((await reaped).failed).toBe(2);
    expect((await glossaryOf(S.seriesId)).map((e) => e.sourceTerm)).toEqual(["민준"]);
  });

  it("POST glossary of a term runs alongside a complete that learns the same term: one entry", async () => {
    const S = await seedUser("race-glossary");
    await prepared(S, S.chapterId, 2);
    const [j] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(j).toBeDefined();
    const hold = holdLock(lockSeriesRow(S.seriesId));
    await hold.locked;
    // Complete xếp hàng trước trên khoá series, POST sau: route phải khoá series trước khi chèn entry, nếu không complete
    // chờ entry chưa commit của route còn route chờ khoá series của complete.
    const done = complete(token, j as Claimed, translateResult(j as Claimed, { new_terms: [term("민준", "Minjun")] }));
    await waitForLockWaiters(1);
    const post = call(`/api/series/${S.seriesId}/glossary`, {
      method: "POST",
      cookie: S.cookie,
      body: { source_term: "민준", target_term: "Min-jun" },
    });
    await waitForLockWaiters(2);
    hold.release();
    await hold.done;
    const [res, posted] = await Promise.all([done, post]);
    expect(res.status, await res.clone().text()).toBe(200);
    expect([201, 409], await posted.clone().text()).toContain(posted.status);
    expect((await glossaryOf(S.seriesId)).map((e) => e.sourceTerm)).toEqual(["민준"]);
  });

  it("writing learned memory runs alongside DELETE series", async () => {
    const S = await seedUser("race-delete");
    await prepared(S, S.chapterId, 2);
    const [j] = await claimJobs(token, { caps: ["chapter.translate"] });
    const job = await jobRow((j as Claimed).id);
    // Job đã xong (không còn job đang chạy để DELETE huỷ): DELETE đi thẳng tới bước xoá hàng.
    await db.update(jobs).set({ status: "succeeded" }).where(eq(jobs.id, job.id));
    let chapter: Awaited<ReturnType<typeof lockChapter>> | undefined;
    const hold = holdLock(
      async (tx) => {
        chapter = await lockChapter(tx, S.userId, S.chapterId);
      },
      async (tx) => {
        if (!chapter) throw new Error("chapter not locked");
        await applyLearned(tx, {
          job,
          chapter,
          result: { type: "chapter.translate", pages: [], new_terms: [term("민준", "Minjun")] },
        });
      },
    );
    await hold.locked;
    const del = call(`/api/series/${S.seriesId}`, { method: "DELETE", cookie: S.cookie });
    await waitForLockWaiters(1);
    hold.release();
    await hold.done;
    expect((await del).status).toBe(204);
    expect(await db.select().from(series).where(eq(series.id, S.seriesId))).toHaveLength(0);
  });
});
