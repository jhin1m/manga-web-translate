/**
 * Tạo tài khoản (đăng nhập email/mật khẩu) — chạy được cả khi đăng ký công khai đang tắt (SIGNUP_ENABLED=false).
 *   OWNER_PASSWORD=... pnpm create-user --email a@example.com [--name "A"]
 * Không có OWNER_PASSWORD → hỏi mật khẩu trên terminal.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { closeDb } from "../apps/api/src/db.ts";
import { createUser } from "../apps/api/src/lib/create-user.ts";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
  },
});
const email = values.email;
if (!email) {
  console.error('usage: pnpm create-user --email ... [--name "..."]');
  process.exit(2);
}

async function askPassword(): Promise<string | undefined> {
  if (process.env.OWNER_PASSWORD) return process.env.OWNER_PASSWORD;
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("Mật khẩu (≥ 10 ký tự): ");
  rl.close();
  return pw || undefined;
}

try {
  const password = await askPassword();
  if (!password) throw new Error("thiếu mật khẩu (OWNER_PASSWORD hoặc nhập trên terminal)");
  const res = await createUser({ email, name: values.name ?? email.split("@")[0] ?? email, password });
  console.info(`user ${res.userId} created`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
