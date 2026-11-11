/**
 * Minimal Docker Engine API client over the unix socket (node:http only; no docker CLI in the image).
 * Paths are pinned to one API version so a newer daemon keeps answering with the schema this code was written for.
 */
import http from "node:http";
import type { UpdateReason } from "@mtl/shared/update";

export const DOCKER_API_VERSION = "v1.44";
export const DEFAULT_SOCKET = "/var/run/docker.sock";

/** A failed Engine API call mapped onto an update reason. `status` is the daemon's HTTP status when there was one. */
export class DockerError extends Error {
  readonly reason: UpdateReason;
  readonly status: number | null;
  constructor(reason: UpdateReason, message: string, status: number | null = null) {
    super(message);
    this.name = "DockerError";
    this.reason = reason;
    this.status = status;
  }
}

// Socket missing, not readable, a directory (a short-syntax bind creates one when the file is absent) or nobody listening.
const NO_SOCKET_CODES = new Set(["ENOENT", "EACCES", "EPERM", "ECONNREFUSED", "ENOTSOCK", "ENOTDIR", "EISDIR"]);

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type ContainerSummary = { Id: string; Names?: string[]; Labels?: Record<string, string>; State?: string };
// Inspect payloads are consumed field by field by discovery.ts, which validates what it reads.
export type Json = Record<string, unknown>;

export type DockerApi = {
  inspectContainer(idOrName: string): Promise<Json | null>;
  listContainers(opts: { all?: boolean; labels?: string[]; name?: string }): Promise<ContainerSummary[]>;
  inspectImage(ref: string): Promise<Json | null>;
  createContainer(name: string, body: Json): Promise<{ Id: string }>;
  startContainer(id: string): Promise<void>;
  removeContainer(id: string, opts?: { force?: boolean }): Promise<void>;
  /** Raw text: callers create the container with `Tty: true`, so the stream is not multiplexed. */
  logs(id: string, opts: { tail: number }): Promise<string>;
};

type Raw = { status: number; text: string };

function mapSocketError(err: NodeJS.ErrnoException): DockerError {
  if (err.code && NO_SOCKET_CODES.has(err.code)) return new DockerError("no_socket", `docker socket: ${err.code}`);
  return new DockerError("internal", `docker socket: ${err.code ?? err.message}`);
}

function daemonMessage(text: string): string {
  try {
    const m = (JSON.parse(text) as { message?: unknown }).message;
    if (typeof m === "string") return m;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 300);
}

export function createDockerApi(opts: { socketPath?: string; timeoutMs?: number } = {}): DockerApi {
  const socketPath = opts.socketPath ?? DEFAULT_SOCKET;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  function raw(method: string, path: string, body?: Json): Promise<Raw> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          socketPath,
          method,
          path: `/${DOCKER_API_VERSION}${path}`,
          headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) {
              req.destroy(new Error("docker response too large"));
              return;
            }
            chunks.push(c);
          });
          res.on("error", (e) => reject(mapSocketError(e)));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("docker api timeout")));
      req.on("error", (e) => reject(mapSocketError(e)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** Throws on any non-2xx except the statuses the caller says it handles. */
  async function call(method: string, path: string, body?: Json, okStatuses: number[] = []): Promise<Raw> {
    const r = await raw(method, path, body);
    if ((r.status >= 200 && r.status < 300) || okStatuses.includes(r.status)) return r;
    const msg = daemonMessage(r.text);
    if (r.status === 400 && /client version/i.test(msg)) throw new DockerError("docker_too_old", msg, r.status);
    throw new DockerError("internal", `docker ${method} ${path.split("?")[0]} -> ${r.status}: ${msg}`, r.status);
  }

  const parse = <T>(r: Raw): T => {
    try {
      return JSON.parse(r.text) as T;
    } catch {
      throw new DockerError("internal", "docker returned invalid JSON");
    }
  };

  return {
    async inspectContainer(idOrName) {
      const r = await call("GET", `/containers/${encodeURIComponent(idOrName)}/json`, undefined, [404]);
      return r.status === 404 ? null : parse<Json>(r);
    },
    async listContainers({ all, labels, name }) {
      const filters: Record<string, string[]> = {};
      if (labels?.length) filters.label = labels;
      if (name) filters.name = [name];
      const q = new URLSearchParams({ all: all ? "1" : "0", filters: JSON.stringify(filters) });
      return parse<ContainerSummary[]>(await call("GET", `/containers/json?${q}`));
    },
    async inspectImage(ref) {
      const r = await call("GET", `/images/${encodeURIComponent(ref)}/json`, undefined, [404]);
      return r.status === 404 ? null : parse<Json>(r);
    },
    async createContainer(name, body) {
      const q = new URLSearchParams({ name });
      return parse<{ Id: string }>(await call("POST", `/containers/create?${q}`, body));
    },
    async startContainer(id) {
      await call("POST", `/containers/${encodeURIComponent(id)}/start`, undefined, [304]);
    },
    async removeContainer(id, o) {
      const q = new URLSearchParams({ force: o?.force ? "1" : "0" });
      await call("DELETE", `/containers/${encodeURIComponent(id)}?${q}`, undefined, [404]);
    },
    async logs(id, { tail }) {
      const q = new URLSearchParams({ stdout: "1", stderr: "1", tail: String(tail) });
      return (await call("GET", `/containers/${encodeURIComponent(id)}/logs?${q}`)).text;
    },
  };
}
