/** Dựng provider + gán slot qua API admin (đúng đường người dùng đi) cho test claim / giá / breaker. */
import { randomUUID } from "node:crypto";
import { chapters, jobs, pageStates, pages, scoped, series } from "@mtl/db";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { env } from "../src/env.ts";
import { call, db, seedAdmin, type seedUser } from "./helpers.ts";
import { aiState, OCR } from "./worker-helpers.ts";

export type TestProvider = { id: string; models: { id: string; model_id: string }[] };
type Admin = Awaited<ReturnType<typeof seedAdmin>>;

let admin: Admin | undefined;

/** Admin dùng chung của file; `ADMIN_EMAILS` được khôi phục sau mỗi ca nên đặt lại trước mỗi lời gọi. */
export async function adminApi(path: string, method = "GET", body?: unknown) {
  admin ??= await seedAdmin("llm-admin");
  if (!env.ADMIN_EMAILS.includes(admin.email)) env.ADMIN_EMAILS.push(admin.email);
  return call(`/api/admin${path}`, { method, cookie: admin.cookie, body });
}

export async function createProvider(
  key: string,
  models: { model_id: string; price_in: number; price_out: number; vision?: boolean; reasoning?: boolean }[],
  over: Record<string, unknown> = {},
): Promise<TestProvider> {
  const res = await adminApi("/providers", "POST", {
    type: "openai",
    name: `P-${crypto.randomUUID().slice(0, 8)}`,
    api_key: key,
    models: models.map((m) => ({ vision: false, ...m })),
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as TestProvider;
}

export type SlotIds = { ocr?: string | null; translate?: string | null; proofread?: string | null };

/** Gán đủ 3 slot (thiếu = bỏ gán). */
export async function setSlots(slots: SlotIds) {
  const res = await adminApi("/settings/slots", "PUT", {
    ocr: slots.ocr ?? null,
    translate: slots.translate ?? null,
    proofread: slots.proofread ?? null,
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

export const modelOf = (p: TestProvider, modelId: string) => {
  const m = p.models.find((x) => x.model_id === modelId);
  if (!m) throw new Error(`no model ${modelId}`);
  return m.id;
};

/** Page (+ page_state) của người dùng seed, mặc định chưa prepare. */
export async function insertPage(
  S: Awaited<ReturnType<typeof seedUser>>,
  over: Partial<typeof pages.$inferInsert> = {},
) {
  const sdb = scoped(db, S.userId);
  const p = await sdb.insert(pages, {
    id: randomUUID(),
    chapterId: S.chapterId,
    ord: 0,
    width: 200,
    height: 300,
    originalKey: `u/${S.userId}/ch/${S.chapterId}/ingest/1/0.png`,
    originalSha256: "ef".repeat(32),
    ...over,
  });
  await sdb.insert(pageStates, { pageId: p.id, state: aiState(200, 300, "Xin chao") });
  return p;
}

/** Page đã qua giai đoạn 1 (đủ để enqueue + claim chapter.translate). */
export const insertPreparedPage = (S: Awaited<ReturnType<typeof seedUser>>, ord = 0) =>
  insertPage(S, {
    ord,
    ocrResult: OCR,
    cleanRev: 1,
    maskRev: 1,
    prepareInputRev: "ab".repeat(32),
    status: "prepared",
  });

export async function chapterAndSeries(S: Awaited<ReturnType<typeof seedUser>>) {
  const [ch] = await db.select().from(chapters).where(eq(chapters.id, S.chapterId));
  const [s] = await db.select().from(series).where(eq(series.id, S.seriesId));
  if (!ch || !s) throw new Error("seed missing");
  return { ch, s };
}

export async function jobById(id: string) {
  const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!j) throw new Error(`job ${id} missing`);
  return j;
}
