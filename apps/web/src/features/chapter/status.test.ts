import { describe, expect, it } from "vitest";
import { chapterChip, chapterProgress, chipWithActivity, nextReviewPage } from "./status.ts";

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
    expect(chapterChip({ ...base, status: "ingesting", pages: 0 }).label).toBe("Đang cắt trang");
    expect(chapterChip({ ...base, status: "processing", ready: 0, preparing: 2 })).toEqual({
      label: "Xoá chữ + OCR 3/5",
      tone: "busy",
    });
    expect(chapterChip({ ...base, status: "processing" })).toEqual({ label: "Đang dịch 3/5", tone: "busy" });
    expect(chapterChip({ ...base, status: "processing", pages: 0 }).label).toBe("Đang dịch");
  });

  it("running translate shows pages done and batch", () => {
    const run = { target: "translated" as const, total: 33, remaining: 29, batch: 2, batches: 9 };
    expect(chapterChip({ ...base, status: "processing", pages: 33, run })).toEqual({
      label: "Đang dịch · 4/33 trang · lô 2/9",
      tone: "busy",
    });
    expect(
      chapterChip({ ...base, status: "processing", run: { ...run, total: 3, remaining: 1, batches: 1 } }).label,
    ).toBe("Đang dịch · 2/3 trang");
    // Lô dịch đầu đã chạy khi trang sau còn xoá chữ: chip nói về lượt dịch.
    expect(chapterChip({ ...base, status: "processing", pages: 33, preparing: 20, run }).label).toBe(
      "Đang dịch · 4/33 trang · lô 2/9",
    );
    // Lượt "Chỉ xoá chữ + OCR" không bao giờ nói đang dịch.
    const prepareOnly = { target: "prepared" as const, total: 5, remaining: 0, batch: 0, batches: 0 };
    expect(chapterChip({ ...base, status: "processing", run: prepareOnly }).label).toBe("Xoá chữ + OCR 5/5");
    expect(chapterChip({ ...base, status: "processing", preparing: 2, run: prepareOnly }).label).toBe(
      "Xoá chữ + OCR 3/5",
    );
    // Lượt chưa có lô dịch nào (trang đầu còn xoá chữ): vẫn báo xoá chữ.
    const waiting = { ...run, remaining: 33, batch: 0, batches: 9 };
    expect(chapterChip({ ...base, status: "processing", preparing: 2, run: waiting }).label).toBe("Xoá chữ + OCR 3/5");
  });

  it("prepared: text removed, waiting for Dịch chương (warns about failed pages)", () => {
    expect(chapterChip({ ...base, status: "prepared", ready: 0 })).toEqual({ label: "Chờ dịch", tone: "idle" });
    expect(chapterChip({ ...base, status: "prepared", ready: 0, failed: 1 })).toEqual({
      label: "Chờ dịch · lỗi 1 trang",
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

describe("chapter progress bar", () => {
  const run = { target: "translated" as const, batch: 2, batches: 9, total: 33, remaining: 29 };
  it("measures translate runs, prepare-only runs and uploads", () => {
    expect(chapterProgress({ ...base, status: "processing", pages: 33, run })).toBeCloseTo(4 / 33);
    expect(chapterProgress({ ...base, status: "processing", preparing: 2 })).toBeCloseTo(3 / 5);
    const uploading = { phase: "uploading" as const, done: 2, total: 5 };
    expect(chapterProgress({ ...base, status: "draft", pages: 0, upload: uploading })).toBeCloseTo(0.4);
  });

  it("indeterminate while ingesting, absent when nothing runs", () => {
    expect(chapterProgress({ ...base, status: "ingesting", pages: 0 })).toBeNull();
    expect(chapterProgress({ ...base, status: "processing", pages: 0, ready: 0 })).toBeNull();
    for (const status of ["draft", "prepared", "review", "partial_failed", "done"] as const)
      expect(chapterProgress({ ...base, status })).toBeUndefined();
  });
});

describe("chip with outside activity", () => {
  it("leaves the chip alone when nothing else runs", () => {
    const chip = { label: "Xong", tone: "ok" } as const;
    expect(chipWithActivity(chip, { exports: 0, uploads: 0 })).toBe(chip);
  });

  it("says an export / other upload is running; a calm chip turns busy, a warning keeps its tone", () => {
    expect(chipWithActivity({ label: "Xong", tone: "ok" }, { exports: 1, uploads: 0 })).toEqual({
      label: "Xong · đang xuất",
      tone: "busy",
    });
    expect(chipWithActivity({ label: "Lỗi 2 trang", tone: "danger" }, { exports: 0, uploads: 1 })).toEqual({
      label: "Lỗi 2 trang · chương khác đang tải ảnh",
      tone: "danger",
    });
  });
});

describe("next page to review", () => {
  const ids = ["a", "b", "c", "d"];
  const flagged =
    (...f: string[]) =>
    (id: string) =>
      f.includes(id);

  it("takes the next flagged page after the active one", () => {
    expect(nextReviewPage(ids, "a", flagged("b", "d"))).toBe("b");
    expect(nextReviewPage(ids, "b", flagged("b", "d"))).toBe("d");
  });

  it("wraps around to the start", () => {
    expect(nextReviewPage(ids, "d", flagged("b"))).toBe("b");
    expect(nextReviewPage(ids, "c", flagged("a", "b"))).toBe("a");
  });

  it("starts from the first page when none is open", () => {
    expect(nextReviewPage(ids, null, flagged("a", "c"))).toBe("a");
    expect(nextReviewPage(ids, "gone", flagged("c"))).toBe("c");
  });

  it("is null when only the open page (or nothing) is flagged", () => {
    expect(nextReviewPage(ids, "b", flagged("b"))).toBeNull();
    expect(nextReviewPage(ids, "a", flagged())).toBeNull();
    expect(nextReviewPage([], "a", flagged("a"))).toBeNull();
  });
});
