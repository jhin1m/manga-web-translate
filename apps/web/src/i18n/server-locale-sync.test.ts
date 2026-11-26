import { UI_LOCALES } from "@mtl/shared/ui-locale";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLocale, syncLocaleToServer } from "./i18n-store.ts";
import { BASE_MESSAGES, LOCALE_CODES } from "./locales.ts";
import en from "./messages/en.json";

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  applyLocale("vi", BASE_MESSAGES);
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ui locale registry", () => {
  it("matches the locales the API accepts, so a new locale is not silently dropped by the server", () => {
    expect([...LOCALE_CODES].sort()).toEqual([...UI_LOCALES].sort());
  });
});

describe("syncLocaleToServer", () => {
  it("pushes once at start when the server holds another locale, then on every change", () => {
    applyLocale("en", en);
    const push = vi.fn(() => Promise.resolve());
    stop = syncLocaleToServer("vi", push);
    expect(push.mock.calls).toEqual([["en"]]);
    applyLocale("vi", BASE_MESSAGES);
    applyLocale("en", en);
    expect(push.mock.calls).toEqual([["en"], ["vi"], ["en"]]);
  });

  it("does not push when the server already matches, even if the same locale is applied again", () => {
    const push = vi.fn(() => Promise.resolve());
    stop = syncLocaleToServer("vi", push);
    applyLocale("vi", BASE_MESSAGES);
    expect(push).not.toHaveBeenCalled();
  });

  it("treats a never-synced user (null) and an old API without the field as different", () => {
    const push = vi.fn(() => Promise.resolve());
    stop = syncLocaleToServer(null, push);
    expect(push.mock.calls).toEqual([["vi"]]);
    stop();
    const again = vi.fn(() => Promise.resolve());
    stop = syncLocaleToServer(undefined, again);
    expect(again.mock.calls).toEqual([["vi"]]);
  });

  it("ignores locales outside the registry (test-only registries)", () => {
    const push = vi.fn(() => Promise.resolve());
    stop = syncLocaleToServer("vi", push);
    applyLocale("xx", {});
    expect(push).not.toHaveBeenCalled();
  });

  it("a failed push is retried by the next change back to that locale and stops after unsubscribe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const push = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    stop = syncLocaleToServer("vi", push);
    applyLocale("en", en);
    await flush();
    expect(console.warn).toHaveBeenCalledTimes(1);
    applyLocale("vi", BASE_MESSAGES);
    applyLocale("en", en);
    expect(push.mock.calls).toEqual([["en"], ["en"]]);
    stop();
    applyLocale("vi", BASE_MESSAGES);
    expect(push).toHaveBeenCalledTimes(2);
  });
});
