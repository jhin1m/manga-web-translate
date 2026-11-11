/**
 * Client của service `updater` (mạng compose `internal`, không publish cổng). Xác thực bằng Bearer token đọc từ
 * `${MTL_DATA_DIR}/secrets/updater-token` (app tạo, updater đọc lại mỗi request). App không có Docker socket.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  UPDATE_REASONS,
  UPDATER_PORT,
  UPDATER_TOKEN_FILE,
  type UpdateReason,
  type UpdateRun,
  type UpdaterStatus,
} from "@mtl/shared/update";
import { env } from "../env.ts";
import { readOrCreateSecret } from "../local/local-secrets.ts";

const STATUS_TIMEOUT_MS = 3000;
const START_TIMEOUT_MS = 15_000;

let base = `http://updater:${UPDATER_PORT}`;
let token: string | null = null;

/** Test trỏ client vào updater giả; không có biến môi trường cho URL. */
export function setUpdaterBaseForTest(url: string | null): void {
  base = url ?? `http://updater:${UPDATER_PORT}`;
  token = null;
}

const tokenPath = () => join(env.MTL_DATA_DIR, "secrets", UPDATER_TOKEN_FILE);

function getToken(): string {
  if (token) return token;
  try {
    mkdirSync(dirname(tokenPath()), { recursive: true, mode: 0o700 });
    token = readOrCreateSecret(tokenPath(), () => randomBytes(32).toString("base64url"));
    return token;
  } catch (err) {
    console.warn(`[updater] không tạo/đọc được updater-token: ${(err as NodeJS.ErrnoException).code ?? "lỗi"}`);
    throw err;
  }
}

/** Token lệch (file bị xoá/đổi tay) → đọc lại file ở lần gọi sau. */
const forgetToken = () => {
  token = null;
};

const UNAVAILABLE: UpdaterStatus = { ready: false, reason: "unavailable", project: null, run: null };

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${getToken()}` },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
}

const isReason = (v: unknown): v is UpdateReason => (UPDATE_REASONS as readonly unknown[]).includes(v);

export async function updaterStatus(): Promise<UpdaterStatus> {
  // MTL_UPDATER=0: không có service updater → không gọi mạng (tên `updater` có thể phân giải qua search domain).
  if (!env.MTL_UPDATER) return UNAVAILABLE;
  try {
    const res = await call("/v1/status", { method: "GET" }, STATUS_TIMEOUT_MS);
    if (res.status === 401) {
      forgetToken();
      console.warn("[updater] token bị từ chối (file updater-token lệch)");
      return { ...UNAVAILABLE, reason: "internal" };
    }
    if (!res.ok) {
      // Giữ reason của updater (vd 503 not_ready); body không đọc được hoặc lạ thì là lỗi nội bộ.
      const err = (await res.json().catch(() => null)) as { reason?: unknown; error?: unknown } | null;
      return { ...UNAVAILABLE, reason: [err?.reason, err?.error].find(isReason) ?? "internal" };
    }
    const body = (await res.json()) as Partial<UpdaterStatus>;
    return {
      ready: body.ready === true,
      reason: isReason(body.reason) ? body.reason : null,
      project: typeof body.project === "string" ? body.project : null,
      run: body.run ?? null,
    };
  } catch {
    // ENOTFOUND (compose cũ / MTL_UPDATER=0), ECONNREFUSED, timeout.
    return UNAVAILABLE;
  }
}

export type StartResult = { ok: true; run: UpdateRun } | { ok: false; status: number; reason: UpdateReason };

export async function startUpdate(version: string): Promise<StartResult> {
  if (!env.MTL_UPDATER) return { ok: false, status: 503, reason: "unavailable" };
  try {
    const res = await call(
      "/v1/update",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) },
      START_TIMEOUT_MS,
    );
    const body = (await res.json().catch(() => null)) as { run?: UpdateRun; reason?: unknown; error?: unknown } | null;
    if (res.ok && body?.run) return { ok: true, run: body.run };
    if (res.status === 401) {
      forgetToken();
      console.warn("[updater] token bị từ chối (file updater-token lệch)");
      return { ok: false, status: 502, reason: "internal" };
    }
    // Giữ nguyên status/reason của updater (reason nằm ở `reason` hoặc `error`); không nhận ra thì coi là lỗi nội bộ.
    const reason = [body?.reason, body?.error].find(isReason);
    return {
      ok: false,
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
      reason: reason ?? "internal",
    };
  } catch {
    return { ok: false, status: 503, reason: "unavailable" };
  }
}
