import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "../i18n/i18n-store.ts";
import { BASE_MESSAGES } from "../i18n/locales.ts";
import en from "../i18n/messages/en.json";
import {
  ApiError,
  api,
  apiErrorText,
  DISABLED_LOGIN_PATH,
  errorMessage,
  fetchAppConfig,
  sessionEffects,
  tabId,
} from "./api.ts";

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

  describe("app config", () => {
    const reply = (res: () => Response | Promise<Response>) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => res()),
      );

    it("server reports its mode", async () => {
      reply(() => Response.json({ local_mode: true }));
      await expect(fetchAppConfig()).resolves.toEqual({ local_mode: true });
    });

    it("404 / 401 (older API without the route, signed in / signed out) → multi-user mode, not the error screen", async () => {
      vi.spyOn(sessionEffects, "refetchSession").mockImplementation(() => undefined);
      reply(() => Response.json({ error: "not_found" }, { status: 404 }));
      await expect(fetchAppConfig()).resolves.toEqual({ local_mode: false });
      reply(() => Response.json({ error: "unauthenticated" }, { status: 401 }));
      await expect(fetchAppConfig()).resolves.toEqual({ local_mode: false });
      vi.restoreAllMocks();
    });

    it("5xx and network errors still fail (mode unknown → error screen)", async () => {
      reply(() => Response.json({ error: "internal" }, { status: 502 }));
      await expect(fetchAppConfig()).rejects.toMatchObject({ status: 502 });
      reply(() => Promise.reject(new TypeError("Failed to fetch")));
      await expect(fetchAppConfig()).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("API error codes", () => {
    afterEach(() => applyLocale("vi", BASE_MESSAGES));

    const taken = () =>
      new ApiError(409, "series đã có chương 12", {
        error: "chapter_number_taken",
        message: "series đã có chương 12",
        params: { number: "12" },
      });
    const busy = () =>
      new ApiError(409, "chương đang xử lý — chờ xong rồi xuất", {
        error: "chapter_busy",
        variant: "export",
        message: "chương đang xử lý — chờ xong rồi xuất",
        params: {},
      });

    it("vi: a known code reads the same sentence the API sent, variants included", () => {
      expect(errorMessage(taken())).toBe("series đã có chương 12");
      expect(errorMessage(busy())).toBe("chương đang xử lý — chờ xong rồi xuất");
    });

    it("en: a known code is translated with its params", () => {
      applyLocale("en", en);
      expect(errorMessage(taken())).toBe("This series already has chapter 12");
      expect(errorMessage(busy())).toBe("The chapter is being processed — wait, then export");
    });

    it("unknown code: vi keeps the server message, en says something went wrong with the code", () => {
      const e = new ApiError(409, "lỗi lạ", { error: "brand_new", message: "lỗi lạ" });
      expect(errorMessage(e)).toBe("lỗi lạ");
      applyLocale("en", en);
      expect(errorMessage(e)).toBe("Something went wrong (brand_new)");
      expect(errorMessage(new ApiError(409, "busy"))).toBe("busy");
    });

    it("a known code without the params its sentence needs (older API) never shows a raw placeholder", () => {
      const old = { error: "chapter_number_taken", message: "series đã có chương 12" };
      expect(apiErrorText(old)).toBe("series đã có chương 12");
      applyLocale("en", en);
      expect(apiErrorText(old)).toBe("series đã có chương 12");
      expect(apiErrorText({ error: "chapter_number_taken" })).toBe("Something went wrong (chapter_number_taken)");
      expect(apiErrorText({ error: "chapter_number_taken", params: { other: "1" } })).not.toContain("{");
      // Đủ tham số (giá trị tự chứa ngoặc nhọn) vẫn dịch bình thường.
      expect(apiErrorText({ error: "chapter_number_taken", params: { number: "{12}" } })).toBe(
        "This series already has chapter {12}",
      );
    });

    it("an invalid_body issue carrying an API code is translated (ignore-text reasons)", () => {
      const body = {
        error: "invalid_body",
        issues: [{ code: "custom", message: "regex không hợp lệ", params: { error: "regex_invalid", params: {} } }],
      };
      expect(apiErrorText(body)).toBe("regex không hợp lệ");
      applyLocale("en", en);
      expect(apiErrorText(body)).toBe("invalid regex");
      expect(apiErrorText({ error: "invalid_body", issues: [] })).toBe("The submitted data is invalid");
    });

    it("glossary CSV line errors translate by code and keep old rows (message only) readable", () => {
      const row = { line: 3, error: "csv_invalid_fields", params: { fields: "target_term" }, message: "target_term" };
      expect(apiErrorText(row)).toBe("target_term");
      applyLocale("en", en);
      expect(apiErrorText(row)).toBe("invalid value in target_term");
      expect(apiErrorText({ line: 2, message: "dòng cũ" })).toBe("dòng cũ");
    });

    it("the thrown ApiError message is already in the UI language", async () => {
      applyLocale("en", en);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { error: "no_pages", variant: "export", message: "chương chưa có trang để xuất", params: {} },
            { status: 409 },
          ),
        ),
      );
      await expect(api("/api/x")).rejects.toMatchObject({ message: "The chapter has no pages to export" });
    });
  });
});
