import { createElement, isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collator, fmtDate, fmtNumber } from "./format.ts";
import {
  applyLocale,
  detectLocale,
  I18N_INIT_TIMEOUT_MS,
  i18nStore,
  initI18n,
  LOCALE_STORAGE_KEY,
  setLocale,
} from "./i18n-store.ts";
import { BASE_MESSAGES, LOCALES, loadMessages } from "./locales.ts";
import en from "./messages/en.json";
import { t, tNode, tp } from "./t.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  applyLocale("vi", BASE_MESSAGES);
});

/** `document` + `localStorage` tối thiểu để kiểm phần chạy trên trình duyệt. */
function fakeBrowser(languages: string[], stored: Record<string, string> = {}) {
  const html = { lang: "vi" };
  const store = new Map(Object.entries(stored));
  vi.stubGlobal("document", { documentElement: html });
  vi.stubGlobal("navigator", { languages, language: languages[0] ?? "" });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return { html, store };
}

describe("t", () => {
  it("defaults to Vietnamese without a browser", () => {
    expect(i18nStore.getState().locale).toBe("vi");
    expect(t("common.save")).toBe("Lưu");
  });

  it("interpolates params and keeps placeholders that have no param", () => {
    expect(tp("common.pages", 3)).toBe("3 trang");
    applyLocale("en", en);
    expect(t("common.save")).toBe("Save");
    expect(tp("common.pages", 2, { count: "two" })).toBe("two pages");
    applyLocale("xx", { "common.save": "{who} saves {what}" });
    expect(t("common.save", { who: "Ann" })).toBe("Ann saves {what}");
    expect(t("common.save")).toBe("{who} saves {what}");
  });

  it("picks plural forms per locale: Vietnamese has one form, English one/other", () => {
    expect([0, 1, 5].map((n) => tp("common.pages", n))).toEqual(["0 trang", "1 trang", "5 trang"]);
    applyLocale("en", en);
    expect([0, 1, 5].map((n) => tp("common.pages", n))).toEqual(["0 pages", "1 page", "5 pages"]);
  });

  it("falls back to Vietnamese for keys missing in the active locale", () => {
    applyLocale("en", { "common.save": "Save" });
    expect(t("common.save")).toBe("Save");
    expect(t("common.cancel")).toBe("Huỷ");
    expect(tp("common.pages", 1)).toBe("1 trang");
  });

  it("works with a temporary locale that is not in the registry", () => {
    // Tiếng Ba Lan có nhóm "few"/"many" — t.ts không cần biết trước.
    applyLocale("pl", {
      "common.pages.one": "{count} strona",
      "common.pages.other": "{count} strony",
      "common.close": "Zamknij",
    });
    expect(t("common.close")).toBe("Zamknij");
    expect(tp("common.pages", 1)).toBe("1 strona");
    expect(tp("common.pages", 3)).toBe("3 strony");
    expect(t("common.save")).toBe("Lưu");
  });

  it("tNode puts elements in place of placeholders and keys them", () => {
    applyLocale("xx", { "common.save": "Press {action} then {next}, {missing}" });
    const out = tNode("common.save", { action: createElement("b", null, "Save"), next: "wait" });
    expect(out.slice(0, 2)).toEqual(["Press ", expect.anything()]);
    expect(out.slice(2)).toEqual([" then ", "wait", ", {missing}"]);
    const el = out[1];
    expect(isValidElement(el) && el.key).toBeTruthy();
  });
});

describe("detectLocale", () => {
  it("matches browser languages by prefix, falls back to English, and to Vietnamese without a browser", () => {
    expect(detectLocale({ languages: ["vi-VN", "en-US"] })).toBe("vi");
    expect(detectLocale({ languages: ["fr-FR", "en-GB"] })).toBe("en");
    expect(detectLocale({ languages: ["fr-FR"] })).toBe("en");
    expect(detectLocale({ languages: ["de-DE", "VI"] })).toBe("vi");
    expect(detectLocale({})).toBe("vi");
    expect(detectLocale({ languages: [] })).toBe("vi");
  });

  it("a stored choice wins over the browser; unknown stored values are ignored", () => {
    expect(detectLocale({ stored: "en", languages: ["vi-VN"] })).toBe("en");
    expect(detectLocale({ stored: "vi", languages: ["en-US"] })).toBe("vi");
    expect(detectLocale({ stored: "klingon", languages: ["vi-VN"] })).toBe("vi");
  });

  it("accepts a temporary registry, preferring an exact region match", () => {
    const registry = { codes: ["vi", "en", "pt", "pt-br"], base: "vi", foreign: "en" };
    expect(detectLocale({ languages: ["pt-BR"] }, registry)).toBe("pt-br");
    expect(detectLocale({ languages: ["pt-PT"] }, registry)).toBe("pt");
    expect(detectLocale({ languages: ["ja"] }, registry)).toBe("en");
  });

  it("reads navigator and storage only in a browser (Node's navigator says en-US)", () => {
    expect(detectLocale()).toBe("vi");
    fakeBrowser(["fr-FR"]);
    expect(detectLocale()).toBe("en");
    fakeBrowser(["fr-FR"], { [LOCALE_STORAGE_KEY]: "vi" });
    expect(detectLocale()).toBe("vi");
  });
});

describe("setLocale / initI18n", () => {
  it("applies at once, remembers the choice and sets <html lang>", async () => {
    const { html, store } = fakeBrowser(["vi-VN"]);
    await setLocale("en");
    expect(t("common.save")).toBe("Save");
    expect(html.lang).toBe("en");
    expect(store.get(LOCALE_STORAGE_KEY)).toBe("en");
    // Lần mở sau (reload) đọc lại lựa chọn đã lưu.
    expect(detectLocale()).toBe("en");
    await setLocale("vi");
    expect(t("common.save")).toBe("Lưu");
    expect(html.lang).toBe("vi");
    expect(store.get(LOCALE_STORAGE_KEY)).toBe("vi");
  });

  it("keeps the latest choice when an earlier load finishes later", async () => {
    fakeBrowser(["vi-VN"]);
    const slow = setLocale("en");
    const fast = setLocale("vi");
    await Promise.all([slow, fast]);
    expect(i18nStore.getState().locale).toBe("vi");
  });

  it("initI18n uses the detected locale without storing it", async () => {
    const { html, store } = fakeBrowser(["en-US"]);
    await initI18n();
    expect(i18nStore.getState().locale).toBe("en");
    expect(html.lang).toBe("en");
    expect(store.has(LOCALE_STORAGE_KEY)).toBe(false);
  });

  it("initI18n falls back to Vietnamese when a locale fails to load", async () => {
    fakeBrowser(["en-US"]);
    const enDef = LOCALES.find((l) => l.code === "en");
    if (!enDef) throw new Error("en missing from LOCALES");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(enDef, "load").mockRejectedValue(new Error("offline"));
    await initI18n();
    expect(i18nStore.getState().locale).toBe("vi");
    expect(warn).toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });

  it("initI18n renders in Vietnamese when the bundle hangs past the time limit, and ignores the late bundle", async () => {
    const { html, store } = fakeBrowser(["en-US"]);
    const enDef = LOCALES.find((l) => l.code === "en");
    if (!enDef) throw new Error("en missing from LOCALES");
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let finish: (m: typeof en) => void = () => {};
    const spy = vi.spyOn(enDef, "load").mockReturnValue(new Promise((resolve) => (finish = resolve)));
    try {
      let done = false;
      const init = initI18n().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(I18N_INIT_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await init;
      expect(i18nStore.getState().locale).toBe("vi");
      expect(html.lang).toBe("vi");
      expect(store.has(LOCALE_STORAGE_KEY)).toBe(false);
      expect(warn).toHaveBeenCalled();
      finish(en);
      await vi.advanceTimersByTimeAsync(0);
      expect(t("common.save")).toBe("Lưu");
    } finally {
      spy.mockRestore();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("initI18n leaves no pending timer when the bundle loads in time", async () => {
    fakeBrowser(["en-US"]);
    vi.useFakeTimers();
    try {
      await initI18n();
      expect(i18nStore.getState().locale).toBe("en");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loadMessages loads the English bundle lazily", async () => {
    expect((await loadMessages("en"))["common.save"]).toBe("Save");
    expect(await loadMessages("vi")).toBe(BASE_MESSAGES);
  });
});

describe("format", () => {
  it("formats numbers and dates per locale and returns an empty string for bad dates", () => {
    expect(fmtNumber(1234.5)).toBe("1.234,5");
    expect(
      fmtDate("2026-11-25T12:00:00Z", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }),
    ).toBe("25/11/2026");
    expect(fmtDate("not a date")).toBe("");
    applyLocale("en", en);
    expect(fmtNumber(1234.5)).toBe("1,234.5");
    expect(
      fmtDate(Date.UTC(2026, 10, 25), { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }),
    ).toBe("11/25/2026");
  });

  it("collator sorts naturally for the active locale and is cached", () => {
    expect(["b10", "B2", "a"].sort(collator().compare)).toEqual(["a", "B2", "b10"]);
    expect(collator()).toBe(collator());
    expect(collator().resolvedOptions().locale).toBe("vi");
    applyLocale("en", en);
    expect(collator().resolvedOptions().locale).toBe("en");
  });
});
