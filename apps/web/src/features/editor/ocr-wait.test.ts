import { describe, expect, it } from "vitest";
import { ocrRetryNote } from "./ocr-wait.ts";

const NOW = Date.parse("2026-10-31T01:00:00Z");
const base = { run_after: "2026-10-31T01:30:00Z", error_class: null, provider_retries: 0 };

describe("ocrRetryNote", () => {
  it("is silent while the first attempt runs or waits", () => {
    expect(ocrRetryNote({ ...base, status: "running", error: null }, NOW)).toBeNull();
    expect(ocrRetryNote({ ...base, status: "queued", error: null }, NOW)).toBeNull();
  });
  it("names the error class and retry time, never the raw error", () => {
    const raw = '{"error":{"code":429,"message":"Quota exceeded"}}';
    const note = ocrRetryNote(
      { ...base, status: "queued", error: raw, error_class: "rate_limited", provider_retries: 2 },
      NOW,
    );
    expect(note).toContain("429");
    expect(note).toContain("lần 2");
    expect(note).toContain("tự thử lại lúc");
    expect(note).not.toContain("Quota exceeded");
  });
  it("maps a requeue without class (lease expired) to a plain system error", () => {
    const note = ocrRetryNote({ ...base, status: "queued", error: "lease expired" }, NOW);
    expect(note).toContain(`lỗi hệ thống`);
    expect(note).not.toContain("lease expired");
  });
  it("does not promise a retry time already in the past", () => {
    const note = ocrRetryNote({ ...base, status: "queued", error: "x", run_after: "2026-10-31T00:30:00Z" }, NOW);
    expect(note).toContain("sắp tới");
    expect(note).not.toContain("lúc");
  });
});
