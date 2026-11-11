/**
 * GET/POST /api/admin/update trong chế độ local trên Postgres test. Updater giả là node:http; GitHub giả bằng fetch
 * inject → không gọi mạng. Ngoài local mode cả hai route là 404.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateRun, UpdateStatus } from "@mtl/shared/update";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { db } from "../src/db.ts";
import { env } from "../src/env.ts";
import { createUpdateCheck, setUpdateCheckForTest } from "../src/lib/update-check.ts";
import { setUpdaterBaseForTest } from "../src/lib/updater-client.ts";
import { ensureLocalUser, setLocalUserForTest } from "../src/local/local-user.ts";
import { resetUpdateCooldownForTest } from "../src/routes/admin-update.ts";
import { call, seedAdmin } from "./helpers.ts";

const CURRENT = "0.3.0";
const run: UpdateRun = {
  state: "running",
  target: "0.4.0",
  from: CURRENT,
  step: "preflight",
  started_at: "2026-11-11T00:00:00.000Z",
  finished_at: null,
  exit_code: null,
  reason: null,
  log_tail: [],
};

type Seen = { method?: string; url?: string; auth?: string; ctype?: string; body: string };
let updater: Server;
let seen: Seen[];
let reply: (req: Seen) => { status: number; body: unknown };
let dir: string;
let app: ReturnType<typeof createApp>;
let github: ReturnType<typeof vi.fn>;
const saved = { ...env };

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let b = "";
    req.on("data", (d) => {
      b += d;
    });
    req.on("end", () => resolve(b));
  });

function useGithub(tag: string, over: Record<string, unknown> = {}) {
  github = vi.fn(async () => new Response(JSON.stringify({ tag_name: tag, name: `MTL ${tag}`, ...over })));
  setUpdateCheckForTest(
    createUpdateCheck({ fetch: github as unknown as typeof fetch, current: CURRENT, enabled: true }),
  );
}

const get = () => app.request("/api/admin/update");
const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  app.request("/api/admin/update", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mtl-admin-update-"));
  env.MTL_LOCAL_MODE = true;
  env.MTL_DATA_DIR = dir;
  await ensureLocalUser(db);
  app = createApp();
  updater = createServer(async (req, res) => {
    const s: Seen = {
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      ctype: req.headers["content-type"],
      body: await readBody(req),
    };
    seen.push(s);
    const r = reply(s);
    res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.body));
  });
  await new Promise<void>((resolve) => updater.listen(0, "127.0.0.1", resolve));
  setUpdaterBaseForTest(`http://127.0.0.1:${(updater.address() as AddressInfo).port}`);
});

afterAll(async () => {
  await new Promise((resolve) => updater.close(resolve));
  setUpdaterBaseForTest(null);
  setUpdateCheckForTest(null);
  env.MTL_LOCAL_MODE = false;
  env.MTL_DATA_DIR = saved.MTL_DATA_DIR;
  env.MTL_TAG = saved.MTL_TAG;
  env.MTL_UPDATER = saved.MTL_UPDATER;
  setLocalUserForTest(null);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  seen = [];
  reply = (req) =>
    req.method === "GET"
      ? { status: 200, body: { ready: true, reason: null, project: "mtl-local", run: null } }
      : { status: 202, body: { run } };
  env.MTL_TAG = undefined;
  env.MTL_UPDATER = true;
  resetUpdateCooldownForTest();
  useGithub("v0.4.0");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/admin/update", () => {
  it("merges check, updater status and pinned_tag", async () => {
    env.MTL_TAG = "0.3.0";
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const expected: UpdateStatus = {
      current: CURRENT,
      check: "ok",
      latest: {
        version: "0.4.0",
        name: "MTL v0.4.0",
        url: "https://github.com/jhin1m/manga-web-translate/releases/tag/v0.4.0",
        source: "github",
      },
      update_available: true,
      pinned_tag: "0.3.0",
      updater: { ready: true, reason: null, project: "mtl-local", run: null },
    };
    expect(await res.json()).toEqual(expected);
    // Same token file is used for every call.
    expect(seen[0]?.auth).toMatch(/^Bearer [\w-]{43}$/);
  });

  it("MTL_TAG=latest is not a pin", async () => {
    env.MTL_TAG = "latest";
    expect(((await (await get()).json()) as UpdateStatus).pinned_tag).toBeNull();
  });

  it("updater down → 200 with ready false, reason unavailable", async () => {
    setUpdaterBaseForTest("http://127.0.0.1:1");
    try {
      const res = await get();
      expect(res.status).toBe(200);
      expect(((await res.json()) as UpdateStatus).updater).toEqual({
        ready: false,
        reason: "unavailable",
        project: null,
        run: null,
      });
    } finally {
      setUpdaterBaseForTest(`http://127.0.0.1:${(updater.address() as AddressInfo).port}`);
    }
  });

  it("updater rejecting the token → reason internal", async () => {
    reply = () => ({ status: 401, body: { error: "unauthorized" } });
    expect(((await (await get()).json()) as UpdateStatus).updater).toMatchObject({ ready: false, reason: "internal" });
  });

  it("updater keeps its own reason on a non-2xx status (503 not_ready)", async () => {
    reply = () => ({ status: 503, body: { reason: "not_ready" } });
    expect(((await (await get()).json()) as UpdateStatus).updater).toMatchObject({ ready: false, reason: "not_ready" });
  });

  it("non-2xx with an unknown or missing reason → internal", async () => {
    reply = () => ({ status: 500, body: { reason: "whatever" } });
    expect(((await (await get()).json()) as UpdateStatus).updater).toMatchObject({ ready: false, reason: "internal" });
  });

  it("MTL_UPDATER=0 → unavailable without any request to the updater", async () => {
    env.MTL_UPDATER = false;
    expect(((await (await get()).json()) as UpdateStatus).updater).toEqual({
      ready: false,
      reason: "unavailable",
      project: null,
      run: null,
    });
    expect(seen).toHaveLength(0);
  });

  it("dev build → check dev, no GitHub request", async () => {
    setUpdateCheckForTest(
      createUpdateCheck({ fetch: github as unknown as typeof fetch, current: "dev", enabled: true }),
    );
    const body = (await (await get()).json()) as UpdateStatus;
    expect(body).toMatchObject({ current: "dev", check: "dev", latest: null, update_available: false });
    expect(github).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/update", () => {
  it("without a JSON content-type → 415", async () => {
    const res = await post("version=0.4.0", { "content-type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(415);
    expect((await post("{}", {})).status).toBe(415);
    expect(seen).toHaveLength(0);
  });

  it("cross-site Origin → 403 from the local guard", async () => {
    const res = await post({ version: "0.4.0" }, { "content-type": "application/json", origin: "http://evil.test" });
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("bad version → 400; invalid body → 400", async () => {
    for (const version of ["latest", "1.2", "0.4.0+build", "../x"]) {
      const res = await post({ version });
      expect(res.status, version).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_version" });
    }
    expect((await post({ version: 4 })).status).toBe(400);
    expect((await post({ version: "1".repeat(65) })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  it("stale version → 409", async () => {
    for (const version of ["0.3.5", "0.5.0", "0.3.0"]) {
      const res = await post({ version });
      expect(res.status, version).toBe(409);
      expect(await res.json()).toMatchObject({ error: "stale" });
    }
    expect(seen).toHaveLength(0);
  });

  it("nothing newer upstream → 409 stale", async () => {
    useGithub("v0.3.0");
    expect((await post({ version: "0.3.0" })).status).toBe(409);
  });

  it("re-checks GitHub on every trigger (cache bypassed)", async () => {
    await get();
    expect(github).toHaveBeenCalledTimes(1);
    await post({ version: "0.4.0" });
    expect(github).toHaveBeenCalledTimes(2);
  });

  it("pinned + stable target → 422; pinned + prerelease override → 202", async () => {
    env.MTL_TAG = "0.3.0";
    const res = await post({ version: "0.4.0" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "pinned" });
    expect(seen).toHaveLength(0);

    setUpdateCheckForTest(
      createUpdateCheck({
        current: CURRENT,
        enabled: false,
        override: "0.4.0-rc.1",
        fetch: github as unknown as typeof fetch,
      }),
    );
    github.mockClear();
    const ok = await post({ version: "0.4.0-rc.1" });
    expect(ok.status).toBe(202);
    expect(github).not.toHaveBeenCalled();
  });

  it("success → 202 {run}; updater gets exactly {version} with the Bearer token", async () => {
    const res = await post({ version: "v0.4.0" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ run });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/update", ctype: "application/json" });
    expect(JSON.parse(seen[0]?.body ?? "")).toEqual({ version: "0.4.0" });
    const token = (await import("node:fs")).readFileSync(join(dir, "secrets", "updater-token"), "utf8").trim();
    expect(seen[0]?.auth).toBe(`Bearer ${token}`);
  });

  it("a second trigger within 60s → 429", async () => {
    expect((await post({ version: "0.4.0" })).status).toBe(202);
    const res = await post({ version: "0.4.0" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "cooldown" });
    expect(seen).toHaveLength(1);
  });

  it("updater replies 409 busy → 409 busy, cooldown not consumed", async () => {
    reply = () => ({ status: 409, body: { error: "busy", reason: "busy" } });
    const res = await post({ version: "0.4.0" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "busy", reason: "busy" });
    reply = () => ({ status: 202, body: { run } });
    expect((await post({ version: "0.4.0" })).status).toBe(202);
  });

  it("updater reasons are passed through with their status", async () => {
    reply = () => ({ status: 422, body: { reason: "path_mismatch" } });
    const res = await post({ version: "0.4.0" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "path_mismatch" });
  });

  it("updater unreachable → 503 unavailable", async () => {
    setUpdaterBaseForTest("http://127.0.0.1:1");
    try {
      const res = await post({ version: "0.4.0" });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "unavailable" });
    } finally {
      setUpdaterBaseForTest(`http://127.0.0.1:${(updater.address() as AddressInfo).port}`);
    }
  });
});

describe("MTL_UPDATER=0", () => {
  it("POST → 503 unavailable and the updater is never called", async () => {
    env.MTL_UPDATER = false;
    const res = await post({ version: "0.4.0" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "unavailable" });
    expect(seen).toHaveLength(0);
  });
});

describe("token file", () => {
  it("is created 0600 under MTL_DATA_DIR/secrets on first use", async () => {
    const path = join(dir, "secrets", "updater-token");
    await get();
    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);
  });
});

describe("outside local mode", () => {
  it("both routes are 404 for an admin", async () => {
    const admin = await seedAdmin("admin-update-nonlocal");
    // `call` uses the app built at import time (no local guard, real sessions); the route checks the mode per request.
    env.MTL_LOCAL_MODE = false;
    try {
      expect((await call("/api/admin/update", { cookie: admin.cookie })).status).toBe(404);
      const res = await call("/api/admin/update", { method: "POST", cookie: admin.cookie, body: { version: "0.4.0" } });
      expect(res.status).toBe(404);
    } finally {
      env.MTL_LOCAL_MODE = true;
    }
  });
});
