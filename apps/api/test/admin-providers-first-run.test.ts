/** Provider đầu tiên ở local mode tự điền slot; bản VPS và provider thứ hai không đổi gì. */
import { aiProviders, systemSettings } from "@mtl/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { db } from "../src/db.ts";
import { env } from "../src/env.ts";
import { systemSlots } from "../src/lib/system-settings.ts";
import { ensureLocalUser, setLocalUserForTest } from "../src/local/local-user.ts";
import { call, seedAdmin, uniq } from "./helpers.ts";

type View = { id: string; models: { id: string; model_id: string }[] };

const KEY = "sk-live-AAAABBBBCCCCDDDD1234";
const PLAIN = { model_id: "z-plain", price_in: 1, price_out: 2, vision: false };
const SEE_A = { model_id: "m-see", price_in: 1, price_out: 2, vision: true };
const SEE_B = { model_id: "a-see", price_in: 1, price_out: 2, vision: true };
const EMPTY = { ocr: null, translate: null, proofread: null };

const body = (models: unknown[]) => ({ type: "openai", name: uniq("Provider"), api_key: KEY, models });
let app: ReturnType<typeof createApp>;

async function createLocal(models: unknown[]): Promise<View> {
  const res = await app.request("/api/admin/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body(models)),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as View;
}

const idOf = (p: View, modelId: string) => p.models.find((m) => m.model_id === modelId)?.id;

beforeAll(async () => {
  env.MTL_LOCAL_MODE = true;
  await ensureLocalUser(db);
  app = createApp();
  env.MTL_LOCAL_MODE = false;
});

afterAll(() => setLocalUserForTest(null));

beforeEach(async () => {
  env.MTL_LOCAL_MODE = true;
  await db.delete(systemSettings);
  await db.delete(aiProviders);
});

afterEach(() => {
  env.MTL_LOCAL_MODE = false;
});

describe("first provider in local mode", () => {
  it("fills translate with the first model and vision slots with the first vision model, in body order", async () => {
    const p = await createLocal([PLAIN, SEE_A, SEE_B]);
    expect(await systemSlots(db)).toEqual({
      translate: idOf(p, PLAIN.model_id),
      ocr: idOf(p, SEE_A.model_id),
      proofread: idOf(p, SEE_A.model_id),
    });
  });

  it("leaves vision slots empty when no model has vision", async () => {
    const p = await createLocal([PLAIN]);
    expect(await systemSlots(db)).toEqual({ translate: idOf(p, PLAIN.model_id), ocr: null, proofread: null });
  });

  it("assigns nothing when the provider has no models", async () => {
    await createLocal([]);
    expect(await systemSlots(db)).toEqual(EMPTY);
  });
});

describe("providers that must not change slots", () => {
  it("a second provider leaves empty slots empty", async () => {
    await createLocal([]);
    await createLocal([SEE_A]);
    expect(await systemSlots(db)).toEqual(EMPTY);
  });

  it("a second provider does not overwrite assigned slots", async () => {
    const first = await createLocal([SEE_A]);
    const before = await systemSlots(db);
    await createLocal([SEE_B]);
    expect(await systemSlots(db)).toEqual(before);
    expect(before.translate).toBe(idOf(first, SEE_A.model_id));
  });

  it("outside local mode the first provider assigns nothing", async () => {
    env.MTL_LOCAL_MODE = false;
    const admin = await seedAdmin("first-run-vps");
    const res = await call("/api/admin/providers", {
      method: "POST",
      cookie: admin.cookie,
      body: body([SEE_A]),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await systemSlots(db)).toEqual(EMPTY);
  });
});
