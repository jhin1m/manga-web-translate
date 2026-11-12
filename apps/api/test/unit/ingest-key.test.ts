/** input_rev của chapter.ingest đổi theo số px cắt mép; ảnh không cắt giữ nguyên chuỗi băm cũ. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "../../src/env.ts";
import { ingestKey } from "../../src/jobs/idempotency.ts";
import { compareVersion } from "../../src/jobs/queue.ts";

const CH = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6d";
const a = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5b00";
const b = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5b01";
const none = (id: string) => ({ id, trim: null });

describe("ingestKey", () => {
  it("untrimmed sources hash exactly as ids alone, regardless of order", () => {
    const legacy = createHash("sha256")
      .update([3, [a, b].join(","), env.PIPELINE_VERSION].join("|"))
      .digest("hex");
    expect(ingestKey(CH, 3, "strip", [none(b), none(a)]).inputRev).toBe(legacy);
  });

  it("changes when a trim is added or its pixels change, and is stable otherwise", () => {
    const base = ingestKey(CH, 1, "strip", [none(a), none(b)]);
    const trimmed = ingestKey(CH, 1, "strip", [{ id: a, trim: { top: 100, bottom: 0 } }, none(b)]);
    const moved = ingestKey(CH, 1, "strip", [{ id: a, trim: { top: 100, bottom: 1 } }, none(b)]);
    const again = ingestKey(CH, 1, "strip", [none(b), { id: a, trim: { top: 100, bottom: 0 } }]);
    expect(new Set([base.inputRev, trimmed.inputRev, moved.inputRev]).size).toBe(3);
    expect(new Set([base.idempotencyKey, trimmed.idempotencyKey, moved.idempotencyKey]).size).toBe(3);
    expect(again).toEqual(trimmed);
  });
});

describe("worker version gate", () => {
  it("refuses workers older than the one that understands sources[].trim", () => {
    expect(compareVersion(env.MIN_PIPELINE_VERSION, "0.12.0")).toBeGreaterThanOrEqual(0);
  });
});
