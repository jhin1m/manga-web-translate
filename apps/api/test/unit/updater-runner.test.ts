/** `runUpdate` against a real temporary project directory with fake Docker, fake compose and fake download. */
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockerApi } from "../../src/updater/docker-api.ts";
import { type CmdResult, type RunnerDeps, RunnerFail, runUpdate } from "../../src/updater/runner.ts";
import { stepLine } from "../../src/updater/runner-plan.ts";
import fixture from "./fixtures/docker-inspect-orbstack.json" with { type: "json" };

const OLD_COMPOSE = "# old compose file\nservices: {}\n";
const NEW_COMPOSE = "# new compose file\nservices: {}\n";
const APP_IMAGE_ID = "sha256:a1d1a89d981c03c45c7fa8d90ee9d3afa162ac41047bcdfcc0642ee4bc63a11c";

type Mount = { Type: string; Source: string; Destination: string };
// Fixture JSON, rewritten to point into the temp directory.
type Containers = {
  Id: string;
  Mounts: Mount[];
  Config: { Image: string; Env: string[]; Labels: Record<string, string> };
}[];
type FakeConfig = { services: Record<string, { image: string; volumes: Record<string, string>[] }> };

let dir: string;
let containers: Containers;
let imageVersions: Record<string, string>;
let composeCalls: string[][];
let events: string[];
let configJson: (containers: Containers) => FakeConfig;
let pullCode: number;
let configCode: number;
let upCode: number;
let logs: string[];

const ok = (stdout = ""): CmdResult => ({ code: 0, stdout, timedOut: false, outputTail: "" });

/** The config a well-behaved new compose file resolves to: the running services with the same images and binds. */
const sameConfig = (cs: Containers): FakeConfig => ({
  services: Object.fromEntries(
    cs.map((c) => [
      c.Config.Labels["com.docker.compose.service"],
      {
        image: c.Config.Image,
        volumes: c.Mounts.filter((m) => m.Type === "bind").map((m) => ({
          type: "bind",
          source: m.Source,
          target: m.Destination,
        })),
      },
    ]),
  ),
});

const docker = (): DockerApi => ({
  inspectContainer: async (id) => containers.find((c) => c.Id === id || c.Id.startsWith(id)) ?? null,
  listContainers: async () => containers.map((c) => ({ Id: c.Id, Labels: c.Config.Labels })),
  inspectImage: async (ref) => {
    const v = imageVersions[ref];
    return v === undefined ? null : { Config: { Labels: { "org.opencontainers.image.version": v } } };
  },
  createContainer: async () => ({ Id: "x" }),
  startContainer: async () => undefined,
  removeContainer: async () => undefined,
  logs: async () => "",
});

const fakeCompose: RunnerDeps["compose"] = async (args) => {
  composeCalls.push(args);
  const verb = args.find((a) => ["config", "pull", "up"].includes(a));
  events.push(`compose ${verb}`);
  if (verb === "config") return configCode === 0 ? ok(JSON.stringify(configJson(containers))) : { ...ok(), code: 1 };
  if (verb === "pull") return { ...ok(), code: pullCode };
  // `up` recreates the app on the new version, like the real thing.
  expect(await readFile(join(dir, "docker-compose.yml"), "utf8")).toBe(NEW_COMPOSE);
  const app = containers.find((c) => c.Config.Labels["com.docker.compose.service"] === "app");
  if (!app) throw new Error("fixture has no app");
  app.Config.Env = app.Config.Env.map((e) => (e.startsWith("MTL_VERSION=") ? "MTL_VERSION=0.3.0" : e));
  return { ...ok(), code: upCode };
};

let deps: RunnerDeps;
const env = () => ({
  MTL_UPDATE_TO: "0.3.0",
  MTL_UPDATE_FROM: "0.2.0",
  MTL_UPDATE_PROJECT: "mtl-local",
  MTL_UPDATE_DIR: dir,
  MTL_UPDATE_TAG: "latest",
  PATH: process.env.PATH,
});

const steps = () => logs.filter((l) => l.startsWith("MTL_UPDATE step=")).map((l) => l.replace("MTL_UPDATE step=", ""));
const listing = async () => (await readdir(dir)).sort();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mtl-runner-"));
  await writeFile(join(dir, "docker-compose.yml"), OLD_COMPOSE, { mode: 0o640 });
  await chmod(join(dir, "docker-compose.yml"), 0o640);
  await writeFile(join(dir, "data-marker"), "");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "data/postgres"), { recursive: true });
  await writeFile(join(dir, "data/postgres/PG_VERSION"), "17");
  containers = JSON.parse(JSON.stringify(fixture.containers).replaceAll("/Users/me/mtl", dir)) as Containers;
  imageVersions = {
    "ghcr.io/jhin1m/mtl:latest": "0.3.0",
    "ghcr.io/jhin1m/mtl-worker:latest": "0.3.0",
    [APP_IMAGE_ID]: "0.3.0",
  };
  composeCalls = [];
  events = [];
  configJson = sameConfig;
  pullCode = 0;
  configCode = 0;
  upCode = 0;
  logs = [];
  vi.spyOn(console, "log").mockImplementation((l: string) => void logs.push(String(l)));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  deps = {
    compose: fakeCompose,
    fetchCompose: async () => NEW_COMPOSE,
    chmod: async (p, m) => {
      events.push(`chmod ${p.split("/").pop()} ${m.toString(8)}`);
      await chmod(p, m);
    },
    chown: async (p, uid, gid) => void events.push(`chown ${p.split("/").pop()} ${uid}:${gid}`),
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** The compose file is untouched and nothing else was left in the project directory. */
async function expectUntouched(before: string[]) {
  expect(await readFile(join(dir, "docker-compose.yml"), "utf8")).toBe(OLD_COMPOSE);
  expect(await listing()).toEqual(before);
  expect(events.some((e) => e.startsWith("chmod") || e.startsWith("chown"))).toBe(false);
}

describe("runUpdate", () => {
  it("applies the new file with a backup that keeps the original mode and owner", async () => {
    const original = await stat(join(dir, "docker-compose.yml"));
    await runUpdate(env(), docker(), deps);

    expect(await readFile(join(dir, "docker-compose.yml"), "utf8")).toBe(NEW_COMPOSE);
    expect(await readFile(join(dir, "docker-compose.yml.bak"), "utf8")).toBe(OLD_COMPOSE);
    expect((await stat(join(dir, "docker-compose.yml"))).mode & 0o7777).toBe(0o640);
    expect((await stat(join(dir, "docker-compose.yml.bak"))).mode & 0o7777).toBe(0o640);
    const owner = `${original.uid}:${original.gid}`;
    expect(events).toContain(`chown docker-compose.yml.bak ${owner}`);
    expect(events).toContain(`chown .docker-compose.update.yml ${owner}`);
    expect(await listing()).not.toContain(".docker-compose.update.yml");
    expect(steps()).toEqual(["preflight", "download", "pull", "verify", "apply", "check", "done"]);
    expect(logs).toContain(stepLine("done"));
  });

  it("writes nothing to the project directory before the apply step", async () => {
    const before = await listing();
    // The compose calls before `up` all see an untouched directory.
    const seen: string[][] = [];
    deps.compose = async (args, e, o) => {
      if (!args.includes("up")) seen.push(await listing());
      return fakeCompose(args, e, o);
    };
    await runUpdate(env(), docker(), deps);
    for (const l of seen) expect(l.filter((f) => f.endsWith(".bak"))).toEqual([]);
    expect(before).not.toContain("docker-compose.yml.bak");
  });

  const failures: [string, string, () => void, string[]][] = [
    [
      "download_failed",
      "download",
      () => {
        deps.fetchCompose = async () => {
          throw new RunnerFail("download_failed", "HTTP 404");
        };
      },
      ["preflight", "download"],
    ],
    [
      "invalid_compose",
      "config rejected",
      () => {
        configCode = 1;
      },
      ["preflight", "download"],
    ],
    [
      "image_not_allowed",
      "foreign image",
      () => {
        configJson = (cs) => {
          const c = sameConfig(cs);
          c.services.app = { image: "ghcr.io/evil/mtl:latest", volumes: [] };
          return c;
        };
      },
      ["preflight", "download"],
    ],
    [
      "path_mismatch",
      "moved bind",
      () => {
        configJson = (cs) => {
          const c = sameConfig(cs);
          c.services.postgres = {
            image: "postgres:17",
            volumes: [{ type: "bind", source: "/elsewhere/postgres", target: "/var/lib/postgresql/data" }],
          };
          return c;
        };
      },
      ["preflight", "download"],
    ],
    [
      "pull_failed",
      "pull",
      () => {
        pullCode = 1;
      },
      ["preflight", "download", "pull"],
    ],
    [
      "version_mismatch",
      "verify",
      () => {
        imageVersions["ghcr.io/jhin1m/mtl-worker:latest"] = "0.2.0";
      },
      ["preflight", "download", "pull", "verify"],
    ],
  ];

  for (const [reason, label, arrange, expectedSteps] of failures) {
    it(`${reason} (${label}) leaves the project directory exactly as it was`, async () => {
      const before = await listing();
      arrange();
      await expect(runUpdate(env(), docker(), deps)).rejects.toMatchObject({ reason });
      await expectUntouched(before);
      expect(steps()).toEqual(expectedSteps);
      expect(events).not.toContain("compose up");
    });
  }

  it("a failing chmod or chown only warns; the update still applies", async () => {
    deps.chmod = async () => {
      throw new Error("EPERM chmod");
    };
    deps.chown = async () => {
      throw new Error("EPERM chown");
    };
    await runUpdate(env(), docker(), deps);
    expect(await readFile(join(dir, "docker-compose.yml"), "utf8")).toBe(NEW_COMPOSE);
    expect(await readFile(join(dir, "docker-compose.yml.bak"), "utf8")).toBe(OLD_COMPOSE);
    expect(logs.filter((l) => l.includes("could not restore mode"))).toHaveLength(2);
    expect(logs.filter((l) => l.includes("could not restore owner"))).toHaveLength(2);
  });

  it("a failing up reports up_failed after the file was replaced, and removes the temp file", async () => {
    upCode = 1;
    await expect(runUpdate(env(), docker(), deps)).rejects.toMatchObject({ reason: "up_failed" });
    expect(await readFile(join(dir, "docker-compose.yml.bak"), "utf8")).toBe(OLD_COMPOSE);
    expect(await listing()).not.toContain(".docker-compose.update.yml");
  });
});
