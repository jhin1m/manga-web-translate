/**
 * Tạo workspace đầu tiên (và owner nếu chưa có). Đăng ký công khai bị tắt — đây là cách duy nhất tạo workspace.
 *   OWNER_PASSWORD=... pnpm create-workspace --name "Nhóm dịch" --slug nhom-dich --owner-email a@example.com [--owner-name "A"]
 * Không có OWNER_PASSWORD và owner chưa tồn tại → hỏi mật khẩu trên terminal.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { closeDb } from "../apps/api/src/db.ts";
import { createWorkspace } from "../apps/api/src/lib/workspace-admin.ts";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    "owner-email": { type: "string" },
    "owner-name": { type: "string" },
  },
});
const name = values.name;
const slug = values.slug;
const email = values["owner-email"];
if (!name || !slug || !email) {
  console.error('usage: pnpm create-workspace --name "..." --slug ... --owner-email ... [--owner-name ...]');
  process.exit(2);
}

async function askPassword(): Promise<string | undefined> {
  if (process.env.OWNER_PASSWORD) return process.env.OWNER_PASSWORD;
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("Owner password (nếu owner chưa có tài khoản, ≥ 10 ký tự): ");
  rl.close();
  return pw || undefined;
}

try {
  const res = await createWorkspace({
    name,
    slug,
    owner: { email, name: values["owner-name"] ?? email.split("@")[0] ?? email, password: await askPassword() },
  });
  console.info(`workspace ${res.workspaceId} created, owner ${res.ownerId}`);
} finally {
  await closeDb();
}
