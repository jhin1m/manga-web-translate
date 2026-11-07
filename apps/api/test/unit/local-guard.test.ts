/** local-guard: chặn Host lạ (DNS rebinding) và request ghi từ origin khác (CSRF); worker (không Origin) đi qua. */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { localGuard, normalizeAllowedHost } from "../../src/middleware/local-guard.ts";

const app = new Hono();
app.use("*", localGuard(["nas.local"]));
app.all("*", (c) => c.text("ok"));

const req = (method: string, host: string | null, headers: Record<string, string> = {}) =>
  app.request("http://localhost/api/x", { method, headers: { ...(host ? { host } : {}), ...headers } });

describe("local guard", () => {
  it("rejects a foreign Host (DNS rebinding)", async () => {
    expect((await req("GET", "evil.example")).status).toBe(403);
    expect((await req("GET", "evil.example:8080")).status).toBe(403);
    expect((await req("GET", "localhost.evil.example")).status).toBe(403);
  });

  it("allows loopback names, the compose service name and MTL_ALLOWED_HOSTS", async () => {
    for (const h of ["localhost:8080", "LOCALHOST", "127.0.0.1:8080", "[::1]:8080", "app:8080", "nas.local:8080"]) {
      expect((await req("GET", h)).status, h).toBe(200);
    }
  });

  it("falls back to the URL host when no Host header (app.request in tests)", async () => {
    expect((await req("GET", null)).status).toBe(200);
  });

  it("rejects cross-origin writes", async () => {
    expect((await req("POST", "localhost:8080", { origin: "http://evil.example" })).status).toBe(403);
    expect((await req("POST", "localhost:8080", { origin: "http://localhost:5555" })).status).toBe(403);
    expect((await req("DELETE", "localhost:8080", { origin: "null" })).status).toBe(403);
    expect((await req("PUT", "localhost:8080", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("allows same-origin writes and worker writes without Origin", async () => {
    expect((await req("POST", "localhost:8080", { origin: "http://localhost:8080" })).status).toBe(200);
    expect((await req("POST", "app:8080")).status).toBe(200);
    expect((await req("POST", "localhost:8080", { "sec-fetch-site": "same-origin" })).status).toBe(200);
  });

  it("safe methods are not origin-checked (responses are unreadable cross-origin anyway)", async () => {
    expect((await req("GET", "localhost:8080", { origin: "http://evil.example" })).status).toBe(200);
  });

  it("normalizes MTL_ALLOWED_HOSTS entries (port, case, bare IPv6); drops invalid ones", async () => {
    expect(normalizeAllowedHost("NAS.local:8080")).toBe("nas.local");
    expect(normalizeAllowedHost("fe80::1")).toBe("[fe80::1]");
    expect(normalizeAllowedHost("[fe80::1]:8080")).toBe("[fe80::1]");
    expect(normalizeAllowedHost("bad host/x")).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = new Hono();
    a.use("*", localGuard(["Box.Lan:9000", "fe80::1", "bad host/x"]));
    a.all("*", (c) => c.text("ok"));
    const get = (host: string) => a.request("http://localhost/", { headers: { host } });
    expect((await get("box.lan:8080")).status).toBe(200);
    expect((await get("[fe80::1]:8080")).status).toBe(200);
    expect((await get("evil.example")).status).toBe(403);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
