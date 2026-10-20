/**
 * Kill-switch ngân sách toàn cục: vượt ngưỡng → claim không trả job tốn tiền (Mac lẫn Modal), job queued →
 * paused_budget, job đang chạy dừng qua heartbeat (không tính attempt, không ghi đè artifact), mở lại khi hết
 * vượt; cảnh báo 50/80/100% mỗi mốc 1 lần/kỳ.
 */
import { jobs, pages, runtimeFlags, usageLedger } from "@mtl/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type BudgetStatus, budgetStatus, checkBudgetAlerts } from "../src/billing/budget.ts";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { maintainBudget } from "../src/jobs/runner.ts";
import { db, seedWorkspace } from "./helpers.ts";
import {
  addSources,
  type Claimed,
  claimJobs,
  doIngest,
  doPrepare,
  fence,
  jobRow,
  setWorkerMode,
  usage,
  wcall,
  workerToken,
} from "./worker-helpers.ts";

const setLimits = (daily?: number, monthly?: number) => {
  env.GLOBAL_DAILY_USD = daily;
  env.GLOBAL_MONTHLY_USD = monthly;
};

async function preparedChapter(label: string, n: number, mode: "mac" | "modal" = "mac") {
  const S = await seedWorkspace(label);
  const wsToken = (await workerToken(S.workspaceId)).token;
  await addSources(S.workspaceId, S.chapterId, n);
  await inJobTx((tx) => enqueueIngest(tx, S.workspaceId, S.chapterId));
  const [ij] = await claimJobs(wsToken, { caps: ["chapter.ingest"] });
  expect((await doIngest(wsToken, ij as Claimed)).status).toBe(200);
  if (mode === "modal") await setWorkerMode(S.workspaceId, "modal");
  return { S, wsToken };
}

const prepareJobs = (chapterId: string) =>
  db
    .select()
    .from(jobs)
    .where(and(eq(jobs.chapterId, chapterId), eq(jobs.type, "page.prepare")));

beforeAll(() => setLimits());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  setLimits();
  await maintainBudget();
  await db.delete(runtimeFlags).where(eq(runtimeFlags.key, "budget_alert"));
});

describe("budget status", () => {
  it("sums server-computed cost for UTC day and month; no limits = never exceeded", async () => {
    const s = await budgetStatus(db);
    const [row] = await db
      .select({ m: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)` })
      .from(usageLedger)
      .where(sql`${usageLedger.createdAt} >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`);
    expect(s.monthly.spentUsd).toBeCloseTo(Number(row?.m ?? 0), 9);
    expect(s.daily.spentUsd).toBeLessThanOrEqual(s.monthly.spentUsd + 1e-9);
    expect(s.exceeded).toBe(false);
    setLimits(undefined, 0);
    expect((await budgetStatus(db)).exceeded).toBe(true);
    setLimits();
  });
});

describe("kill-switch at claim + heartbeat", () => {
  it("exceeded: Mac and Modal claims return no paid jobs; queued paid jobs become paused_budget", async () => {
    const mac = await preparedChapter("bmac", 2);
    const modal = await preparedChapter("bmodal", 1, "modal");
    const platform = (await workerToken(null, "modal-budget")).token;
    setLimits(0, undefined);

    expect(await claimJobs(mac.wsToken, { caps: ["page.prepare", "chapter.translate"] })).toEqual([]);
    expect(await claimJobs(platform, { caps: ["page.prepare"] })).toEqual([]);
    for (const j of [...(await prepareJobs(mac.S.chapterId)), ...(await prepareJobs(modal.S.chapterId))]) {
      expect(j.status).toBe("paused_budget");
    }
    // Loại không tốn tiền LLM vẫn claim được (ở đây không còn job nào, nhưng không lỗi).
    expect(await claimJobs(mac.wsToken, { caps: ["chapter.ingest", "page.reinpaint"] })).toEqual([]);

    // Hết vượt → mtl-jobs mở lại, claim chạy tiếp.
    setLimits();
    expect((await maintainBudget()).resumed).toBeGreaterThanOrEqual(3);
    const [j] = await claimJobs(mac.wsToken, { caps: ["page.prepare"] });
    expect(j?.type).toBe("page.prepare");
    expect((await doPrepare(mac.wsToken, j as Claimed)).status).toBe(200);
  });

  it("running paid job stops via heartbeat: paused_budget, attempt refunded, page back to pending, worker fenced", async () => {
    const { S, wsToken } = await preparedChapter("bhb", 1);
    const [j] = (await claimJobs(wsToken, { caps: ["page.prepare"] })) as Claimed[];
    if (!j) throw new Error("no job");
    expect((await jobRow(j.id)).attempts).toBe(1);

    setLimits(0, 0);
    const hb = await wcall(wsToken, `/jobs/${j.id}/heartbeat`, {
      ...fence(j),
      progress: 0.5,
      stage: "inpaint",
      usage: usage(1),
    });
    expect(hb.status).toBe(200);
    expect(((await hb.json()) as { stop: string }).stop).toBe("paused_budget");
    const row = await jobRow(j.id);
    expect(row).toMatchObject({ status: "paused_budget", attempts: 0, leaseToken: null, leaseOwner: null });
    const [pg] = await db.select().from(pages).where(eq(pages.chapterId, S.chapterId));
    expect(pg?.status).toBe("pending");
    // usage gửi kèm heartbeat cuối vẫn được ghi (không mất chi phí đã phát sinh).
    const led = await db.select().from(usageLedger).where(eq(usageLedger.jobId, j.id));
    expect(led.length).toBeGreaterThan(0);
    // Worker cũ cố hoàn tất → 409, không ghi đè clean_rev.
    expect((await doPrepare(wsToken, j)).status).toBe(409);
    expect(pg?.cleanRev ?? null).toBe(
      (
        await db
          .select()
          .from(pages)
          .where(eq(pages.id, pg?.id ?? ""))
      )[0]?.cleanRev,
    );

    // Vẫn vượt → không mở lại; hết vượt → queued, claim lại được với attempt mới.
    expect((await maintainBudget()).resumed).toBe(0);
    setLimits();
    await maintainBudget();
    expect((await jobRow(j.id)).status).toBe("queued");
    const [again] = await claimJobs(wsToken, { caps: ["page.prepare"] });
    expect(again?.id).toBe(j.id);
    // Attempt trên dây tăng → usage lần chạy lại không đụng khoá ledger của lần bị dừng.
    expect(again?.attempt).toBeGreaterThan(j.attempt);
    expect((await jobRow(j.id)).attempts).toBe(1);
    const hb2 = await wcall(wsToken, `/jobs/${j.id}/heartbeat`, {
      ...fence(again as Claimed),
      progress: 0.5,
      stage: null,
      usage: usage(1),
    });
    expect(hb2.status).toBe(200);
    const rows = await db.select().from(usageLedger).where(eq(usageLedger.jobId, j.id));
    expect(new Set(rows.map((r) => r.attempt))).toEqual(new Set([j.attempt, again?.attempt]));
    expect((await doPrepare(wsToken, again as Claimed)).status).toBe(200);
  });

  it("non-paid job heartbeat is not stopped by the budget", async () => {
    const S = await seedWorkspace("bingest");
    const tok = (await workerToken(S.workspaceId)).token;
    await addSources(S.workspaceId, S.chapterId, 1);
    await inJobTx((tx) => enqueueIngest(tx, S.workspaceId, S.chapterId));
    setLimits(0, 0);
    const [ij] = (await claimJobs(tok, { caps: ["chapter.ingest"] })) as Claimed[];
    if (!ij) throw new Error("ingest not claimed under exceeded budget");
    const hb = await wcall(tok, `/jobs/${ij.id}/heartbeat`, { ...fence(ij), progress: 0.1, stage: null, usage: null });
    expect(((await hb.json()) as { stop: string | null }).stop).toBeNull();
    setLimits();
    expect((await doIngest(tok, ij)).status).toBe(200);
  });
});

describe("budget alerts", () => {
  const status = (ratio: number, period = "2099-01-01"): BudgetStatus => ({
    daily: { spentUsd: ratio * 10, limitUsd: 10, ratio, period },
    monthly: { spentUsd: 0, limitUsd: null, ratio: 0, period: "2099-01" },
    exceeded: ratio >= 1,
  });

  it("alerts once per level per period via ntfy", async () => {
    await db.delete(runtimeFlags).where(eq(runtimeFlags.key, "budget_alert"));
    env.ALERT_NTFY_URL = "https://ntfy.example.test/mtl-alerts";
    const sent = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    try {
      expect(await checkBudgetAlerts(db, status(0.3))).toEqual([]);
      expect(await checkBudgetAlerts(db, status(0.55))).toEqual(["daily:50"]);
      expect(await checkBudgetAlerts(db, status(0.6))).toEqual([]);
      expect(await checkBudgetAlerts(db, status(0.85))).toEqual(["daily:80"]);
      expect(await checkBudgetAlerts(db, status(1.2))).toEqual(["daily:100"]);
      expect(await checkBudgetAlerts(db, status(1.5))).toEqual([]);
      // Sang kỳ mới → báo lại từ đầu.
      expect(await checkBudgetAlerts(db, status(0.9, "2099-01-02"))).toEqual(["daily:80"]);
      expect(sent).toHaveBeenCalledTimes(4);
      const [url, init] = sent.mock.calls[2] as [string, RequestInit];
      expect(url).toBe("https://ntfy.example.test/mtl-alerts");
      expect((init.headers as Record<string, string>).priority).toBe("urgent");
    } finally {
      env.ALERT_NTFY_URL = undefined;
    }
  });

  it("ntfy failure never throws", async () => {
    env.ALERT_NTFY_URL = "https://ntfy.example.test/mtl-alerts";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    try {
      await db.delete(runtimeFlags).where(eq(runtimeFlags.key, "budget_alert"));
      expect(await checkBudgetAlerts(db, status(0.5, "2099-02-01"))).toEqual(["daily:50"]);
    } finally {
      env.ALERT_NTFY_URL = undefined;
    }
  });
});
