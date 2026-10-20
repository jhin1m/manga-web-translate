import { describe, expect, it } from "vitest";
import { needsReview, pageLevel } from "./page-status.ts";
import type { PageStatus } from "./status.ts";

describe("page level", () => {
  it("maps the 6 page statuses to 4 levels", () => {
    const all: PageStatus[] = ["pending", "preparing", "prepared", "translating", "ready", "failed"];
    expect(all.map(pageLevel)).toEqual(["todo", "busy", "busy", "busy", "done", "error"]);
  });

  it("flags failed pages and pending AI updates for review", () => {
    expect(needsReview({ status: "ready", ai_update_available: false })).toBe(false);
    expect(needsReview({ status: "ready", ai_update_available: true })).toBe(true);
    expect(needsReview({ status: "failed", ai_update_available: false })).toBe(true);
  });
});
