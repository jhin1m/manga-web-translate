/** API phục vụ SPA: file tĩnh, cache theo loại, fallback index.html cho route client, không nuốt đường dẫn server. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isServerPath, mountSpa } from "../../src/lib/spa-static.ts";

let dir: string;
let app: Hono;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mtl-spa-"));
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>mtl</title>");
  await writeFile(join(dir, "assets", "app-abc.js"), "console.log(1)");
  await writeFile(join(dir, "favicon.svg"), "<svg/>");
  app = new Hono();
  app.get("/api/me", (c) => c.json({ ok: true }));
  mountSpa(app, dir);
  app.notFound((c) => c.json({ error: "not_found" }, 404));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const get = (path: string) => app.request(`http://localhost${path}`);

describe("spa static", () => {
  it("serves hashed assets as immutable and other files as no-cache", async () => {
    const js = await get("/assets/app-abc.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const icon = await get("/favicon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("cache-control")).toBe("no-cache");
  });

  it("client routes fall back to index.html (no-cache)", async () => {
    for (const p of ["/", "/settings", "/s/abc/c/def"]) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("cache-control"), p).toBe("no-cache");
      expect(await res.text(), p).toContain("<title>mtl</title>");
    }
  });

  it("missing asset → 404 without a long-lived cache header", async () => {
    const res = await get("/assets/old-123.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control") ?? "").not.toContain("immutable");
  });

  it("server paths never fall into the SPA", async () => {
    expect(await (await get("/api/me")).json()).toEqual({ ok: true });
    for (const p of ["/api/nope", "/worker/v1/x", "/files/u/x", "/healthz", "/readyz"]) {
      expect((await get(p)).status, p).toBe(404);
    }
    expect(isServerPath("/apix")).toBe(false);
    expect(isServerPath("/api")).toBe(true);
  });

  it("path traversal does not escape the build dir", async () => {
    const res = await get("/..%2f..%2fetc%2fpasswd");
    expect(await res.text()).not.toContain("root:");
  });
});
