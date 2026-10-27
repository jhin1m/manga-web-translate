import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, errorMessage, tabId } from "./api.ts";

describe("api helpers", () => {
  it("402 quota_exceeded → câu hạn mức kèm số đã dùng / hạn mức", () => {
    const e = new ApiError(402, "quota_exceeded", {
      error: "quota_exceeded",
      spent_usd: 1.234,
      limit_usd: 1,
      resets_at: "2026-10-25T00:00:00Z",
    });
    expect(errorMessage(e)).toMatch(/^Đã dùng hết hạn mức hôm nay \(\$1\.23 \/ \$1\.00\) — thử lại sau \d{2}:\d{2}$/);
    expect(errorMessage(new ApiError(409, "busy"))).toBe("busy");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("every request carries the tab id (chapter lock per tab)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/me");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-tab-id"]).toBe(tabId());
  });

  it("tab id is stable within the page", () => {
    expect(tabId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(tabId()).toBe(tabId());
  });
});
