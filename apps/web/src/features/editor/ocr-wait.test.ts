import { describe, expect, it } from "vitest";
import { ocrRetryNote } from "./ocr-wait.ts";

const base = { run_after: "2026-10-31T01:30:00Z" };

describe("ocrRetryNote", () => {
  it("is silent while the first attempt runs or waits", () => {
    expect(ocrRetryNote({ ...base, status: "running", error: null })).toBeNull();
    expect(ocrRetryNote({ ...base, status: "queued", error: null })).toBeNull();
  });
  it("reports the last attempt's error when the job is requeued for a retry", () => {
    const note = ocrRetryNote({ ...base, status: "queued", error: "hợp đồng: thiếu JSON Schema" });
    expect(note).toContain("hợp đồng: thiếu JSON Schema");
    expect(note).toContain("tự thử lại lúc");
  });
  it("truncates a very long error", () => {
    const note = ocrRetryNote({ ...base, status: "queued", error: "x".repeat(500) });
    expect(note?.length).toBeLessThan(330);
  });
});
