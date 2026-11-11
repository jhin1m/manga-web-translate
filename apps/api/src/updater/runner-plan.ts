/** Pure helpers for the update runner and for the updater that creates it: compose arguments, safety checks on the downloaded compose file, log markers. */
import {
  ALLOWED_IMAGE_REPOS,
  isPrerelease,
  UPDATE_REASONS,
  UPDATE_STEPS,
  type UpdateReason,
  type UpdateStep,
} from "@mtl/shared/update";
import { COMPOSE_VARS } from "./compose-vars.ts";
import { type BindSnapshot, type Fail, parseImageRef } from "./discovery.ts";

export const RUNNER_LABELS = {
  runner: "io.github.jhin1m.mtl.update-runner",
  target: "io.github.jhin1m.mtl.update-target",
  from: "io.github.jhin1m.mtl.update-from",
} as const;

export const MARKER_PREFIX = "MTL_UPDATE";
export const LOG_TAIL_LINES = 40;
export const LOG_LINE_MAX = 300;

const fail = (reason: UpdateReason, detail: string): Fail => ({ ok: false, reason, detail });

/** Official releases follow `latest` (so a later manual `up` cannot downgrade); a prerelease is pinned by its tag. */
export const targetTag = (version: string) => (isPrerelease(version) ? version : "latest");

/** Global compose options. `-p` and `--project-directory` make the runner address the user's project, not its own. */
export function composeBaseArgs(project: string, dir: string): string[] {
  return ["--ansi", "never", "--progress", "plain", "-p", project, "--project-directory", dir];
}

/**
 * Environment of every compose process in the runner: the restored values from the running project, the fixed ones
 * and the tag. `withTag: false` leaves MTL_TAG unset so `.env` pins show through.
 */
export function composeEnv(
  source: Record<string, string | undefined>,
  tag: string,
  opts: { withTag?: boolean } = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "HOME"]) {
    const v = source[k];
    if (v !== undefined) env[k] = v;
  }
  for (const [name, src] of Object.entries(COMPOSE_VARS)) {
    if (src.action === "restore") {
      const v = source[name];
      if (v !== undefined) env[name] = v;
    } else if (src.action === "fixed") {
      env[name] = src.value;
    } else if (src.action === "target" && opts.withTag !== false) {
      env[name] = tag;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------------------------------------------
// Checks on `docker compose config --format json` of the downloaded file

export type ComposeConfig = {
  services: Record<string, { image?: unknown; build?: unknown; volumes?: unknown }>;
};

export function parseComposeConfig(text: string): ComposeConfig | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (typeof v !== "object" || v === null) return null;
    const services = (v as { services?: unknown }).services;
    if (typeof services !== "object" || services === null || Array.isArray(services)) return null;
    return { services: services as ComposeConfig["services"] };
  } catch {
    return null;
  }
}

/** `postgres` -> `docker.io/library/postgres`, `user/img` -> `docker.io/user/img`, registries are kept. */
export function normalizeImageRepo(ref: string): string {
  const { repo } = parseImageRef(ref.trim().toLowerCase());
  const parts = repo.split("/");
  const first = parts[0] as string;
  const hasRegistry = parts.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost");
  if (hasRegistry) return first === "index.docker.io" ? `docker.io/${parts.slice(1).join("/")}` : repo;
  return parts.length === 1 ? `docker.io/library/${repo}` : `docker.io/${repo}`;
}

const ALLOWED_REPOS = new Set<string>(ALLOWED_IMAGE_REPOS.map(normalizeImageRepo));

/** Every service must run an allow-listed image and must not build anything. */
export function checkImages(config: ComposeConfig): Fail | null {
  for (const [name, svc] of Object.entries(config.services)) {
    if (svc.build !== undefined) return fail("image_not_allowed", `service ${name} builds an image`);
    if (typeof svc.image !== "string" || !ALLOWED_REPOS.has(normalizeImageRepo(svc.image))) {
      return fail("image_not_allowed", `service ${name} uses an image that is not allowed: ${String(svc.image)}`);
    }
  }
  return null;
}

/**
 * Binds under the project directory must be the same before and after, string for string, in both directions:
 * every such bind of the new file equals what the running container of that service has for the mount point, and
 * every such bind of the running container is still in the new file. A moved or dropped mount would make the
 * service start on an empty directory. Services without a container (replicas 0) are not compared.
 */
export function checkBinds(config: ComposeConfig, running: BindSnapshot, dir: string): Fail | null {
  const under = (source: string) => source === dir || source.startsWith(`${dir}/`);
  // `up` runs without --remove-orphans: a running service missing from the new file would keep its old image
  // on the migrated database. Such a release has to be applied by hand.
  for (const name of Object.keys(running)) {
    if (!(name in config.services)) {
      return fail("invalid_compose", `running service ${name} is missing from the new file`);
    }
  }
  for (const [name, svc] of Object.entries(config.services)) {
    const have = running[name];
    if (!have) continue;
    const next: Record<string, string[]> = {};
    const volumes = Array.isArray(svc.volumes) ? (svc.volumes as unknown[]) : [];
    for (const v of volumes as { type?: unknown; source?: unknown; target?: unknown }[]) {
      if (v?.type !== "bind" || typeof v.source !== "string" || typeof v.target !== "string") continue;
      next[v.target] = [...(next[v.target] ?? []), v.source];
      if (!under(v.source)) continue;
      if (have[v.target] !== v.source) {
        return fail(
          "path_mismatch",
          `bind of ${name}:${v.target} would change from ${have[v.target] ?? "(none)"} to ${v.source}`,
        );
      }
    }
    for (const [target, source] of Object.entries(have)) {
      if (!next[target]?.includes(source)) {
        return fail("path_mismatch", `bind of ${name}:${target} (${source}) is missing or moved in the new file`);
      }
    }
  }
  return null;
}

/** With MTL_TAG unset the app image must still resolve to `latest`; otherwise `.env` pins a version. */
export function checkNotPinned(config: ComposeConfig): Fail | null {
  const image = config.services.app?.image;
  const ok =
    typeof image === "string" &&
    normalizeImageRepo(image) === "ghcr.io/jhin1m/mtl" &&
    parseImageRef(image).tag === "latest";
  return ok ? null : fail("pinned", `.env pins the app image to ${String(image)}`);
}

/** Mounts after the update, for services present before and after. Differences mean data could be on the wrong folder. */
export function diffSnapshots(before: BindSnapshot, after: BindSnapshot): string | null {
  for (const [svc, binds] of Object.entries(before)) {
    const now = after[svc];
    if (!now) continue;
    for (const k of new Set([...Object.keys(binds), ...Object.keys(now)])) {
      if (binds[k] !== now[k]) return `${svc}:${k} was ${binds[k] ?? "(none)"}, now ${now[k] ?? "(none)"}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Log markers: `MTL_UPDATE step=<step>` and `MTL_UPDATE result=ok|fail [reason=<reason>]`

export const stepLine = (step: UpdateStep) => `${MARKER_PREFIX} step=${step}`;
export const resultLine = (r: { ok: true } | { ok: false; reason: UpdateReason }) =>
  r.ok ? `${MARKER_PREFIX} result=ok` : `${MARKER_PREFIX} result=fail reason=${r.reason}`;

export type RunLog = {
  step: UpdateStep | null;
  result: "ok" | "fail" | null;
  reason: UpdateReason | null;
  tail: string[];
};

// ANSI colour/cursor sequences can still reach a Tty log.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const STEP_RE = new RegExp(`^${MARKER_PREFIX} step=([a-z]+)$`);
const RESULT_RE = new RegExp(`^${MARKER_PREFIX} result=(ok|fail)(?: reason=([a-z_]+))?$`);

/** Last valid marker wins; anything else in the log is output of compose and only feeds the tail. */
export function parseRunLog(text: string): RunLog {
  const lines = text
    .split("\n")
    .map((l) => l.replace(ANSI_RE, "").replace(/\r/g, "").trimEnd())
    .filter((l) => l.length > 0);
  let step: UpdateStep | null = null;
  let result: RunLog["result"] = null;
  let reason: UpdateReason | null = null;
  for (const line of lines) {
    const s = STEP_RE.exec(line);
    if (s) {
      if ((UPDATE_STEPS as readonly string[]).includes(s[1] as string)) step = s[1] as UpdateStep;
      continue;
    }
    const r = RESULT_RE.exec(line);
    if (r) {
      result = r[1] as "ok" | "fail";
      const rs = r[2];
      reason = rs && (UPDATE_REASONS as readonly string[]).includes(rs) ? (rs as UpdateReason) : null;
    }
  }
  const tail = lines.slice(-LOG_TAIL_LINES).map((l) => (l.length > LOG_LINE_MAX ? l.slice(0, LOG_LINE_MAX) : l));
  return { step, result, reason, tail };
}

// ---------------------------------------------------------------------------------------------------------------
// The runner container created by the updater

export type RunnerSpecInput = {
  image: string;
  project: string;
  daemonDir: string;
  socketSource: string;
  /** Version to install. */
  version: string;
  from: string;
  vars: Record<string, string>;
};

/** Mounts (not Binds): sources and mount points are never split on ":" or ",". */
export function buildRunnerBody(i: RunnerSpecInput): Record<string, unknown> {
  const env: Record<string, string> = {
    ...i.vars,
    MTL_UPDATE_TO: i.version,
    MTL_UPDATE_FROM: i.from,
    MTL_UPDATE_PROJECT: i.project,
    MTL_UPDATE_DIR: i.daemonDir,
    MTL_UPDATE_TAG: targetTag(i.version),
    MTL_UPDATE_SOCK: i.socketSource,
  };
  return {
    Image: i.image,
    Cmd: ["update-run"],
    Tty: true,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    Labels: {
      [RUNNER_LABELS.runner]: i.project,
      [RUNNER_LABELS.target]: i.version,
      [RUNNER_LABELS.from]: i.from,
    },
    HostConfig: {
      Mounts: [
        { Type: "bind", Source: i.socketSource, Target: "/var/run/docker.sock" },
        { Type: "bind", Source: i.daemonDir, Target: i.daemonDir },
      ],
      NetworkMode: "bridge",
      RestartPolicy: { Name: "no" },
      Init: true,
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "1" } },
    },
  };
}
