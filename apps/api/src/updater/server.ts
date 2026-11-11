/**
 * `updater` command: a long-running HTTP service on the compose `internal` network. It holds the Docker socket but
 * runs nothing itself: it checks the project, then creates the detached runner container (`runner.ts`). Two routes:
 *   GET  /v1/status  -> UpdaterStatus
 *   POST /v1/update  {version} -> 202 {run} | {error, reason, detail?}
 * Every request needs `Authorization: Bearer <contents of the updater-token file>`.
 */
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  compareVersions,
  isNewer,
  isPrerelease,
  parseVersion,
  runnerName,
  UPDATE_REASONS,
  UPDATER_PORT,
  UPDATER_TOKEN_FILE,
  type UpdateReason,
  type UpdateRun,
  type UpdaterStatus,
} from "@mtl/shared/update";
import { discover, type InspectContainer, LABEL, projectOf, type Result, type UpdaterInfo } from "./discovery.ts";
import { createDockerApi, DEFAULT_SOCKET, type DockerApi, DockerError } from "./docker-api.ts";
import { buildRunnerBody, parseRunLog, RUNNER_LABELS } from "./runner-plan.ts";

const MAX_BODY_BYTES = 1024;
const COOLDOWN_MS = 60_000;
const RUN_LOG_LINES = 1000;
/** A runner that was created but never started this long ago is dead weight, not a running update. */
const STUCK_CREATED_MS = 60_000;

export type UpdaterOptions = {
  socketPath?: string;
  tokenPath?: string;
  /** Container id prefix of this process (Docker sets it as the hostname). */
  hostname?: string;
  now?: () => number;
  cooldownMs?: number;
};

const HTTP_STATUS: Partial<Record<UpdateReason, number>> = {
  no_socket: 503,
  docker_too_old: 503,
  not_ready: 503,
  internal: 500,
  busy: 409,
  cooldown: 429,
};

type Sent = { status: number; body: unknown };

const failure = (reason: UpdateReason, detail?: string, status?: number): Sent => ({
  status: status ?? HTTP_STATUS[reason] ?? 422,
  body: detail ? { error: reason, reason, detail } : { error: reason, reason },
});

const asInspect = (v: unknown) => v as InspectContainer;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function runFromContainer(c: InspectContainer, logText: string, nowMs: number): UpdateRun {
  const log = parseRunLog(logText);
  const status = c.State?.Status ?? "";
  const age = nowMs - Date.parse(c.Created ?? "");
  const stuck = status === "created" && age > STUCK_CREATED_MS;
  const running = !stuck && (status === "running" || status === "created" || status === "restarting");
  // A runner that never started has not succeeded, whatever its exit code field says.
  const exit = stuck ? null : (c.State?.ExitCode ?? null);
  const succeeded = !running && !stuck && exit === 0;
  const l = c.Config.Labels ?? {};
  const zero = (s?: string) => !s || s.startsWith("0001-");
  const state: UpdateRun["state"] = running ? "running" : succeeded ? "succeeded" : "failed";
  return {
    state,
    target: l[RUNNER_LABELS.target] ?? "",
    from: l[RUNNER_LABELS.from] ?? "",
    step: state === "succeeded" ? "done" : (log.step ?? "preflight"),
    started_at: (zero(c.State?.StartedAt) ? c.Created : c.State?.StartedAt) ?? "",
    finished_at: running || zero(c.State?.FinishedAt) ? null : (c.State?.FinishedAt ?? null),
    exit_code: running ? null : exit,
    reason: state === "failed" ? (log.reason ?? "internal") : null,
    log_tail: log.tail,
  };
}

export function createUpdaterServer(opts: UpdaterOptions = {}): http.Server {
  const docker: DockerApi = createDockerApi({ socketPath: opts.socketPath });
  const tokenPath = opts.tokenPath ?? `/data/secrets/${UPDATER_TOKEN_FILE}`;
  const hostname = opts.hostname ?? process.env.HOSTNAME ?? "";
  const now = opts.now ?? Date.now;
  const cooldownMs = opts.cooldownMs ?? COOLDOWN_MS;
  let lastAcceptedAt = Number.NEGATIVE_INFINITY;
  // Only one POST /v1/update is inspected and acted on at a time in this process.
  let starting = false;

  async function readToken(): Promise<string | null> {
    try {
      return (await readFile(tokenPath, "utf8")).trim() || null;
    } catch {
      return null;
    }
  }

  async function readRun(project: string): Promise<UpdateRun | null> {
    const c = await docker.inspectContainer(runnerName(project));
    if (!c) return null;
    const insp = asInspect(c);
    const logs = await docker.logs(insp.Id, { tail: RUN_LOG_LINES }).catch(() => "");
    return runFromContainer(insp, logs, now());
  }

  /** Self inspect -> project -> every container of the project -> pure analysis. */
  async function context(): Promise<{ project: string | null; result: Result<UpdaterInfo> }> {
    const self = await docker.inspectContainer(hostname);
    const project = self ? projectOf(asInspect(self)) : null;
    if (!self || !project) {
      return {
        project: null,
        result: { ok: false, reason: "project_not_found", detail: "this container is not part of a compose project" },
      };
    }
    const list = await docker.listContainers({ all: true, labels: [`${LABEL.project}=${project}`] });
    const found = await Promise.all(list.map((s) => docker.inspectContainer(s.Id)));
    const containers = found.filter((c): c is NonNullable<typeof c> => c !== null).map(asInspect);
    return { project, result: discover({ self: asInspect(self), containers }) };
  }

  async function status(): Promise<UpdaterStatus> {
    try {
      const self = await docker.inspectContainer(hostname);
      const project = self ? projectOf(asInspect(self)) : null;
      const run = project ? await readRun(project) : null;
      if (run?.state === "running") return { ready: false, reason: "busy", project, run };
      const { result } = await context();
      return result.ok
        ? { ready: true, reason: null, project, run }
        : { ready: false, reason: result.reason, project, run };
    } catch (e) {
      // A broken socket is a normal answer for the UI, not a server error.
      if (e instanceof DockerError) return { ready: false, reason: e.reason, project: null, run: null };
      throw e;
    }
  }

  async function startUpdate(version: string): Promise<Sent> {
    if (starting) return failure("busy");
    starting = true;
    try {
      return await startUpdateLocked(version);
    } finally {
      starting = false;
    }
  }

  async function startUpdateLocked(version: string): Promise<Sent> {
    if (now() - lastAcceptedAt < cooldownMs) return failure("cooldown");
    const { project, result } = await context();
    if (project) {
      const existing = await readRun(project);
      if (existing?.state === "running") return failure("busy");
    }
    if (!result.ok) return failure(result.reason, result.detail);
    const info = result.info;
    if (!info.selfImage) return failure("internal", "updater image id unknown");
    if (isPrerelease(version)) {
      // Only the exact version the operator configured on the app container; the request cannot widen it.
      const wanted = info.vars.MTL_UPDATE_TARGET ?? "";
      if (!parseVersion(wanted) || compareVersions(version, wanted) !== 0) {
        return failure("not_newer", `${version} is a prerelease and not the configured update target`);
      }
      // The configured target still has to move forward: no downgrade, no reinstall of the running version.
      if (!isNewer(version, info.current)) return failure("not_newer", `${version} is not newer than ${info.current}`);
    } else {
      if (!isNewer(version, info.current)) return failure("not_newer", `${version} is not newer than ${info.current}`);
      if (info.pinnedTag) return failure("pinned", `images are pinned to ${info.pinnedTag}`);
    }

    // Keep only the latest finished runner for its logs; a running one was ruled out above.
    const name = runnerName(info.project);
    await docker.removeContainer(name, { force: false }).catch(() => undefined);
    let id: string | null = null;
    try {
      const body = buildRunnerBody({
        image: info.selfImage,
        project: info.project,
        daemonDir: info.daemonDir,
        socketSource: info.socketSource,
        version,
        from: info.current,
        vars: info.vars,
      });
      id = (await docker.createContainer(name, body)).Id;
      await docker.startContainer(id);
    } catch (e) {
      if (id) await docker.removeContainer(id, { force: true }).catch(() => undefined);
      if (e instanceof DockerError) {
        if (e.status === 409) return failure("busy");
        if (e.reason === "no_socket" || e.reason === "docker_too_old") return failure(e.reason, e.message);
        // The daemon refused the mounts (or the request): nothing has changed yet.
        return failure("path_mismatch", e.message);
      }
      return failure("internal", e instanceof Error ? e.message : String(e));
    }
    lastAcceptedAt = now();
    const run = await readRun(info.project);
    return {
      status: 202,
      body: {
        run: run ?? {
          state: "running",
          target: version,
          from: info.current,
          step: "preflight",
          started_at: new Date(now()).toISOString(),
          finished_at: null,
          exit_code: null,
          reason: null,
          log_tail: [],
        },
      },
    };
  }

  async function readBody(req: http.IncomingMessage): Promise<{ ok: true; text: string } | { ok: false }> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY_BYTES) return { ok: false };
      chunks.push(c as Buffer);
    }
    return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
  }

  async function handle(req: http.IncomingMessage): Promise<Sent> {
    const token = await readToken();
    if (!token) return failure("not_ready", "updater token file is missing", 503);
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!m || !safeEqual(m[1] as string, token)) return { status: 401, body: { error: "unauthorized" } };

    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/v1/status") return { status: 200, body: await status() };
    if (req.method === "POST" && path === "/v1/update") {
      if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return { status: 415, body: { error: "unsupported_media_type" } };
      }
      const body = await readBody(req);
      if (!body.ok) return { status: 413, body: { error: "payload_too_large" } };
      let version: unknown;
      try {
        version = (JSON.parse(body.text) as { version?: unknown }).version;
      } catch {
        return { status: 400, body: { error: "bad_json" } };
      }
      // Plain "X.Y.Z[-pre]" only: the value ends up in a URL and in an image tag.
      if (typeof version !== "string" || version.startsWith("v") || !parseVersion(version)) {
        return { status: 400, body: { error: "bad_version" } };
      }
      return startUpdate(version);
    }
    return { status: 404, body: { error: "not_found" } };
  }

  return http.createServer((req, res) => {
    handle(req)
      .catch((e: unknown): Sent => {
        if (e instanceof DockerError) {
          const reason = (UPDATE_REASONS as readonly string[]).includes(e.reason) ? e.reason : "internal";
          return failure(reason, e.message);
        }
        console.error("[updater] unexpected error:", e instanceof Error ? e.message : e);
        return failure("internal");
      })
      .then(({ status: code, body }) => {
        const text = JSON.stringify(body);
        res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        res.end(text);
      });
  });
}

function main(): void {
  const server = createUpdaterServer({ socketPath: DEFAULT_SOCKET });
  server.listen(UPDATER_PORT, "0.0.0.0", () => console.log(`[updater] listening on :${UPDATER_PORT}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
