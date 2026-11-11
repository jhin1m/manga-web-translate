/** Self-host update contract: semver helpers, reason codes and status shapes shared by API, updater and web. No imports. */

export type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a normal release. */
  pre: string[];
};

// Semver 2.0 without build metadata; numeric identifiers carry no leading zeros.
const NUM = "(0|[1-9][0-9]*)";
const PRE_ID = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?$`);

/** Accepts an optional single leading "v". Returns null for "dev", build metadata or any malformed input. */
export function parseVersion(s: string): ParsedVersion | null {
  if (typeof s !== "string") return null;
  const m = SEMVER_RE.exec(s.startsWith("v") ? s.slice(1) : s);
  if (!m) return null;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, pre: m[4] ? m[4].split(".") : [] };
}

const isNumeric = (id: string) => /^[0-9]+$/.test(id);

function comparePre(a: string[], b: string[]): number {
  // A release outranks any prerelease of the same X.Y.Z.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as string;
    const y = b[i] as string;
    if (x === y) continue;
    const xn = isNumeric(x);
    const yn = isNumeric(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1; // numeric < alphanumeric
    return x < y ? -1 : 1; // ASCII order
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** Semver 2.0 order. Returns null when either side is not a valid version (e.g. "dev"). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (const k of ["major", "minor", "patch"] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre) as -1 | 0 | 1;
}

/** True only when both sides parse and candidate is strictly greater. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

export function isPrerelease(v: string): boolean {
  const p = parseVersion(v);
  return p !== null && p.pre.length > 0;
}

export const RELEASE_REPO = "jhin1m/manga-web-translate";

export function releaseUrl(v: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/tag/v${v}`;
}

export function composeUrl(ref: string): string {
  return `https://raw.githubusercontent.com/${RELEASE_REPO}/${ref}/docker-compose.yml`;
}

export const UPDATER_PORT = 8090;
/** File name inside `${MTL_DATA_DIR}/secrets/`. */
export const UPDATER_TOKEN_FILE = "updater-token";

export function runnerName(project: string): string {
  return `${project}-update`;
}

/** Image repositories the updater may pull. "postgres" means docker.io/library/postgres and must be normalized before comparing. */
export const ALLOWED_IMAGE_REPOS = ["ghcr.io/jhin1m/mtl", "ghcr.io/jhin1m/mtl-worker", "postgres"] as const;

export const UPDATE_REASONS = [
  "unavailable",
  "not_ready",
  "no_socket",
  "docker_too_old",
  "project_not_found",
  "custom_compose",
  "path_mismatch",
  "pinned",
  "busy",
  "cooldown",
  "not_newer",
  "dev_build",
  "stale",
  "download_failed",
  "invalid_compose",
  "image_not_allowed",
  "pull_failed",
  "version_mismatch",
  "up_failed",
  "timeout",
  "internal",
] as const;
export type UpdateReason = (typeof UPDATE_REASONS)[number];

/** apply = write compose then `up -d --wait` (the app container is recreated); check = compare mounts and version afterwards. */
export const UPDATE_STEPS = ["preflight", "download", "pull", "verify", "apply", "check", "done"] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];

export type UpdateRun = {
  state: "running" | "succeeded" | "failed";
  target: string;
  from: string;
  step: UpdateStep;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  reason: UpdateReason | null;
  /** At most 40 lines, each at most 300 characters. */
  log_tail: string[];
};

/** Body of the updater's `GET /v1/status`; also embedded in UpdateStatus. */
export type UpdaterStatus = {
  ready: boolean;
  reason: UpdateReason | null;
  project: string | null;
  run: UpdateRun | null;
};

/** Body of `GET /api/admin/update`. An unreachable updater is reported as `{ ready: false, reason: "unavailable" }`. */
export type UpdateStatus = {
  /** "0.3.0" or "dev". */
  current: string;
  check: "ok" | "disabled" | "dev" | "error";
  latest: { version: string; name: string; url: string; source: "github" | "override" } | null;
  update_available: boolean;
  /** MTL_TAG when it is not "latest". */
  pinned_tag: string | null;
  updater: UpdaterStatus;
};
