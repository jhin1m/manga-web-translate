import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, DISABLED_LOGIN_PATH, errorMessage, sessionEffects, tabId } from "./api.ts";

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

  describe("lost session", () => {
    const reply = (status: number, body: unknown) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(body, { status })),
      );

    afterEach(() => vi.restoreAllMocks());

    it("401 → asks better-auth to refetch the session, still throws ApiError", async () => {
      const notify = vi.spyOn(sessionEffects, "refetchSession").mockImplementation(() => undefined);
      reply(401, { error: "unauthenticated" });
      await expect(api("/api/me")).rejects.toMatchObject({ status: 401 });
      expect(notify).toHaveBeenCalledOnce();
    });

    it("403 user_disabled → sign out then go to the login page with the reason", async () => {
      const signOut = vi.spyOn(sessionEffects, "signOut").mockResolvedValue({ data: null, error: null } as never);
      const assign = vi.spyOn(sessionEffects, "goto").mockImplementation(() => undefined);
      reply(403, { error: "user_disabled" });
      await expect(api("/api/me")).rejects.toMatchObject({ status: 403 });
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(DISABLED_LOGIN_PATH));
      expect(signOut).toHaveBeenCalledOnce();
    });

    it("other errors stay plain ApiError without touching the session", async () => {
      const notify = vi.spyOn(sessionEffects, "refetchSession").mockImplementation(() => undefined);
      const signOut = vi.spyOn(sessionEffects, "signOut");
      reply(403, { error: "forbidden" });
      await expect(api("/api/admin/settings")).rejects.toBeInstanceOf(ApiError);
      reply(409, { error: "busy" });
      await expect(api("/api/x")).rejects.toMatchObject({ status: 409 });
      expect(notify).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
    });
  });
});
