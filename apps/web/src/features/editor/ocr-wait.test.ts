import { describe, expect, it, vi } from "vitest";
import { cancelJobBestEffort, OCR_STALL_MS, ocrRetryNote, ocrStallNote } from "./ocr-wait.ts";

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

describe("ocrStallNote", () => {
  it("stays silent before the threshold, once claimed, or when a retry note applies", () => {
    expect(ocrStallNote({ status: "queued", error: null }, OCR_STALL_MS - 1)).toBeNull();
    expect(ocrStallNote({ status: "running", error: null }, OCR_STALL_MS * 4)).toBeNull();
    expect(ocrStallNote({ status: "queued", error: "x" }, OCR_STALL_MS * 4)).toBeNull();
  });
  it("tells the user nobody picked the job up yet", () => {
    const note = ocrStallNote({ status: "queued", error: null }, 45_500);
    expect(note).toContain("45 giây");
    expect(note).toContain("máy xử lý");
    expect(note).toContain("huỷ");
  });
});

describe("cancelJobBestEffort", () => {
  it("cancels once when the first call works", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    await cancelJobBestEffort("j1", cancel, 0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("j1");
  });
  it("retries once after a failed cancel so a queued job does not stay behind", async () => {
    const cancel = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue(undefined);
    await cancelJobBestEffort("j1", cancel, 0);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it("gives up quietly after the retry also fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("down"));
    await expect(cancelJobBestEffort("j1", cancel, 0)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
