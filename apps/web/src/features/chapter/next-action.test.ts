import { describe, expect, it } from "vitest";
import type { ChapterStatus, PageCounts } from "../series/api.ts";
import { needsWork, nextAction } from "./next-action.ts";

const pc = (total: number, ready = 0, failed = 0): PageCounts => ({
  total,
  ready,
  failed,
  busy: total - ready - failed,
});
const ch = (status: ChapterStatus, page_counts = pc(0), exported = false) => ({ status, page_counts, exported });

describe("nextAction", () => {
  it("maps every chapter situation to exactly one primary action", () => {
    const cases: [ReturnType<typeof nextAction>, string][] = [
      [nextAction(ch("draft"), { phase: "incomplete", done: 3, total: 10 }), "Tải tiếp ảnh"],
      [nextAction(ch("draft"), { phase: "failed", done: 9, total: 10 }), "Tải tiếp ảnh"],
      [nextAction(ch("draft"), { phase: "uploading", done: 2, total: 10 }), "Xem tiến độ"],
      [nextAction(ch("draft"), { phase: "uploaded", done: 10, total: 10 }), "Dịch chương"],
      [nextAction(ch("draft")), "Dịch chương"],
      [nextAction(ch("ingesting")), "Xem tiến độ"],
      [nextAction(ch("processing", pc(52, 24))), "Xem tiến độ"],
      [nextAction(ch("partial_failed", pc(48, 47, 1))), "Chạy lại trang lỗi"],
      [nextAction(ch("partial_failed", pc(0))), "Dịch chương"],
      [nextAction(ch("review", pc(54, 54))), "Tiếp tục sửa"],
      [nextAction(ch("review", pc(54, 54), true)), "Mở"],
      [nextAction(ch("done", pc(54, 54))), "Mở"],
    ];
    for (const [got, label] of cases) expect(got.action).toBe(label);
  });

  it("describes progress in words", () => {
    expect(nextAction(ch("processing", pc(52, 24))).detail).toBe("24/52 trang xong");
    expect(nextAction(ch("partial_failed", pc(48, 47, 1))).state).toBe("Lỗi 1 trang");
    expect(nextAction(ch("draft"), { phase: "uploading", done: 5, total: 10 }).progress).toBe(0.5);
  });

  it("treats exported or done chapters as finished", () => {
    expect(needsWork(ch("review", pc(1, 1), true))).toBe(false);
    expect(needsWork(ch("done"))).toBe(false);
    expect(needsWork(ch("draft"))).toBe(true);
  });
});
