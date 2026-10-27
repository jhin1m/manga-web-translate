import { idempotencyKey, type JobPayload } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, jobs, user } from "../src/index.ts";

const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 2 });
let userId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(user)
    .values({ name: "u", email: `u-${uuidv7()}@test.local` })
    .returning();
  userId = u?.id ?? "";
});
afterAll(() => close());

function job(key: string) {
  const payload: JobPayload = { type: "page.prepare", page_id: uuidv7(), source_lang: "ko" };
  return { userId, type: payload.type, payload, inputRev: "r1", idempotencyKey: key };
}

/** postgres-js bọc lỗi PG; drizzle bọc thêm một lớp → tìm code ở cause. */
const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
};

describe("jobs idempotency partial unique index", () => {
  it("rejects a duplicate key while the existing job is active (queued/running/paused_budget)", async () => {
    for (const status of ["queued", "running", "paused_budget"] as const) {
      const key = idempotencyKey("page.prepare", uuidv7(), "rev", { status });
      await db.insert(jobs).values({ ...job(key), status });
      const err = await db
        .insert(jobs)
        .values(job(key))
        .catch((e: unknown) => e);
      expect(pgCode(err), status).toBe("23505");
    }
  });

  it("allows a new job with the same key once the old one is terminal (failed/succeeded/cancelled)", async () => {
    for (const status of ["failed", "succeeded", "cancelled"] as const) {
      const key = idempotencyKey("page.prepare", uuidv7(), "rev", { status });
      await db.insert(jobs).values({ ...job(key), status });
      const [fresh] = await db.insert(jobs).values(job(key)).returning();
      expect(fresh?.status).toBe("queued");
      const rows = await db.select().from(jobs).where(eq(jobs.idempotencyKey, key));
      expect(rows).toHaveLength(2);
    }
  });

  it("rejects unknown job type / status via CHECK constraints", async () => {
    const err = await db
      .insert(jobs)
      .values({ ...job(uuidv7()), status: "bogus" as never })
      .catch((e: unknown) => e);
    expect(pgCode(err)).toBe("23514");
  });
});
