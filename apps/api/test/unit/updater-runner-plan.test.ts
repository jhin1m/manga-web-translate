/** Compose arguments, safety checks on the downloaded compose file and the runner log markers. */
import { describe, expect, it } from "vitest";
import { RunnerFail, readRunnerEnv } from "../../src/updater/runner.ts";
import {
  buildRunnerBody,
  type ComposeConfig,
  checkBinds,
  checkImages,
  checkNotPinned,
  composeBaseArgs,
  composeEnv,
  diffSnapshots,
  LOG_LINE_MAX,
  LOG_TAIL_LINES,
  normalizeImageRepo,
  parseComposeConfig,
  parseRunLog,
  resultLine,
  stepLine,
  targetTag,
} from "../../src/updater/runner-plan.ts";

const DIR = "/Users/me/mtl";

describe("compose arguments and environment", () => {
  it("always addresses the user's project explicitly", () => {
    const args = composeBaseArgs("mtl-local", DIR);
    expect(args).toEqual(["--ansi", "never", "--progress", "plain", "-p", "mtl-local", "--project-directory", DIR]);
  });

  it("official versions follow latest, prereleases are pinned by tag", () => {
    expect(targetTag("0.3.0")).toBe("latest");
    expect(targetTag("0.3.0-rc.2")).toBe("0.3.0-rc.2");
    expect(composeEnv({}, targetTag("0.3.0")).MTL_TAG).toBe("latest");
    expect(composeEnv({}, targetTag("0.3.0-rc.2")).MTL_TAG).toBe("0.3.0-rc.2");
  });

  it("forces an empty MTL_SKIP_BOOT_BACKUP and MTL_UPDATER=1, whatever the runner's own env says", () => {
    const env = composeEnv(
      { MTL_SKIP_BOOT_BACKUP: "1", MTL_UPDATER: "0", MTL_PORT: "9090", MTL_THREADS: undefined },
      "latest",
    );
    expect(env.MTL_SKIP_BOOT_BACKUP).toBe("");
    expect(env.MTL_UPDATER).toBe("1");
    expect(env.MTL_PORT).toBe("9090");
    expect("MTL_THREADS" in env).toBe(false);
  });

  it("withTag:false leaves MTL_TAG unset and passes no unrelated variables", () => {
    const env = composeEnv({ PATH: "/bin", SECRET: "x", MTL_UPDATE_TO: "9.9.9" }, "latest", { withTag: false });
    expect("MTL_TAG" in env).toBe(false);
    expect(env.PATH).toBe("/bin");
    expect("SECRET" in env).toBe(false);
    expect("MTL_UPDATE_TO" in env).toBe(false);
  });
});

describe("bind comparison", () => {
  const config = (volumes: Record<string, { type: string; source: string; target: string }[]>): ComposeConfig => ({
    services: Object.fromEntries(Object.entries(volumes).map(([k, v]) => [k, { image: "x", volumes: v }])),
  });
  const running = { app: { "/data/files": `${DIR}/data/files` } };

  it("equal binds pass", () => {
    const c = config({ app: [{ type: "bind", source: `${DIR}/data/files`, target: "/data/files" }] });
    expect(checkBinds(c, running, DIR)).toBeNull();
  });

  it("a running service missing from the new file -> invalid_compose", () => {
    const c = config({ worker: [] });
    expect(checkBinds(c, running, DIR)?.reason).toBe("invalid_compose");
  });

  it("a mount point whose source differs -> path_mismatch", () => {
    const c = config({
      app: [{ type: "bind", source: "/run/desktop/mnt/host/c/Users/me/mtl/data/files", target: "/data/files" }],
    });
    // A mount that moved out of the project directory is as bad as one that moved inside it.
    expect(checkBinds(c, running, DIR)?.reason).toBe("path_mismatch");
    const d = config({ app: [{ type: "bind", source: `${DIR}/data/other`, target: "/data/files" }] });
    expect(checkBinds(d, running, DIR)?.reason).toBe("path_mismatch");
  });

  it("a new bind on an existing service has no running counterpart -> path_mismatch", () => {
    const c = config({
      app: [
        { type: "bind", source: `${DIR}/data/files`, target: "/data/files" },
        { type: "bind", source: `${DIR}/data/extra`, target: "/data/extra" },
      ],
    });
    expect(checkBinds(c, running, DIR)?.reason).toBe("path_mismatch");
  });

  it("a running bind that is missing from the new file -> path_mismatch", () => {
    const c = config({ app: [{ type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" }] });
    expect(checkBinds(c, running, DIR)).toMatchObject({ reason: "path_mismatch" });
    expect(checkBinds(config({ app: [] }), running, DIR)?.reason).toBe("path_mismatch");
  });

  it("a service without a container is not compared; sockets and volumes are ignored", () => {
    const c = config({
      brandnew: [{ type: "bind", source: `${DIR}/data/new`, target: "/data/new" }],
      app: [
        { type: "bind", source: `${DIR}/data/files`, target: "/data/files" },
        { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
        { type: "volume", source: "named", target: "/x" },
      ],
    });
    expect(checkBinds(c, running, DIR)).toBeNull();
  });

  it("diffSnapshots compares services present on both sides", () => {
    const before = { app: { "/a": `${DIR}/a` }, gone: { "/g": `${DIR}/g` } };
    expect(diffSnapshots(before, { app: { "/a": `${DIR}/a` } })).toBeNull();
    expect(diffSnapshots(before, { app: { "/a": "/elsewhere/a" } })).toContain("app:/a");
    expect(diffSnapshots(before, { app: {} })).toContain("app:/a");
  });
});

describe("image allow-list", () => {
  const svc = (image: unknown, extra: object = {}): ComposeConfig => ({ services: { s: { image, ...extra } } });

  it("accepts the project's images, with or without the implicit docker.io/library prefix", () => {
    for (const image of [
      "ghcr.io/jhin1m/mtl:latest",
      "ghcr.io/jhin1m/mtl-worker:0.3.0-rc.1",
      "postgres:17",
      "docker.io/library/postgres:17",
      "index.docker.io/library/postgres:17",
    ]) {
      expect(checkImages(svc(image)), image).toBeNull();
    }
  });

  it("rejects other repositories, look-alikes, build contexts and missing images", () => {
    for (const image of [
      "ghcr.io/evil/mtl:latest",
      "ghcr.io/jhin1m/mtl-evil:latest",
      "evil.io/jhin1m/mtl:latest",
      "jhin1m/mtl:latest",
      "postgres-evil:17",
      "docker.io/someone/postgres:17",
      undefined,
    ]) {
      expect(checkImages(svc(image))?.reason, String(image)).toBe("image_not_allowed");
    }
    expect(checkImages(svc("ghcr.io/jhin1m/mtl:latest", { build: { context: "." } }))?.reason).toBe(
      "image_not_allowed",
    );
  });

  it("normalizes repositories", () => {
    expect(normalizeImageRepo("postgres:17")).toBe("docker.io/library/postgres");
    expect(normalizeImageRepo("Ghcr.io/jhin1m/mtl@sha256:abc")).toBe("ghcr.io/jhin1m/mtl");
    expect(normalizeImageRepo("user/img:1")).toBe("docker.io/user/img");
  });

  it(".env pin detection reads the app image resolved without MTL_TAG", () => {
    const app = (image: string): ComposeConfig => ({ services: { app: { image } } });
    expect(checkNotPinned(app("ghcr.io/jhin1m/mtl:latest"))).toBeNull();
    expect(checkNotPinned(app("ghcr.io/jhin1m/mtl:0.2.0"))?.reason).toBe("pinned");
  });

  it("parseComposeConfig rejects non-compose JSON", () => {
    expect(parseComposeConfig("nope")).toBeNull();
    expect(parseComposeConfig("[]")).toBeNull();
    expect(parseComposeConfig('{"services":[]}')).toBeNull();
    expect(parseComposeConfig('{"services":{"a":{}}}')).not.toBeNull();
  });
});

describe("runner log markers", () => {
  it("reads the last step and the failure reason", () => {
    const text = [
      stepLine("preflight"),
      "some compose output",
      stepLine("pull"),
      resultLine({ ok: false, reason: "pull_failed" }),
    ].join("\n");
    expect(parseRunLog(text)).toMatchObject({ step: "pull", result: "fail", reason: "pull_failed" });
  });

  it("success carries no reason", () => {
    expect(parseRunLog(`${stepLine("done")}\n${resultLine({ ok: true })}\n`)).toMatchObject({
      step: "done",
      result: "ok",
      reason: null,
    });
  });

  it("ignores junk: unknown steps and reasons, indented lines, CRLF and ANSI colours", () => {
    const esc = String.fromCharCode(27);
    const text = [
      "MTL_UPDATE step=bogus",
      " MTL_UPDATE step=apply",
      `${esc}[32mMTL_UPDATE step=verify${esc}[0m\r`,
      "MTL_UPDATE result=fail reason=made_up",
      "MTL_UPDATE result=maybe",
    ].join("\n");
    const log = parseRunLog(text);
    expect(log.step).toBe("verify");
    expect(log.result).toBe("fail");
    expect(log.reason).toBeNull();
  });

  it("empty log has no markers", () => {
    expect(parseRunLog("")).toEqual({ step: null, result: null, reason: null, tail: [] });
  });

  it("keeps the last 40 lines, each cut to 300 characters", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(500)}`);
    const { tail } = parseRunLog(lines.join("\n"));
    expect(tail).toHaveLength(LOG_TAIL_LINES);
    expect(tail[0]?.startsWith("line 60 ")).toBe(true);
    expect(tail.every((l) => l.length <= LOG_LINE_MAX)).toBe(true);
  });
});

describe("runner environment", () => {
  const good = {
    MTL_UPDATE_TO: "0.3.0",
    MTL_UPDATE_FROM: "0.2.0",
    MTL_UPDATE_PROJECT: "mtl-local",
    MTL_UPDATE_DIR: DIR,
    MTL_UPDATE_TAG: "latest",
    MTL_UPDATE_SOCK: "/var/run/docker.sock",
  };

  it("accepts what the updater builds", () => {
    const body = buildRunnerBody({
      image: "sha256:abc",
      project: "mtl-local",
      daemonDir: DIR,
      socketSource: "/var/run/docker.sock",
      version: "0.3.0",
      from: "0.2.0",
      vars: { MTL_PORT: "9090" },
    });
    const env = Object.fromEntries(
      ((body.Env as string[]) ?? []).map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]),
    );
    expect(readRunnerEnv(env)).toMatchObject({ version: "0.3.0", project: "mtl-local", dir: DIR, tag: "latest" });
  });

  it.each([
    ["version with leading v", { MTL_UPDATE_TO: "v0.3.0" }],
    ["version with a path", { MTL_UPDATE_TO: "0.3.0/../x" }],
    ["version with a space", { MTL_UPDATE_TO: "0.3.0 --rm" }],
    ["project with uppercase", { MTL_UPDATE_PROJECT: "Mtl" }],
    ["relative directory", { MTL_UPDATE_DIR: "mtl" }],
    ["directory with ..", { MTL_UPDATE_DIR: "/a/../b" }],
    ["Windows directory", { MTL_UPDATE_DIR: "C:\\mtl" }],
    ["tag that is not latest for a release", { MTL_UPDATE_TAG: "0.3.0" }],
    ["tag that is not the prerelease", { MTL_UPDATE_TO: "0.3.0-rc.1", MTL_UPDATE_TAG: "latest" }],
    ["target equal to the running version", { MTL_UPDATE_FROM: "0.3.0" }],
    ["target older than the running version", { MTL_UPDATE_TO: "0.1.0" }],
  ])("rejects %s", (_name, patch) => {
    expect(() => readRunnerEnv({ ...good, ...patch })).toThrow(RunnerFail);
  });
});
