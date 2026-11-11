/** The updater's HTTP service against a fake Docker daemon listening on a temporary unix socket. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InspectContainer } from "../../src/updater/discovery.ts";
import { LABEL } from "../../src/updater/discovery.ts";
import { createUpdaterServer } from "../../src/updater/server.ts";
import fixture from "./fixtures/docker-inspect-orbstack.json" with { type: "json" };

const TOKEN = "unit-token-0123456789";
const SELF_IMAGE = "sha256:a1d1a89d981c03c45c7fa8d90ee9d3afa162ac41047bcdfcc0642ee4bc63a11c";

type Fake = {
  containers: InspectContainer[];
  runner: InspectContainer | null;
  runnerLogs: string;
  created: { name: string; body: Record<string, unknown> }[];
  started: string[];
  removed: string[];
  createError: { status: number; message: string } | null;
  versionError: boolean;
};

const runnerInspect = (over: Partial<InspectContainer> = {}): InspectContainer => ({
  Id: "runner-old",
  Config: { Labels: { "io.github.jhin1m.mtl.update-target": "0.3.0", "io.github.jhin1m.mtl.update-from": "0.2.0" } },
  State: { Status: "running", ExitCode: 0, StartedAt: "2026-11-11T10:00:00Z", FinishedAt: "0001-01-01T00:00:00Z" },
  Created: "2026-11-11T10:00:00Z",
  ...over,
});

let dir: string;
let sock: string;
let fake: Fake;
let docker: http.Server;
let updater: http.Server;
let base: string;
let clock: number;

const appOf = () => fake.containers.find((c) => c.Config.Labels?.[LABEL.service] === "app") as InspectContainer;

/** Sets what the operator configured on the running app container. */
function setUpdateTarget(value: string) {
  const app = appOf();
  app.Config.Env = (app.Config.Env ?? []).map((e) =>
    e.startsWith("MTL_UPDATE_TARGET=") ? `MTL_UPDATE_TARGET=${value}` : e,
  );
}

const selfOf = () => fake.containers.find((c) => c.Config.Labels?.[LABEL.service] === "updater") as InspectContainer;

function startFake(): Promise<void> {
  docker = http.createServer((req, res) => {
    const url = new URL(req.url ?? "", "http://x");
    const path = url.pathname.replace(/^\/v1\.44/, "");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (fake.versionError)
        return send(400, { message: "client version 1.44 is too old. Minimum supported API version is 1.99" });
      const m = /^\/containers\/([^/]+)\/(json|logs|start)$/.exec(path);
      if (req.method === "GET" && path === "/containers/json") {
        return send(
          200,
          fake.containers.map((c) => ({ Id: c.Id, Labels: c.Config.Labels })),
        );
      }
      if (req.method === "POST" && path === "/containers/create") {
        if (fake.createError) return send(fake.createError.status, { message: fake.createError.message });
        if (fake.runner) return send(409, { message: "name already in use" });
        fake.created.push({
          name: url.searchParams.get("name") ?? "",
          body: JSON.parse(Buffer.concat(chunks).toString()),
        });
        return send(201, { Id: "runner-new" });
      }
      if (req.method === "DELETE") {
        fake.removed.push(decodeURIComponent(path.split("/").pop() ?? ""));
        if (fake.runner && fake.runner.State?.Status !== "running") fake.runner = null;
        res.writeHead(204);
        return res.end();
      }
      if (m && req.method === "POST" && m[2] === "start") {
        fake.started.push(m[1] as string);
        res.writeHead(204);
        return res.end();
      }
      if (m && req.method === "GET" && m[2] === "logs") {
        res.writeHead(200);
        return res.end(fake.runnerLogs);
      }
      if (m && req.method === "GET" && m[2] === "json") {
        const id = decodeURIComponent(m[1] as string);
        if (id === "mtl-local-update") {
          const created = fake.created.length > 0;
          if (fake.runner) return send(200, fake.runner);
          return created ? send(200, runnerInspect({ Id: "runner-new" })) : send(404, { message: "no such container" });
        }
        const c = fake.containers.find((x) => x.Id.startsWith(id) || x.Id === id);
        return c ? send(200, c) : send(404, { message: "no such container" });
      }
      send(404, { message: "unknown route" });
    });
  });
  return new Promise((r) => docker.listen(sock, () => r()));
}

function startUpdater(socketPath = sock): Promise<void> {
  updater = createUpdaterServer({
    socketPath,
    tokenPath: join(dir, "updater-token"),
    hostname: selfOf().Id.slice(0, 12),
    now: () => clock,
    cooldownMs: 60_000,
  });
  return new Promise((r) => updater.listen(0, "127.0.0.1", () => r()));
}

type Body = { reason?: string; detail?: string; run?: { log_tail: string[] } & Record<string, unknown> } & Record<
  string,
  unknown
>;

async function call(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; raw?: string; type?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? TOKEN}`;
  const payload = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  if (payload !== undefined && opts.type !== null) headers["content-type"] = opts.type ?? "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Body) : null };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mtl-updater-"));
  sock = join(dir, "docker.sock");
  await writeFile(join(dir, "updater-token"), `${TOKEN}\n`);
  clock = 1_000_000;
  fake = {
    containers: structuredClone(fixture.containers) as InspectContainer[],
    runner: null,
    runnerLogs: "",
    created: [],
    started: [],
    removed: [],
    createError: null,
    versionError: false,
  };
  for (const c of fake.containers) if (c.Config.Labels?.[LABEL.service] === "updater") c.Image = SELF_IMAGE;
  await startFake();
  await startUpdater();
  base = `http://127.0.0.1:${(updater.address() as AddressInfo).port}`;
});

afterEach(async () => {
  updater.close();
  docker.close();
  await rm(dir, { recursive: true, force: true });
});

describe("authentication and routing", () => {
  it("rejects missing, wrong and different-length tokens", async () => {
    expect((await call("GET", "/v1/status", { token: null })).status).toBe(401);
    expect((await call("GET", "/v1/status", { token: "wrong" })).status).toBe(401);
    expect((await call("GET", "/v1/status", { token: `${TOKEN}x` })).status).toBe(401);
    expect((await call("GET", "/v1/status", { token: TOKEN.replace("u", "U") })).status).toBe(401);
    expect((await call("GET", "/v1/status")).status).toBe(200);
  });

  it("503 not_ready while the token file does not exist", async () => {
    await rm(join(dir, "updater-token"));
    const r = await call("GET", "/v1/status");
    expect(r.status).toBe(503);
    expect(r.json?.reason).toBe("not_ready");
  });

  it("unknown routes are 404 (after authentication)", async () => {
    expect((await call("GET", "/v1/other")).status).toBe(404);
    expect((await call("POST", "/v1/status", { body: {} })).status).toBe(404);
    expect((await call("GET", "/v1/other", { token: null })).status).toBe(401);
  });

  it("POST body: JSON only, at most 1 KB, valid version", async () => {
    expect((await call("POST", "/v1/update", { body: { version: "0.3.0" }, type: "text/plain" })).status).toBe(415);
    expect(
      (await call("POST", "/v1/update", { raw: JSON.stringify({ version: "0.3.0", pad: "x".repeat(2000) }) })).status,
    ).toBe(413);
    expect((await call("POST", "/v1/update", { raw: "{nope" })).status).toBe(400);
    for (const version of ["v0.3.0", "dev", "0.3", "0.3.0/../x", 3, null]) {
      expect((await call("POST", "/v1/update", { body: { version } })).status, String(version)).toBe(400);
    }
    expect(fake.created).toHaveLength(0);
  });
});

describe("GET /v1/status", () => {
  it("ready with the project name when discovery succeeds", async () => {
    expect((await call("GET", "/v1/status")).json).toEqual({
      ready: true,
      reason: null,
      project: "mtl-local",
      run: null,
    });
  });

  it("busy while a runner is running, with step and log tail from its markers", async () => {
    fake.runner = runnerInspect();
    fake.runnerLogs = "MTL_UPDATE step=preflight\r\nMTL_UPDATE step=pull\r\npulling...\r\n";
    const r = await call("GET", "/v1/status");
    expect(r.json).toMatchObject({ ready: false, reason: "busy", project: "mtl-local" });
    expect(r.json?.run).toMatchObject({
      state: "running",
      target: "0.3.0",
      from: "0.2.0",
      step: "pull",
      exit_code: null,
    });
    expect(r.json?.run?.log_tail).toContain("pulling...");
  });

  it("failed runner: reason comes from the marker, status stays readable", async () => {
    fake.runner = runnerInspect({
      State: { Status: "exited", ExitCode: 1, StartedAt: "2026-11-11T10:00:00Z", FinishedAt: "2026-11-11T10:01:00Z" },
    });
    fake.runnerLogs = "MTL_UPDATE step=verify\nMTL_UPDATE result=fail reason=version_mismatch\n";
    const r = await call("GET", "/v1/status");
    expect(r.json?.ready).toBe(true);
    expect(r.json?.run).toMatchObject({ state: "failed", step: "verify", reason: "version_mismatch", exit_code: 1 });
  });

  it("succeeded runner reports step done", async () => {
    fake.runner = runnerInspect({
      State: { Status: "exited", ExitCode: 0, StartedAt: "2026-11-11T10:00:00Z", FinishedAt: "2026-11-11T10:09:00Z" },
    });
    fake.runnerLogs = "MTL_UPDATE step=check\nMTL_UPDATE step=done\nMTL_UPDATE result=ok\n";
    expect((await call("GET", "/v1/status")).json?.run).toMatchObject({
      state: "succeeded",
      step: "done",
      reason: null,
      finished_at: "2026-11-11T10:09:00Z",
    });
  });

  it("a runner that died without markers is failed/internal", async () => {
    fake.runner = runnerInspect({
      State: { Status: "exited", ExitCode: 137, StartedAt: "2026-11-11T10:00:00Z", FinishedAt: "2026-11-11T10:01:00Z" },
    });
    expect((await call("GET", "/v1/status")).json?.run).toMatchObject({
      state: "failed",
      reason: "internal",
      step: "preflight",
    });
  });

  it("socket path does not exist -> no_socket", async () => {
    updater.close();
    await startUpdater(join(dir, "missing.sock"));
    base = `http://127.0.0.1:${(updater.address() as AddressInfo).port}`;
    expect((await call("GET", "/v1/status")).json).toMatchObject({ ready: false, reason: "no_socket" });
  });

  it("socket path is a directory -> no_socket", async () => {
    updater.close();
    await startUpdater(dir);
    base = `http://127.0.0.1:${(updater.address() as AddressInfo).port}`;
    expect((await call("GET", "/v1/status")).json).toMatchObject({ ready: false, reason: "no_socket" });
  });

  it("daemon answering 400 'client version' -> docker_too_old", async () => {
    fake.versionError = true;
    expect((await call("GET", "/v1/status")).json).toMatchObject({ ready: false, reason: "docker_too_old" });
  });
});

describe("POST /v1/update", () => {
  const post = (version: string) => call("POST", "/v1/update", { body: { version } });

  it("creates and starts the runner from the updater's own image, with the right mounts, env and labels", async () => {
    const r = await post("0.3.0");
    expect(r.status).toBe(202);
    expect(r.json?.run).toMatchObject({ state: "running", target: "0.3.0", from: "0.2.0", step: "preflight" });

    expect(fake.created).toHaveLength(1);
    const { name, body } = fake.created[0] as Fake["created"][number];
    expect(name).toBe("mtl-local-update");
    expect(body.Image).toBe(SELF_IMAGE);
    expect(body.Cmd).toEqual(["update-run"]);
    expect(body.Tty).toBe(true);
    expect(body.Labels).toMatchObject({
      "io.github.jhin1m.mtl.update-runner": "mtl-local",
      "io.github.jhin1m.mtl.update-target": "0.3.0",
      "io.github.jhin1m.mtl.update-from": "0.2.0",
    });
    expect((body.HostConfig as Record<string, unknown>).Mounts).toEqual([
      { Type: "bind", Source: "/var/run/docker.sock", Target: "/var/run/docker.sock" },
      { Type: "bind", Source: "/Users/me/mtl", Target: "/Users/me/mtl" },
    ]);
    expect((body.HostConfig as Record<string, unknown>).NetworkMode).toBe("bridge");
    expect((body.HostConfig as Record<string, unknown>).RestartPolicy).toEqual({ Name: "no" });
    const env = body.Env as string[];
    for (const e of [
      "MTL_UPDATE_TO=0.3.0",
      "MTL_UPDATE_FROM=0.2.0",
      "MTL_UPDATE_PROJECT=mtl-local",
      "MTL_UPDATE_DIR=/Users/me/mtl",
      "MTL_UPDATE_TAG=latest",
      "MTL_UPDATE_SOCK=/var/run/docker.sock",
      "MTL_PORT=9090",
      "MTL_WORKERS=1",
      "MTL_THREADS=4",
      "MTL_ALLOWED_HOSTS=host.docker.internal",
    ]) {
      expect(env, e).toContain(e);
    }
    expect(fake.started).toEqual(["runner-new"]);
  });

  it("a prerelease equal to the app's update target is pinned by tag", async () => {
    setUpdateTarget("0.3.0-rc.2");
    expect((await post("0.3.0-rc.2")).status).toBe(202);
    expect(fake.created[0]?.body.Env).toContain("MTL_UPDATE_TAG=0.3.0-rc.2");
  });

  it("a prerelease without a configured update target is rejected", async () => {
    const r = await post("0.3.0-rc.2");
    expect(r.status).toBe(422);
    expect(r.json?.reason).toBe("not_newer");
    expect(fake.created).toHaveLength(0);
  });

  it("a configured prerelease target that is not newer than the running version is rejected", async () => {
    // The running app is 0.2.0: an older prerelease would downgrade, an equal one would reinstall.
    for (const v of ["0.1.0-rc.1", "0.2.0-rc.9"]) {
      setUpdateTarget(v);
      const r = await post(v);
      expect(r.status, v).toBe(422);
      expect(r.json?.reason, v).toBe("not_newer");
    }
    expect(fake.created).toHaveLength(0);
  });

  it("a prerelease different from the configured update target is rejected", async () => {
    setUpdateTarget("0.3.0-rc.1");
    for (const v of ["0.3.0-rc.2", "0.4.0-rc.1"]) {
      const r = await post(v);
      expect(r.status, v).toBe(422);
      expect(r.json?.reason, v).toBe("not_newer");
    }
    expect(fake.created).toHaveLength(0);
  });

  it("not newer than the running version -> 422 not_newer", async () => {
    for (const v of ["0.2.0", "0.1.9"]) {
      const r = await post(v);
      expect(r.status).toBe(422);
      expect(r.json?.reason).toBe("not_newer");
    }
    expect(fake.created).toHaveLength(0);
  });

  it("pinned image + official target -> 422 pinned; pinned + the configured prerelease is allowed", async () => {
    const app = appOf();
    app.Config.Image = "ghcr.io/jhin1m/mtl:0.2.0";
    setUpdateTarget("0.3.0-rc.1");
    const r = await post("0.3.0");
    expect(r.status).toBe(422);
    expect(r.json?.reason).toBe("pinned");
    clock += 120_000;
    expect((await post("0.3.0-rc.1")).status).toBe(202);
  });

  it("discovery failures keep their reason (dev build, custom compose)", async () => {
    const app = fake.containers.find((c) => c.Config.Labels?.[LABEL.service] === "app") as InspectContainer;
    app.Config.Env = (app.Config.Env ?? []).map((e) => (e.startsWith("MTL_VERSION=") ? "MTL_VERSION=dev" : e));
    expect(await post("0.3.0")).toMatchObject({ status: 422, json: { reason: "dev_build" } });
    expect(fake.created).toHaveLength(0);
  });

  it("a runner that is still running -> 409 busy", async () => {
    fake.runner = runnerInspect();
    const r = await post("0.3.0");
    expect(r.status).toBe(409);
    expect(r.json?.reason).toBe("busy");
    expect(fake.created).toHaveLength(0);
  });

  it("a runner stuck in created for over a minute does not block a new update", async () => {
    fake.runner = runnerInspect({
      Created: "1970-01-01T00:00:00Z",
      State: { Status: "created", ExitCode: 0, StartedAt: "0001-01-01T00:00:00Z", FinishedAt: "0001-01-01T00:00:00Z" },
    });
    expect((await call("GET", "/v1/status")).json).toMatchObject({ ready: true });
    expect((await post("0.3.0")).status).toBe(202);
    expect(fake.removed).toContain("mtl-local-update");
    expect(fake.created).toHaveLength(1);
  });

  it("a runner that was created a moment ago is still busy", async () => {
    fake.runner = runnerInspect({
      Created: new Date(clock - 5_000).toISOString(),
      State: { Status: "created", ExitCode: 0, StartedAt: "0001-01-01T00:00:00Z", FinishedAt: "0001-01-01T00:00:00Z" },
    });
    expect(await post("0.3.0")).toMatchObject({ status: 409, json: { reason: "busy" } });
  });

  it("two simultaneous requests: one starts a runner, the other gets busy", async () => {
    const [a, b] = await Promise.all([post("0.3.0"), post("0.3.0")]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect(fake.created).toHaveLength(1);
  });

  it("a finished runner is removed before the new one is created", async () => {
    fake.runner = runnerInspect({ State: { Status: "exited", ExitCode: 1, StartedAt: "x", FinishedAt: "y" } });
    expect((await post("0.3.0")).status).toBe(202);
    expect(fake.removed).toContain("mtl-local-update");
    expect(fake.created).toHaveLength(1);
  });

  it("second request within 60 seconds -> 429 cooldown, allowed afterwards", async () => {
    expect((await post("0.3.0")).status).toBe(202);
    const again = await post("0.3.0");
    expect(again.status).toBe(429);
    expect(again.json?.reason).toBe("cooldown");
    clock += 61_000;
    // The first runner has finished by now.
    fake.runner = runnerInspect({ State: { Status: "exited", ExitCode: 1, StartedAt: "x", FinishedAt: "y" } });
    expect((await post("0.3.0")).status).toBe(202);
  });

  it("the daemon refusing to create the runner -> 422 path_mismatch with the daemon message, nothing started", async () => {
    fake.createError = { status: 500, message: "invalid mount config: bind source path does not exist" };
    const r = await post("0.3.0");
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ reason: "path_mismatch" });
    expect(r.json?.detail).toContain("bind source path does not exist");
    expect(fake.started).toHaveLength(0);
  });

  it("losing the name race (409 on create) -> busy", async () => {
    fake.createError = { status: 409, message: "name in use" };
    expect(await post("0.3.0")).toMatchObject({ status: 409, json: { reason: "busy" } });
  });

  it("unusable socket on POST -> 503 no_socket", async () => {
    updater.close();
    await startUpdater(join(dir, "missing.sock"));
    base = `http://127.0.0.1:${(updater.address() as AddressInfo).port}`;
    expect(await post("0.3.0")).toMatchObject({ status: 503, json: { reason: "no_socket" } });
  });
});
