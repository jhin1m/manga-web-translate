import { describe, expect, it } from "vitest";
import { needsReview, pageLevel } from "./page-status.ts";
import type { PageStatus } from "./status.ts";

describe("page level", () => {
  it("maps the 6 page statuses to 4 levels", () => {
    const all: PageStatus[] = ["pending", "preparing", "prepared", "translating", "ready", "failed"];
    // pending = đã xếp hàng bước 1 (đang chạy); prepared = xong bước 1, chờ người dùng bấm Dịch.
    expect(all.map(pageLevel)).toEqual(["busy", "busy", "todo", "busy", "done", "error"]);
  });

  it("flags failed pages and pending AI updates for review", () => {
    expect(needsReview({ status: "ready", ai_update_available: false })).toBe(false);
    expect(needsReview({ status: "ready", ai_update_available: true })).toBe(true);
    expect(needsReview({ status: "failed", ai_update_available: false })).toBe(true);
    expect(needsReview({ status: "ready", ai_update_available: false }, true)).toBe(true);
  });
});
