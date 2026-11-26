/** Bước AI để "Tự động" (slot null): lúc tạo job lấy model đầu tiên phù hợp theo thứ tự thêm; gán tay luôn thắng. */
import { aiModels, aiProviders, systemSettings } from "@mtl/db";
import { beforeEach, describe, expect, it } from "vitest";
import { slotRefs } from "../src/ai/llm-refs.ts";
import { db } from "../src/db.ts";
import { adminApi, createProvider, modelOf, setSlots } from "./llm-helpers.ts";

const KEY = "sk-test-AUTOAUTOAUTO1234";
const PLAIN = { model_id: "z-plain", price_in: 1, price_out: 2, vision: false };
const SEE_A = { model_id: "m-see", price_in: 1, price_out: 2, vision: true };
const SEE_B = { model_id: "a-see", price_in: 1, price_out: 2, vision: true };

const refs = () => slotRefs(db);

beforeEach(async () => {
  await db.delete(systemSettings);
  await db.delete(aiProviders);
});

describe("auto slots", () => {
  it("without providers no slot has a model (the worker falls back to its env key)", async () => {
    expect(await refs()).toEqual({});
  });

  it("translate takes the first model and vision slots the first vision model, in the order they were added", async () => {
    const p = await createProvider(KEY, [PLAIN, SEE_A, SEE_B]);
    expect(await refs()).toEqual({
      translate: { provider_id: p.id, model: PLAIN.model_id },
      ocr: { provider_id: p.id, model: SEE_A.model_id },
      proofread: { provider_id: p.id, model: SEE_A.model_id },
    });
  });

  it("vision slots stay without a model when no model has vision, then use a later provider's vision model", async () => {
    const first = await createProvider(KEY, [PLAIN]);
    expect(await refs()).toEqual({ translate: { provider_id: first.id, model: PLAIN.model_id } });
    const second = await createProvider(KEY, [SEE_B]);
    expect(await refs()).toEqual({
      translate: { provider_id: first.id, model: PLAIN.model_id },
      ocr: { provider_id: second.id, model: SEE_B.model_id },
      proofread: { provider_id: second.id, model: SEE_B.model_id },
    });
  });

  it("an assigned slot wins over the auto pick", async () => {
    await createProvider(KEY, [SEE_A]);
    const second = await createProvider(KEY, [SEE_B]);
    await setSlots({ translate: modelOf(second, SEE_B.model_id) });
    expect((await refs()).translate).toEqual({ provider_id: second.id, model: SEE_B.model_id });
  });

  it("skips Anthropic models the worker cannot run", async () => {
    const p = await createProvider(KEY, [], { type: "anthropic" });
    await db
      .insert(aiModels)
      .values([{ providerId: p.id, modelId: "claude-opus-5-5", priceIn: 1, priceOut: 2, vision: true }]);
    const ok = await createProvider(KEY, [SEE_A]);
    expect((await refs()).translate).toEqual({ provider_id: ok.id, model: SEE_A.model_id });
  });

  it("deleting the provider an auto slot uses is not blocked, and the next one takes over", async () => {
    const first = await createProvider(KEY, [SEE_A]);
    const second = await createProvider(KEY, [SEE_B]);
    const res = await adminApi(`/providers/${first.id}`, "DELETE");
    expect(res.status, await res.clone().text()).toBe(204);
    expect((await refs()).translate).toEqual({ provider_id: second.id, model: SEE_B.model_id });
  });
});
