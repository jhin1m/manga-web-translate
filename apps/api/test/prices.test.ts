/** Giá LLM: bảng tĩnh cho job chạy bằng env worker; giá do admin nhập cho job có `payload.llm`. */
import { jobs, usageLedger } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordUsage } from "../src/billing/ledger.ts";
import { LLM_PRICES_PER_MTOK, llmPrice } from "../src/billing/prices.ts";
import { inJobTx } from "../src/jobs/enqueue.ts";
import { db, seedUser } from "./helpers.ts";
import { createProvider } from "./llm-helpers.ts";
import { usage } from "./worker-helpers.ts";

describe("llmPrice (static table)", () => {
  it("known model -> table price; null / unknown -> most expensive, known:false", () => {
    expect(llmPrice("gemini-2.5-flash")).toEqual({ price: LLM_PRICES_PER_MTOK["gemini-2.5-flash"], known: true });
    const all = Object.values(LLM_PRICES_PER_MTOK);
    const max = { in: Math.max(...all.map((p) => p.in)), out: Math.max(...all.map((p) => p.out)) };
    expect(llmPrice(null)).toEqual({ price: max, known: false });
    expect(llmPrice("some-new-model")).toEqual({ price: max, known: false });
  });
});

/** Ghi usage cho 1 job ocr_region với `llm` cho trước; trả đơn giá USD / 1M token của dòng vào / ra. */
async function unitCosts(llm: unknown, model: string) {
  const S = await seedUser("prices");
  const [job] = await db
    .insert(jobs)
    .values({
      userId: S.userId,
      type: "page.ocr_region",
      status: "running",
      payload: { type: "page.ocr_region", page_id: crypto.randomUUID(), bbox: [0, 0, 10, 10], llm } as never,
      inputRev: "r",
      idempotencyKey: `prices-${S.userId}`,
    })
    .returning();
  if (!job) throw new Error("job missing");
  await inJobTx((tx) => recordUsage(tx, job, 1, usage(1, { model, llm_in: 1000, llm_out: 500 }), "mac"));
  const rows = await db
    .select()
    .from(usageLedger)
    .where(and(eq(usageLedger.jobId, job.id), eq(usageLedger.attempt, 1)));
  const by = Object.fromEntries(rows.map((r) => [r.kind, r.unitCostUsd]));
  return { in: (by.llm_tokens_in ?? 0) * 1e6, out: (by.llm_tokens_out ?? 0) * 1e6 };
}

describe("ledger page.ocr_region", () => {
  it("env worker (no payload.llm): prices by usage.model from the static table", async () => {
    const c = await unitCosts(undefined, "gpt-4.1-mini");
    expect(c.in).toBeCloseTo(0.4, 9);
    expect(c.out).toBeCloseTo(1.6, 9);
  });

  it("a matching ref uses the price the admin entered, not the static table", async () => {
    const p = await createProvider("sk-test-PRICEPRICE0001", [
      { model_id: "gpt-4.1-mini", price_in: 0.9, price_out: 3.5 },
    ]);
    const llm = { translate: { provider_id: p.id, model: "gpt-4.1-mini" } };
    const c = await unitCosts(llm, "gpt-4.1-mini");
    expect(c.in).toBeCloseTo(0.9, 9);
    expect(c.out).toBeCloseTo(3.5, 9);
    // usage.model không khớp ref nào (slot kia chạy bằng env) -> bảng tĩnh, không lấy giá ref.
    const other = await unitCosts(llm, "claude-haiku-5-5");
    expect(other.in).toBeCloseTo(0.1, 9);
    expect(other.out).toBeCloseTo(0.5, 9);
  });

  it("two refs with different models: max of each dimension", async () => {
    const p = await createProvider("sk-test-PRICEPRICE0002", [
      { model_id: "gpt-4.1-mini", price_in: 0.9, price_out: 3.5, vision: true },
      { model_id: "gpt-4.1", price_in: 7, price_out: 1, vision: true },
    ]);
    const llm = {
      ocr: { provider_id: p.id, model: "gpt-4.1" },
      translate: { provider_id: p.id, model: "gpt-4.1-mini" },
    };
    const c = await unitCosts(llm, "gpt-4.1-mini");
    expect(c.in).toBeCloseTo(7, 9);
    expect(c.out).toBeCloseTo(3.5, 9);
  });
});
