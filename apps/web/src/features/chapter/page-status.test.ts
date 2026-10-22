import { describe, expect, it } from "vitest";
import { needsReview, pageLevel, thumbAria, thumbMark } from "./page-status.ts";
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

  const base = { ord: 2, status: "ready" as PageStatus, skipped: false, ai_update_available: false, cut_flag: false };
  const job = (over: Partial<NonNullable<Parameters<typeof thumbMark>[0]["job"]>>) =>
    ({
      status: "queued",
      error_class: "rate_limited",
      error: "429",
      provider_retries: 1,
      run_after: "2026-01-01T00:00:00Z",
      ...over,
    }) as Parameters<typeof thumbMark>[0]["job"];

  it("thumbnail mark priority: hidden > error > waiting on AI > needs review > none", () => {
    expect(thumbMark({ ...base, job: null }, false)).toBeNull();
    expect(thumbMark({ ...base, job: null }, true)?.label).toBe("Cần xem");
    expect(thumbMark({ ...base, ai_update_available: true, job: job({}) }, true)?.label).toBe("Chờ AI");
    expect(thumbMark({ ...base, status: "failed", job: job({}) }, true)?.label).toBe("Lỗi");
    expect(thumbMark({ ...base, status: "failed", skipped: true, job: null }, true)?.label).toBe("Đã ẩn");
  });

  it("thumbnail accessible name always carries the state", () => {
    expect(thumbAria({ ...base, job: null }, false)).toBe("Trang 3 · Xong");
    expect(thumbAria({ ...base, status: "prepared", job: null }, false)).toBe("Trang 3 · Chờ dịch");
    expect(thumbAria({ ...base, ai_update_available: true, job: null }, true)).toBe(
      "Trang 3 · Cần xem: AI có bản mới, tràn khung",
    );
    expect(thumbAria({ ...base, status: "failed", job: null }, false)).toBe("Trang 3 · Lỗi");
    expect(thumbAria({ ...base, skipped: true, job: null }, false)).toBe("Trang 3 · Đã ẩn");
  });
});
