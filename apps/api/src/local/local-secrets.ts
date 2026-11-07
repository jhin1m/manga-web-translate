/**
 * Chế độ local (self-host 1 người dùng): tự sinh secret lần đầu, lưu ở `${MTL_DATA_DIR}/secrets/` (thư mục 0700,
 * file 0600) và nạp vào `process.env` TRƯỚC khi `env.ts` parse. Đồng bộ (chạy lúc import env).
 * Tạo file bằng cờ `wx`: app và jobs cùng khởi động không ghi đè nhau — bên đến sau đọc lại giá trị của bên trước.
 * Biến đã đặt sẵn (khác rỗng) luôn thắng file — không ghi đè.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type RawEnv = Record<string, string | undefined>;

/** `MTL_LOCAL_MODE` thô (trước parse) có bật không — cùng tập giá trị với schema env. */
export const localModeRequested = (raw: RawEnv): boolean => ["1", "true"].includes(raw.MTL_LOCAL_MODE ?? "");

export const DEFAULT_DATA_DIR = "/data";
export const LOCAL_PORT = 8080;

const SECRETS: { name: string; file: string; generate: () => string }[] = [
  // 48 byte base64url = 64 ký tự (schema đòi ≥ 32); khoá ký `/files` cũng dẫn xuất từ đây.
  { name: "BETTER_AUTH_SECRET", file: "better-auth-secret", generate: () => randomBytes(48).toString("base64url") },
  // 32 byte base64 (44 ký tự, đuôi `=`) — khớp regex SECRETS_KEY trong env.ts.
  { name: "SECRETS_KEY", file: "secrets-key", generate: () => randomBytes(32).toString("base64") },
];

const isSet = (v: string | undefined): v is string => v !== undefined && v !== "";

/** Chờ đồng bộ (không bận CPU) — chỉ dùng khi đọc file vừa bị process khác tạo mà chưa kịp ghi. */
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Đọc secret ở `path`; chưa có thì sinh + tạo file (0600, `wx`). File có sẵn không bao giờ bị ghi đè. */
export function readOrCreateSecret(path: string, generate: () => string): string {
  try {
    const value = generate();
    writeFileSync(path, `${value}\n`, { flag: "wx", mode: 0o600 });
    return value;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  // Process khác vừa tạo file (open `wx`) nhưng có thể chưa ghi xong → đọc lại vài lần trước khi coi là hỏng.
  for (let i = 0; i < 20; i++) {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
    sleepSync(50);
  }
  throw new Error(`${path} rỗng — xoá file để sinh lại (dữ liệu mã hoá bằng secret cũ sẽ không đọc được)`);
}

/**
 * Nạp mặc định cho chế độ local vào `raw` (thường là `process.env`): secret từ file (sinh nếu chưa có),
 * `BETTER_AUTH_URL`/`WEB_ORIGIN` = http://localhost:8080, `API_PORT` = 8080. Chỉ gán biến chưa đặt.
 * `STORAGE_DRIVER` và `FILES_DIR` mặc định theo chế độ local nằm trong schema env (parse thuần, test được).
 */
export function applyLocalEnvDefaults(raw: RawEnv): void {
  const dataDir = isSet(raw.MTL_DATA_DIR) ? raw.MTL_DATA_DIR : DEFAULT_DATA_DIR;
  const missing = SECRETS.filter((s) => !isSet(raw[s.name]));
  if (missing.length > 0) {
    const dir = join(dataDir, "secrets");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const s of missing) raw[s.name] = readOrCreateSecret(join(dir, s.file), s.generate);
  }
  const origin = `http://localhost:${LOCAL_PORT}`;
  const defaults: RawEnv = { BETTER_AUTH_URL: origin, WEB_ORIGIN: origin, API_PORT: String(LOCAL_PORT) };
  for (const [k, v] of Object.entries(defaults)) if (!isSet(raw[k])) raw[k] = v;
}
