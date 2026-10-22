import { describe, expect, it } from "vitest";
import { chapterChip } from "./status.ts";

const base = { pages: 5, ready: 3, failed: 0, review: 0, preparing: 0, upload: null };

describe("chapter status chip", () => {
  it("draft: upload progress while uploading, otherwise Nháp", () => {
    const uploading = { phase: "uploading" as const, done: 2, total: 5 };
    expect(chapterChip({ ...base, status: "draft", pages: 0, upload: uploading })).toEqual({
      label: "Đang tải ảnh 2/5",
      tone: "busy",
    });
    const incomplete = { phase: "incomplete" as const, done: 2, total: 5 };
    expect(chapterChip({ ...base, status: "draft", pages: 0, upload: incomplete }).tone).toBe("warn");
    expect(chapterChip({ ...base, status: "draft", pages: 0 })).toEqual({ label: "Nháp", tone: "idle" });
  });

  it("processing shows which step runs and its page progress", () => {
    expect(chapterChip({ ...base, status: "ingesting", pages: 0 }).label).toBe("Bước 1 · đang cắt trang");
    expect(chapterChip({ ...base, status: "processing", ready: 0, preparing: 2 })).toEqual({
      label: "Bước 1 · OCR 3/5",
      tone: "busy",
    });
    expect(chapterChip({ ...base, status: "processing" })).toEqual({ label: "Đang dịch 3/5", tone: "busy" });
    expect(chapterChip({ ...base, status: "processing", pages: 0 }).label).toBe("Đang dịch");
  });

  it("prepared: step 1 done, waiting for Dịch (warns about failed pages)", () => {
    expect(chapterChip({ ...base, status: "prepared", ready: 0 })).toEqual({
      label: "Xong bước 1 · chờ dịch",
      tone: "idle",
    });
    expect(chapterChip({ ...base, status: "prepared", ready: 0, failed: 1 })).toEqual({
      label: "Xong bước 1 · chờ dịch · lỗi 1 trang",
      tone: "warn",
    });
  });

  it("review / done carry the needs-review count", () => {
    expect(chapterChip({ ...base, status: "review", review: 2 })).toEqual({
      label: "Chờ duyệt · 2 cần xem",
      tone: "warn",
    });
    expect(chapterChip({ ...base, status: "review" })).toEqual({ label: "Chờ duyệt", tone: "ok" });
    expect(chapterChip({ ...base, status: "done" })).toEqual({ label: "Xong", tone: "ok" });
  });

  it("partial_failed: failed page count, or ingest failure without pages", () => {
    expect(chapterChip({ ...base, status: "partial_failed", failed: 2 })).toEqual({
      label: "Lỗi 2 trang",
      tone: "danger",
    });
    expect(chapterChip({ ...base, status: "partial_failed", pages: 0 }).label).toBe("Cắt trang lỗi");
  });
});
