/**
 * `update-run` command: the detached container that performs one update. It is not part of the compose project, so
 * recreating the `updater` service during `up` cannot kill it. Nothing on disk changes until the new images are pulled
 * and their version labels verified; the compose file is replaced right before `up`. There is no automatic rollback:
 * the migration may already have run, and an older app refuses to start on a newer schema.
 *
 * Progress is one `MTL_UPDATE step=<step>` line per step and a final `MTL_UPDATE result=ok|fail reason=<reason>`.
 */
import { spawn } from "node:child_process";
import { chmod, chown, copyFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { composeUrl, isNewer, parseVersion, type UpdateReason, type UpdateStep } from "@mtl/shared/update";
import {
  APP_REPO,
  analyzeProject,
  bindSnapshot,
  COMPOSE_FILE,
  envOf,
  type Fail,
  type InspectContainer,
  isProjectName,
  isSafeDaemonDir,
  LABEL,
} from "./discovery.ts";
import { createDockerApi, type DockerApi, DockerError } from "./docker-api.ts";
import {
  checkBinds,
  checkImages,
  checkNotPinned,
  composeBaseArgs,
  composeEnv,
  diffSnapshots,
  parseComposeConfig,
  resultLine,
  stepLine,
  targetTag,
} from "./runner-plan.ts";

const WORKER_REPO = `${APP_REPO}-worker`;
const TMP_COMPOSE = ".docker-compose.update.yml";
const MAX_COMPOSE_BYTES = 64 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const PULL_TIMEOUT_MS = 60 * 60_000;
const UP_WAIT_SECONDS = 1200;
const UP_KILL_MS = (UP_WAIT_SECONDS + 300) * 1000;
const VERSION_LABEL = "org.opencontainers.image.version";

export class RunnerFail extends Error {
  readonly reason: UpdateReason;
  constructor(reason: UpdateReason, message: string) {
    super(message);
    this.name = "RunnerFail";
    this.reason = reason;
  }
}

const failFrom = (f: Fail) => new RunnerFail(f.reason, f.detail);

export type RunnerEnv = { version: string; from: string; project: string; dir: string; tag: string; socket: string };

/** Everything that enters the runner from outside is checked again here; the updater is not trusted blindly. */
export function readRunnerEnv(env: Record<string, string | undefined>): RunnerEnv {
  const version = env.MTL_UPDATE_TO ?? "";
  const from = env.MTL_UPDATE_FROM ?? "";
  const project = env.MTL_UPDATE_PROJECT ?? "";
  const dir = env.MTL_UPDATE_DIR ?? "";
  const tag = env.MTL_UPDATE_TAG ?? "";
  // A leading "v" would still parse but never reaches the URL or the tag from here.
  if (version.startsWith("v") || !parseVersion(version)) throw new RunnerFail("internal", "invalid MTL_UPDATE_TO");
  if (!parseVersion(from)) throw new RunnerFail("internal", "invalid MTL_UPDATE_FROM");
  if (!isNewer(version, from)) throw new RunnerFail("not_newer", "MTL_UPDATE_TO is not newer than MTL_UPDATE_FROM");
  if (!isProjectName(project)) throw new RunnerFail("internal", "invalid MTL_UPDATE_PROJECT");
  if (!isSafeDaemonDir(dir)) throw new RunnerFail("path_mismatch", "invalid MTL_UPDATE_DIR");
  if (tag !== targetTag(version)) throw new RunnerFail("internal", "MTL_UPDATE_TAG does not match the version");
  return { version, from, project, dir, tag, socket: env.MTL_UPDATE_SOCK ?? "" };
}

const say = (line: string) => console.log(line);
const step = (s: UpdateStep) => say(stepLine(s));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type CmdResult = { code: number | null; stdout: string; timedOut: boolean; outputTail: string };

/** Runs docker-compose. stderr (and stdout unless captured) is forwarded to the runner log. */
function runCompose(
  args: string[],
  env: Record<string, string>,
  opts: { timeoutMs: number; captureStdout?: boolean },
): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn("docker-compose", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let outputTail = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    const forward = (b: Buffer) => {
      const text = b.toString("utf8");
      outputTail = (outputTail + text).slice(-4000);
      process.stdout.write(text);
    };
    child.stdout.on("data", (b: Buffer) => {
      if (opts.captureStdout) stdout += b.toString("utf8");
      else forward(b);
    });
    child.stderr.on("data", forward);
    child.on("error", (e) => {
      clearTimeout(timer);
      say(`docker-compose could not start: ${e.message}`);
      resolve({ code: null, stdout, timedOut, outputTail });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, timedOut, outputTail });
    });
  });
}

export type RunnerDeps = {
  compose: (
    args: string[],
    env: Record<string, string>,
    opts: { timeoutMs: number; captureStdout?: boolean },
  ) => Promise<CmdResult>;
  fetchCompose: (version: string) => Promise<string>;
  chmod: (path: string, mode: number) => Promise<void>;
  chown: (path: string, uid: number, gid: number) => Promise<void>;
};

const defaultDeps: RunnerDeps = { compose: runCompose, fetchCompose, chmod, chown };

async function fetchCompose(version: string): Promise<string> {
  const url = composeUrl(`v${version}`);
  let last = "unknown error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of res.body as AsyncIterable<Uint8Array>) {
        size += c.length;
        if (size > MAX_COMPOSE_BYTES) throw new Error("compose file larger than 64 KB");
        chunks.push(Buffer.from(c));
      }
      if (size === 0) throw new Error("empty compose file");
      return Buffer.concat(chunks).toString("utf8");
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      say(`download attempt ${attempt} failed: ${last}`);
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }
  throw new RunnerFail("download_failed", last);
}

async function loadProject(docker: DockerApi, project: string): Promise<InspectContainer[]> {
  const list = await docker.listContainers({ all: true, labels: [`${LABEL.project}=${project}`] });
  const found = await Promise.all(list.map((s) => docker.inspectContainer(s.Id)));
  return found.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => c as unknown as InspectContainer);
}

async function imageVersion(docker: DockerApi, ref: string): Promise<string | null> {
  const img = await docker.inspectImage(ref);
  const labels = (img?.Config as { Labels?: Record<string, string> | null } | undefined)?.Labels;
  return labels?.[VERSION_LABEL] ?? null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function runUpdate(
  env: Record<string, string | undefined>,
  docker: DockerApi,
  overrides: Partial<RunnerDeps> = {},
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const runCompose = deps.compose;
  const cfg = readRunnerEnv(env);
  const composePath = `${cfg.dir}/${COMPOSE_FILE}`;
  const tmpPath = `${cfg.dir}/${TMP_COMPOSE}`;
  const base = composeBaseArgs(cfg.project, cfg.dir);
  const withTag = composeEnv(env, cfg.tag);
  const withoutTag = composeEnv(env, cfg.tag, { withTag: false });

  try {
    // 1. preflight: the mounted directory must be the user's real project.
    step("preflight");
    say(`updating ${cfg.project}: ${cfg.from} -> ${cfg.version} (tag ${cfg.tag}) in ${cfg.dir}`);
    if (!(await exists(composePath)) || !(await exists(`${cfg.dir}/data/postgres/PG_VERSION`))) {
      throw new RunnerFail("path_mismatch", `cannot see ${COMPOSE_FILE} and data/postgres/PG_VERSION in ${cfg.dir}`);
    }
    const before = await loadProject(docker, cfg.project);
    const analyzed = analyzeProject(cfg.project, before);
    if (!analyzed.ok) throw failFrom(analyzed);
    if (analyzed.info.daemonDir !== cfg.dir) {
      throw new RunnerFail("path_mismatch", "project directory differs from the one the updater found");
    }
    const beforeBinds = bindSnapshot(before, cfg.dir);
    const original = await stat(composePath);

    // 2. download the compose file of the target tag and check it before anything is pulled or written.
    step("download");
    await writeFile(tmpPath, await deps.fetchCompose(cfg.version), { mode: 0o600 });
    const fileArgs = [...base, "-f", tmpPath];
    const cfgRun = await runCompose([...fileArgs, "config", "--format", "json"], withTag, {
      timeoutMs: 60_000,
      captureStdout: true,
    });
    const config = cfgRun.code === 0 ? parseComposeConfig(cfgRun.stdout) : null;
    if (!config) throw new RunnerFail("invalid_compose", "docker-compose config rejected the downloaded file");
    const bad = checkImages(config) ?? checkBinds(config, beforeBinds, cfg.dir);
    if (bad) throw failFrom(bad);
    if (cfg.tag === "latest") {
      // Same file without MTL_TAG: a pin in .env would make a later manual `up` run the old version.
      const pinRun = await runCompose([...fileArgs, "config", "--format", "json"], withoutTag, {
        timeoutMs: 60_000,
        captureStdout: true,
      });
      const pinConfig = pinRun.code === 0 ? parseComposeConfig(pinRun.stdout) : null;
      if (!pinConfig) throw new RunnerFail("invalid_compose", "docker-compose config failed without MTL_TAG");
      const pinned = checkNotPinned(pinConfig);
      if (pinned) throw failFrom(pinned);
    }

    // 3. pull; the old version keeps running meanwhile.
    step("pull");
    let pull = await runCompose([...fileArgs, "pull", "--quiet"], withTag, { timeoutMs: PULL_TIMEOUT_MS });
    if (pull.code !== 0) {
      say("pull failed, retrying once");
      pull = await runCompose([...fileArgs, "pull", "--quiet"], withTag, { timeoutMs: PULL_TIMEOUT_MS });
    }
    if (pull.code !== 0) throw new RunnerFail("pull_failed", "docker-compose pull failed");

    // 4. verify: both images must carry exactly the target version.
    step("verify");
    for (const repo of [APP_REPO, WORKER_REPO]) {
      const got = await imageVersion(docker, `${repo}:${cfg.tag}`);
      if (got !== cfg.version) {
        throw new RunnerFail(
          "version_mismatch",
          `${repo}:${cfg.tag} is ${got ?? "unlabelled"}, expected ${cfg.version}`,
        );
      }
    }

    // 5. apply: first write to the user's directory happens here, then compose does the ordered stop/recreate/start.
    step("apply");
    const mode = original.mode & 0o7777;
    // The backup and the new file look like the original to its owner, so a restore needs no sudo. Filesystems that
    // refuse chmod/chown (some Docker Desktop mounts) must not block the update.
    const keepAttrs = async (path: string) => {
      await deps.chmod(path, mode).catch((e: Error) => say(`could not restore mode of ${path}: ${e.message}`));
      await deps
        .chown(path, original.uid, original.gid)
        .catch((e: Error) => say(`could not restore owner of ${path}: ${e.message}`));
    };
    await copyFile(composePath, `${composePath}.bak`);
    await keepAttrs(`${composePath}.bak`);
    await keepAttrs(tmpPath);
    await rename(tmpPath, composePath);
    const up = await runCompose(
      [...base, "-f", composePath, "up", "-d", "--wait", "--wait-timeout", String(UP_WAIT_SECONDS)],
      withTag,
      { timeoutMs: UP_KILL_MS },
    );
    if (up.code !== 0) {
      const timeout = up.timedOut || /time(d)?[ -]?out/i.test(up.outputTail);
      throw new RunnerFail(timeout ? "timeout" : "up_failed", "docker-compose up did not finish cleanly");
    }

    // 6. check: same folders mounted as before, and the app is the version we asked for.
    step("check");
    const after = await loadProject(docker, cfg.project);
    const diff = diffSnapshots(beforeBinds, bindSnapshot(after, cfg.dir));
    if (diff) {
      throw new RunnerFail(
        "path_mismatch",
        `SAU khi cập nhật, thư mục dữ liệu được mount khác trước (${diff}). Dừng lại, KHÔNG xoá gì, và cập nhật tay theo docs/self-host.md.`,
      );
    }
    const app = after.find((c) => c.Config.Labels?.[LABEL.service] === "app");
    const running = app ? envOf(app).get("MTL_VERSION") : undefined;
    const label = app?.Image ? await imageVersion(docker, app.Image) : null;
    if (!app || running !== cfg.version || label !== cfg.version) {
      throw new RunnerFail(
        "version_mismatch",
        `app runs ${running ?? "?"} (image label ${label ?? "?"}) after the update`,
      );
    }

    step("done");
  } finally {
    await rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    await runUpdate(process.env, createDockerApi({ timeoutMs: 30_000 }));
    say(resultLine({ ok: true }));
    process.exit(0);
  } catch (e) {
    let reason: UpdateReason = "internal";
    if (e instanceof RunnerFail) reason = e.reason;
    else if (e instanceof DockerError) reason = e.reason;
    say(`error: ${e instanceof Error ? e.message : String(e)}`);
    say(resultLine({ ok: false, reason }));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
