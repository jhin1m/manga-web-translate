/**
 * Pure analysis of `docker inspect` output: which compose project this updater belongs to, where that project
 * lives on the DAEMON's filesystem, which version runs and which compose variables to restore. No I/O here.
 */
import { parseVersion, type UpdateReason } from "@mtl/shared/update";
import { COMPOSE_VARS } from "./compose-vars.ts";

export const LABEL = {
  project: "com.docker.compose.project",
  service: "com.docker.compose.service",
  workingDir: "com.docker.compose.project.working_dir",
  configFiles: "com.docker.compose.project.config_files",
} as const;

export const APP_REPO = "ghcr.io/jhin1m/mtl";
export const COMPOSE_FILE = "docker-compose.yml";

export type InspectContainer = {
  Id: string;
  Image?: string;
  Config: { Labels?: Record<string, string> | null; Env?: string[] | null; Image?: string };
  HostConfig?: { PortBindings?: Record<string, { HostPort?: string }[] | null> | null };
  Mounts?: { Type?: string; Source?: string; Destination?: string }[] | null;
  State?: { Status?: string; ExitCode?: number; StartedAt?: string; FinishedAt?: string };
  Created?: string;
};

/** service -> container destination -> daemon-side source, for bind mounts under the project directory. */
export type BindSnapshot = Record<string, Record<string, string>>;

export type ProjectInfo = {
  project: string;
  /** Project directory as the daemon sees it; the runner mounts it at this same path. */
  daemonDir: string;
  /** Version baked into the running app image. */
  current: string;
  /** Tag the app image is pinned to; null when it follows `latest`. */
  pinnedTag: string | null;
  /** Compose variables restored from the running containers (name as used in docker-compose.yml). */
  vars: Record<string, string>;
  binds: BindSnapshot;
};

export type UpdaterInfo = ProjectInfo & {
  /** Socket path as the user configured it; the runner mounts this same string. */
  socketSource: string;
  /** Image id of the running updater; the runner is created from it without pulling. */
  selfImage: string;
};

export type Fail = { ok: false; reason: UpdateReason; detail: string };
export type Result<T> = { ok: true; info: T } | Fail;

const fail = (reason: UpdateReason, detail: string): Fail => ({ ok: false, reason, detail });

const PROJECT_RE = /^[a-z0-9][a-z0-9_-]*$/;
// Docker Desktop's ephemeral bind-mount proxy: vanishes on restart, never persist or reuse it.
const DESKTOP_TMP_PREFIX = "/run/desktop/mnt/host/wsl/";

export const isProjectName = (s: unknown): s is string => typeof s === "string" && PROJECT_RE.test(s);

const labels = (c: InspectContainer) => c.Config.Labels ?? {};
const serviceOf = (c: InspectContainer) => labels(c)[LABEL.service];

export function envOf(c: InspectContainer): Map<string, string> {
  const m = new Map<string, string>();
  for (const kv of c.Config.Env ?? []) {
    const i = kv.indexOf("=");
    if (i > 0) m.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return m;
}

/** Absolute POSIX path, no "..", no control characters, no trailing slash, not the Docker Desktop temp proxy. */
export function isSafeDaemonDir(dir: string): boolean {
  if (typeof dir !== "string" || dir.length < 2 || !dir.startsWith("/") || dir.endsWith("/")) return false;
  for (let i = 0; i < dir.length; i++) {
    const code = dir.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  if (dir.split("/").includes("..")) return false;
  return !`${dir}/`.startsWith(DESKTOP_TMP_PREFIX);
}

/** `C:\a\b` -> `/c/a/b`; other paths only get `\` -> `/` and lose a trailing slash. */
export function normalizeLabelPath(p: string): { path: string; windows: boolean } {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  const strip = (s: string) => s.replace(/\/+$/, "");
  if (m)
    return { path: strip(`/${(m[1] as string).toLowerCase()}/${(m[2] as string).replace(/\\/g, "/")}`), windows: true };
  return { path: strip(p.replace(/\\/g, "/")), windows: false };
}

/** `ghcr.io/jhin1m/mtl:1.2.3` -> repo + tag ("latest" when absent). Digest references have no usable tag. */
export function parseImageRef(ref: string): { repo: string; tag: string } {
  const noDigest = ref.split("@")[0] as string;
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.indexOf(":", slash + 1);
  if (colon === -1) return { repo: noDigest, tag: "latest" };
  return { repo: noDigest.slice(0, colon), tag: noDigest.slice(colon + 1) };
}

export function projectOf(self: InspectContainer): string | null {
  const p = labels(self)[LABEL.project];
  return isProjectName(p) ? p : null;
}

/** Binds of every container whose source lies under `dir`, keyed by compose service. */
export function bindSnapshot(containers: InspectContainer[], dir: string): BindSnapshot {
  const out: BindSnapshot = {};
  for (const c of containers) {
    const svc = serviceOf(c);
    if (!svc) continue;
    for (const m of c.Mounts ?? []) {
      if (m.Type !== "bind" || !m.Source || !m.Destination) continue;
      if (m.Source !== dir && !m.Source.startsWith(`${dir}/`)) continue;
      const bucket = out[svc] ?? {};
      bucket[m.Destination] = m.Source;
      out[svc] = bucket;
    }
  }
  return out;
}

function mountSource(c: InspectContainer, destination: string): string | null {
  const m = (c.Mounts ?? []).find((x) => x.Destination === destination);
  return m?.Type === "bind" && typeof m.Source === "string" ? m.Source : null;
}

function checkSingleComposeFile(app: InspectContainer): Fail | null {
  const l = labels(app);
  const files = (l[LABEL.configFiles] ?? "").split(",");
  const wd = l[LABEL.workingDir];
  if (files.length !== 1 || !wd) return fail("custom_compose", "project uses more than one compose file");
  const file = normalizeLabelPath(files[0] as string);
  const dir = normalizeLabelPath(wd);
  const same = (a: string, b: string) => (file.windows || dir.windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!same(file.path, `${dir.path}/${COMPOSE_FILE}`)) {
    return fail("custom_compose", `compose file is not ${COMPOSE_FILE} in the project directory`);
  }
  return null;
}

/** The project directory on the daemon side, cross-checked against postgres' mount and the compose labels. */
function findDaemonDir(app: InspectContainer, postgres: InspectContainer): Result<string> {
  const src = mountSource(app, "/data/files");
  if (!src) return fail("path_mismatch", "app has no bind mount at /data/files");
  if (!src.endsWith("/data/files")) return fail("path_mismatch", `unexpected source for /data/files: ${src}`);
  const dir = src.slice(0, -"/data/files".length);
  // `C:\...` and Docker Desktop's temp proxy land here: not proven to be mountable again, so refuse.
  if (!isSafeDaemonDir(dir)) return fail("path_mismatch", `project directory form not supported: ${src}`);
  const pg = mountSource(postgres, "/var/lib/postgresql/data");
  if (pg !== `${dir}/data/postgres`) {
    return fail("path_mismatch", "postgres data mount does not sit next to the app data mount");
  }
  const wd = labels(app)[LABEL.workingDir];
  if (!wd) return fail("path_mismatch", "app has no working_dir label");
  const label = normalizeLabelPath(wd);
  const a = label.windows ? dir.toLowerCase() : dir;
  const b = label.windows ? label.path.toLowerCase() : label.path;
  if (!b.startsWith("/") || !a.endsWith(b)) {
    return fail("path_mismatch", "working_dir label does not match the mount path");
  }
  return { ok: true, info: dir };
}

function restoreVars(
  app: InspectContainer,
  workers: InspectContainer[],
  updater: InspectContainer | null,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const appEnv = envOf(app);
  const workerEnv = workers[0] ? envOf(workers[0]) : new Map<string, string>();
  const updaterEnv = updater ? envOf(updater) : new Map<string, string>();
  for (const [name, src] of Object.entries(COMPOSE_VARS)) {
    if (src.action !== "restore") continue;
    let value: string | undefined;
    if (src.from === "app-port") value = app.HostConfig?.PortBindings?.["8080/tcp"]?.[0]?.HostPort;
    else if (src.from === "app-env") value = appEnv.get(name);
    else if (src.from === "worker-count") value = String(workers.length);
    else if (src.from === "worker-env") value = workerEnv.get(name);
    else value = updaterEnv.get(name);
    if (value !== undefined) vars[name] = value;
  }
  return vars;
}

/** Everything that can be derived from the project's containers (updater or runner side alike). */
export function analyzeProject(project: string, all: InspectContainer[]): Result<ProjectInfo> {
  const containers = all.filter((c) => labels(c)[LABEL.project] === project);
  const byService = (s: string) => containers.filter((c) => serviceOf(c) === s);
  const apps = byService("app");
  const pgs = byService("postgres");
  const app = apps[0];
  const postgres = pgs[0];
  if (apps.length !== 1 || pgs.length !== 1 || !app || !postgres) {
    return fail("project_not_found", "expected exactly one app and one postgres container");
  }
  const custom = checkSingleComposeFile(app);
  if (custom) return custom;
  const dir = findDaemonDir(app, postgres);
  if (!dir.ok) return dir;

  const current = envOf(app).get("MTL_VERSION") ?? "";
  if (!parseVersion(current)) return fail("dev_build", `app version is not a release: ${current || "(unset)"}`);

  const image = parseImageRef(app.Config.Image ?? "");
  if (image.repo !== APP_REPO) return fail("image_not_allowed", `app image repository: ${image.repo}`);

  const updater = byService("updater")[0] ?? null;
  return {
    ok: true,
    info: {
      project,
      daemonDir: dir.info,
      current,
      pinnedTag: image.tag === "latest" ? null : image.tag,
      vars: restoreVars(app, byService("worker"), updater),
      binds: bindSnapshot(containers, dir.info),
    },
  };
}

/** Updater side: `self` is this container's own inspect, `containers` every container of its project. */
export function discover(input: { self: InspectContainer; containers: InspectContainer[] }): Result<UpdaterInfo> {
  const project = projectOf(input.self);
  if (!project) return fail("project_not_found", "this container has no compose project label");
  const r = analyzeProject(project, input.containers);
  if (!r.ok) return r;
  // The user's configured string, not Mounts[].Source: Docker Desktop special-cases the literal default path.
  const socketSource = envOf(input.self).get("MTL_DOCKER_SOCK") || "/var/run/docker.sock";
  return { ok: true, info: { ...r.info, socketSource, selfImage: input.self.Image ?? "" } };
}
