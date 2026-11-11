/** Kiểm tra bản mới: cache 24h/6h, gộp request, lỗi, dev/tắt/override, URL dựng từ tag. Không gọi mạng thật. */
import { releaseUrl } from "@mtl/shared/update";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdateCheck, ERROR_TTL_MS, OK_TTL_MS, updateAvailable } from "../../src/lib/update-check.ts";

const HOUR = 60 * 60 * 1000;
let clock = 0;
const now = () => clock;

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: "v0.4.0",
  name: "MTL 0.4.0",
  html_url: "https://evil.test/phish",
  draft: false,
  prerelease: false,
  ...over,
});
const jsonRes = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function setup(over: Partial<Parameters<typeof createUpdateCheck>[0]> = {}, impl?: () => Promise<Response>) {
  const fetchMock = vi.fn(impl ?? (async () => jsonRes(release())));
  const check = createUpdateCheck({
    fetch: fetchMock as unknown as typeof fetch,
    now,
    current: "0.3.0",
    enabled: true,
    ...over,
  });
  return { check, fetchMock };
}

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("update check", () => {
  it("newer release → available, url built from the tag (html_url ignored)", async () => {
    const { check, fetchMock } = setup();
    const r = await check.get();
    expect(r).toEqual({
      check: "ok",
      latest: { version: "0.4.0", name: "MTL 0.4.0", url: releaseUrl("0.4.0"), source: "github" },
    });
    expect(updateAvailable("0.3.0", r)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/jhin1m/manga-web-translate/releases/latest");
    expect(init.headers).toMatchObject({ "user-agent": "mtl-selfhost", accept: "application/vnd.github+json" });
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("same or older release → not available", async () => {
    for (const tag of ["v0.3.0", "v0.2.0"]) {
      const { check } = setup({}, async () => jsonRes(release({ tag_name: tag })));
      expect(updateAvailable("0.3.0", await check.get())).toBe(false);
    }
  });

  it("dev or non-semver current → no fetch", async () => {
    for (const current of ["dev", "", "main-abc123"]) {
      const { check, fetchMock } = setup({ current });
      expect(await check.get()).toEqual({ check: "dev", latest: null });
      expect(await check.get({ fresh: true })).toEqual({ check: "dev", latest: null });
      expect(fetchMock).toHaveBeenCalledTimes(0);
    }
  });

  it("disabled → no fetch", async () => {
    const { check, fetchMock } = setup({ enabled: false });
    expect(await check.get()).toEqual({ check: "disabled", latest: null });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("override wins, no fetch, even when disabled", async () => {
    const { check, fetchMock } = setup({ enabled: false, override: "0.5.0-rc.1" });
    const r = await check.get();
    expect(r.check).toBe("ok");
    expect(r.latest).toEqual({
      version: "0.5.0-rc.1",
      name: "v0.5.0-rc.1",
      url: releaseUrl("0.5.0-rc.1"),
      source: "override",
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("invalid override is ignored with one warning, falls back to GitHub", async () => {
    const { check, fetchMock } = setup({ override: "not-a-version" });
    expect((await check.get()).latest?.source).toBe("github");
    await check.get({ fresh: true });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("MTL_UPDATE_TARGET"));
    expect(vi.mocked(console.warn).mock.calls.filter(([m]) => String(m).includes("MTL_UPDATE_TARGET"))).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches a success for 24h", async () => {
    const { check, fetchMock } = setup();
    await check.get();
    clock += OK_TTL_MS - HOUR;
    await check.get();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock += HOUR;
    await check.get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  const failures: [string, () => Promise<Response>][] = [
    ["timeout", async () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["403 rate limit", async () => jsonRes({ message: "rate limit" }, 403)],
    ["500", async () => jsonRes("oops", 500)],
    ["garbage JSON", async () => jsonRes("<html>not json")],
    ["bad tag_name", async () => jsonRes(release({ tag_name: "nightly" }))],
    ["draft", async () => jsonRes(release({ draft: true }))],
    ["prerelease", async () => jsonRes(release({ prerelease: true }))],
    ["not an object", async () => jsonRes("null")],
  ];
  it.each(failures)("caches a failure for 6h: %s", async (_name, impl) => {
    const { check, fetchMock } = setup({}, impl);
    expect(await check.get()).toEqual({ check: "error", latest: null });
    clock += ERROR_TTL_MS - 1;
    await check.get();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock += 1;
    await check.get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // One short line per failure, no stack.
    const lines = vi.mocked(console.warn).mock.calls.map(([m]) => String(m));
    expect(lines.every((l) => l.startsWith("[update-check] ") && !l.includes("\n"))).toBe(true);
  });

  it("concurrent calls share one request", async () => {
    let release_!: () => void;
    const gate = new Promise<void>((r) => {
      release_ = r;
    });
    const { check, fetchMock } = setup({}, async () => {
      await gate;
      return jsonRes(release());
    });
    const all = Promise.all(Array.from({ length: 5 }, () => check.get()));
    release_();
    const results = await all;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.latest?.version))).toEqual(new Set(["0.4.0"]));
  });

  it("fresh bypasses the cache; a failed fresh fetch returns the cached success and keeps it", async () => {
    let n = 0;
    const { check, fetchMock } = setup({}, async () => {
      n++;
      return n === 2 ? jsonRes("boom", 500) : jsonRes(release({ tag_name: n === 1 ? "v0.4.0" : "v0.5.0" }));
    });
    expect((await check.get()).latest?.version).toBe("0.4.0");
    // Fresh with a failing fetch: old good result, cache untouched.
    expect((await check.get({ fresh: true })).latest?.version).toBe("0.4.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await check.get()).latest?.version).toBe("0.4.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Fresh with a working fetch always asks GitHub and updates the cache.
    expect((await check.get({ fresh: true })).latest?.version).toBe("0.5.0");
    expect((await check.get()).latest?.version).toBe("0.5.0");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fresh with no cached success reports the error", async () => {
    const { check } = setup({}, async () => jsonRes("x", 500));
    expect((await check.get({ fresh: true })).check).toBe("error");
  });

  it("name is trimmed to 120 chars; empty → v<version>", async () => {
    const long = setup({}, async () => jsonRes(release({ name: `  ${"a".repeat(200)}  ` })));
    expect((await long.check.get()).latest?.name).toBe("a".repeat(120));
    for (const name of ["   ", "", null, 7]) {
      const { check } = setup({}, async () => jsonRes(release({ name })));
      expect((await check.get()).latest?.name).toBe("v0.4.0");
    }
  });
});
