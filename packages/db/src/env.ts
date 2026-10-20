import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Nạp `.env` ở gốc repo (nếu có) vào process.env; biến đã đặt sẵn không bị ghi đè. */
export function loadRootEnv(): void {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
