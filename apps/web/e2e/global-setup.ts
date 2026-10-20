import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { E2E_ENV, STATE_FILE } from "./env.ts";

/** Reset DB e2e + tạo workspace/owner/series/token worker; lưu vào STATE_FILE cho test. */
export default function globalSetup() {
  const seed = fileURLToPath(new URL("./seed.ts", import.meta.url));
  const out = execFileSync("pnpm", ["--filter", "@mtl/api", "exec", "tsx", seed], {
    env: { ...process.env, ...E2E_ENV },
    encoding: "utf8",
  });
  const last = out.trim().split("\n").pop() ?? "";
  writeFileSync(STATE_FILE, last);
}
