import { describe, expect, it } from "vitest";
import type { ProgressPage } from "./api.ts";
import { clickSelect, EMPTY_SELECTION, pruneSelection, selectablePage, selectionIds } from "./page-selection.ts";
import type { PageStatus } from "./status.ts";

const page = (n: number, over: Partial<ProgressPage> = {}): ProgressPage => ({
  id: `p${n}`,
  ord: n - 1,
  status: "ready",
  width: 800,
  height: 1200,
  clean_rev: 1,
  cut_flag: false,
  skipped: false,
  translate_queued: false,
  run_batch: null,
  ocr_ready: true,
  ai_update_available: false,
  version: 1,
  job: null,
  ...over,
});
const chapter = (over: Record<number, Partial<ProgressPage>> = {}) =>
  Array.from({ length: 8 }, (_, i) => page(i + 1, over[i + 1]));
const toggle = { shift: false, toggle: true };
const shift = { shift: true, toggle: false };

describe("page selection", () => {
  it("ctrl-click toggles single pages", () => {
    const pages = chapter();
    let sel = EMPTY_SELECTION;
    for (const id of ["p2", "p5", "p7"]) sel = clickSelect(sel, pages, id, toggle);
    expect(selectionIds(sel, pages)).toEqual(["p2", "p5", "p7"]);
    sel = clickSelect(sel, pages, "p5", toggle);
    expect(selectionIds(sel, pages)).toEqual(["p2", "p7"]);
  });

  it("shift-click selects the range from the anchor", () => {
    const pages = chapter();
    const anchored = clickSelect(EMPTY_SELECTION, pages, "p2", toggle);
    expect(selectionIds(clickSelect(anchored, pages, "p5", shift), pages)).toEqual(["p2", "p3", "p4", "p5"]);
    // Dải ngược chiều neo cũng được; shift lần nữa thay dải, neo giữ nguyên.
    const back = clickSelect(clickSelect(anchored, pages, "p5", shift), pages, "p1", shift);
    expect(selectionIds(back, pages)).toEqual(["p1", "p2"]);
    // Chưa có neo: shift-click chọn 1 trang và làm neo.
    expect(selectionIds(clickSelect(EMPTY_SELECTION, pages, "p4", shift), pages)).toEqual(["p4"]);
  });

  it("busy, hidden and not-yet-prepared pages are never selected", () => {
    const translateJob = { type: "chapter.translate", status: "queued" } as ProgressPage["job"];
    const pages = chapter({
      2: { status: "translating" },
      3: { skipped: true },
      4: { status: "pending" },
      5: { status: "preparing" },
      6: { status: "prepared", translate_queued: true, run_batch: 2 },
      7: { status: "prepared", job: translateJob },
    });
    const anchored = clickSelect(EMPTY_SELECTION, pages, "p1", toggle);
    expect(selectionIds(clickSelect(anchored, pages, "p8", shift), pages)).toEqual(["p1", "p8"]);
    expect(selectionIds(clickSelect(EMPTY_SELECTION, pages, "p4", toggle), pages)).toEqual([]);
    // Trang chọn rồi mới vào lượt dịch → tự rơi khỏi danh sách.
    const sel = clickSelect(EMPTY_SELECTION, chapter(), "p6", toggle);
    expect(selectionIds(sel, pages)).toEqual([]);
  });

  it("only translated, prepared or failed pages can be picked", () => {
    const statuses: PageStatus[] = ["pending", "preparing", "prepared", "translating", "ready", "failed"];
    expect(statuses.filter((status) => selectablePage(page(1, { status })))).toEqual(["prepared", "ready", "failed"]);
  });

  it("pages without OCR cannot be translated, however old their last job is", () => {
    const prepareFailed = { type: "page.prepare", status: "failed" } as ProgressPage["job"];
    // Lỗi xoá chữ + OCR từ hơn 24h trước: progress không còn trả job nào.
    expect(selectablePage(page(1, { status: "failed", ocr_ready: false, job: null }))).toBe(false);
    expect(selectablePage(page(1, { status: "failed", ocr_ready: false, job: prepareFailed }))).toBe(false);
    // Lỗi lúc dịch: đã có OCR → dịch lại được.
    expect(selectablePage(page(1, { status: "failed", ocr_ready: true, job: null }))).toBe(true);
  });

  it("pages that become busy are dropped from the selection for good", () => {
    let sel = EMPTY_SELECTION;
    for (const id of ["p1", "p2", "p3"]) sel = clickSelect(sel, chapter(), id, toggle);
    const translating = chapter({ 2: { translate_queued: true, run_batch: 1 }, 3: { status: "translating" } });
    const pruned = pruneSelection(sel, translating);
    expect([...pruned.ids]).toEqual(["p1"]);
    // Lượt dịch xong: trang 2, 3 không tự quay lại lựa chọn.
    expect(selectionIds(pruned, chapter())).toEqual(["p1"]);
    // Không có gì đổi → giữ nguyên object (không render lại).
    expect(pruneSelection(pruned, chapter())).toBe(pruned);
  });
});
