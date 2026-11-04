/** Khoá breaker của job: không trùng, thứ tự cố định (mọi job khoá hàng breaker cùng thứ tự). */
import type { JobPayload } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { breakerKeysOf, ENV_BREAKER } from "../src/jobs/breaker.ts";

const A = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01";
const B = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02";
const ref = (provider_id: string) => ({ provider_id, model: "m" });
const payload = (llm?: object) => ({ type: "page.ocr_region", llm }) as unknown as JobPayload;

describe("breakerKeysOf", () => {
  it("sorts provider ids whatever the slot order, so row locks are taken in one order", () => {
    expect(breakerKeysOf(payload({ ocr: ref(B), translate: ref(A) }))).toEqual([A, B]);
    expect(breakerKeysOf(payload({ ocr: ref(A), translate: ref(B) }))).toEqual([A, B]);
  });

  it("dedupes one provider used by two slots; no llm -> env", () => {
    expect(breakerKeysOf(payload({ ocr: ref(A), translate: ref(A) }))).toEqual([A]);
    expect(breakerKeysOf(payload())).toEqual([ENV_BREAKER]);
  });
});
