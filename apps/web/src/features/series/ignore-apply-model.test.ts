import { describe, expect, it } from "vitest";
import type { IgnoreApplied, IgnorePreview, IgnoreUndone } from "./api.ts";
import { appliedSummary, describeSkipped, previewSummary, undoneSummary } from "./ignore-apply-model.ts";

const ref = { chapter_id: "c", number: "3", title: "" };

describe("ignore apply messages", () => {
  it("names skipped chapters with the reason", () => {
    expect(
      describeSkipped([
        { number: "3", reason: "busy" },
        { number: "5", reason: "locked" },
        { number: "7", reason: "changed", pages: 2 },
      ]),
    ).toBe("Chương 3 (đang chạy job), Chương 5 (đang mở sửa ở tab khác), Chương 7 (2 trang đã đổi sau đó)");
    expect(describeSkipped([])).toBe("");
  });

  it("summarises preview, apply and undo", () => {
    const pv: IgnorePreview = { chapters: [], skipped: [], total_boxes: 0 };
    expect(previewSummary(pv)).toBe("Không có box nào cần ẩn.");
    expect(
      previewSummary({ ...pv, total_boxes: 6, chapters: [{ ...ref, boxes: 6, pages: 2, samples: [], versions: {} }] }),
    ).toMatch(/^Sẽ ẩn 6 box ở 1 chương/);
    const ap: IgnoreApplied = { batch_id: "b", boxes: 6, chapters: [{ ...ref, boxes: 6, pages: 2 }], skipped: [] };
    expect(appliedSummary(ap)).toBe("Đã ẩn 6 box ở 1 chương");
    expect(appliedSummary({ ...ap, batch_id: null, chapters: [], boxes: 0 })).toBe("Chưa ẩn box nào.");
    const un: IgnoreUndone = { pages: 2, chapters: [{ ...ref, pages: 2 }], skipped: [] };
    expect(undoneSummary(un)).toBe("Đã hoàn tác 2 trang ở 1 chương.");
    expect(undoneSummary({ pages: 0, chapters: [], skipped: [] })).toBe("Không khôi phục được trang nào.");
  });
});
