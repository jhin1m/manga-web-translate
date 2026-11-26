/**
 * Ngôn ngữ giao diện của người dùng: web ghi qua `PUT /api/me/locale`, `GET /api/me` trả lại; job dịch (kể cả lô tự
 * enqueue sau bước 1, không qua request) và hiệu đính mang `ui_lang` của chủ series — chưa đồng bộ → `vi`.
 */
import { randomUUID } from "node:crypto";
import { chapters, jobs, pageStates, pages, scoped, user } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { call, db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import { addSources, aiState, type Claimed, claimJobs, doIngest, doPrepare, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let token: string;

beforeAll(async () => {
  token = (await workerToken("mac", "ui-locale")).token;
});
beforeEach(cancelActiveJobs);

const me = async (S: Seed) => (await (await call("/api/me", { cookie: S.cookie })).json()) as { ui_locale: unknown };
const putLocale = (S: Seed, body: unknown) => call("/api/me/locale", { cookie: S.cookie, method: "PUT", body });
const setLocale = (S: Seed, locale: string | null) =>
  db.update(user).set({ uiLocale: locale }).where(eq(user.id, S.userId));

/** Chương 1 trang, chạy tới "đã dịch": ingest + prepare xong → lô dịch đầu tự enqueue phía server. */
async function autoTranslatePayload(S: Seed) {
  await addSources(S.userId, S.chapterId, 1);
  await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId, undefined, "translated"));
  const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
  expect((await doIngest(token, ij as Claimed)).status).toBe(200);
  const [pj] = await claimJobs(token, { caps: ["page.prepare"] });
  expect((await doPrepare(token, pj as Claimed)).status).toBe(200);
  const [tj] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.chapterId, S.chapterId), eq(jobs.type, "chapter.translate")));
  expect(tj).toBeDefined();
  return tj?.payload as Record<string, unknown>;
}

describe("ui locale on the user", () => {
  it("starts unset, is saved by PUT /api/me/locale and returned by GET /api/me", async () => {
    const S = await seedUser("ui-locale-me");
    expect((await me(S)).ui_locale).toBeNull();
    const res = await putLocale(S, { ui_locale: "en" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ui_locale: "en" });
    expect((await me(S)).ui_locale).toBe("en");
  });

  it("rejects codes outside the web locales and unknown fields", async () => {
    const S = await seedUser("ui-locale-bad");
    for (const body of [{ ui_locale: "fr" }, { ui_locale: "" }, {}, { ui_locale: "en", extra: 1 }]) {
      const res = await putLocale(S, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_body");
    }
    expect((await me(S)).ui_locale).toBeNull();
  });

  it("needs a session", async () => {
    expect((await call("/api/me/locale", { method: "PUT", body: { ui_locale: "en" } })).status).toBe(401);
  });
});

describe("ui_lang in job payloads", () => {
  it("an auto-enqueued translate batch carries the series owner's ui locale", async () => {
    const S = await seedUser("ui-lang-auto-en");
    await setLocale(S, "en");
    expect(await autoTranslatePayload(S)).toMatchObject({ type: "chapter.translate", ui_lang: "en" });
  });

  it("falls back to vi when the owner never synced a locale or the stored code is unknown", async () => {
    const S = await seedUser("ui-lang-auto-unset");
    expect((await autoTranslatePayload(S)).ui_lang).toBe("vi");
    const T = await seedUser("ui-lang-auto-odd");
    await setLocale(T, "xx");
    expect((await autoTranslatePayload(T)).ui_lang).toBe("vi");
  });

  it("proofread carries the ui locale read at enqueue time", async () => {
    const S = await seedUser("ui-lang-proofread");
    const sdb = scoped(db, S.userId);
    const p = await sdb.insert(pages, {
      id: randomUUID(),
      chapterId: S.chapterId,
      ord: 0,
      width: 200,
      height: 300,
      originalKey: `u/${S.userId}/ch/${S.chapterId}/ingest/1/0.png`,
      originalSha256: "ef".repeat(32),
      status: "ready",
    });
    await sdb.insert(pageStates, { pageId: p.id, state: aiState(200, 300, "Xin chào") });
    await sdb.update(chapters, eq(chapters.id, S.chapterId), { status: "review" });
    expect((await putLocale(S, { ui_locale: "en" })).status).toBe(200);
    const res = await call(`/api/chapters/${S.chapterId}/proofread`, { cookie: S.cookie, method: "POST" });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string } };
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.payload).toMatchObject({ type: "chapter.proofread", ui_lang: "en" });
  });
});
