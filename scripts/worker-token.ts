/**
 * Tạo / thu hồi token worker. Token gốc chỉ ghi ra file quyền 600 (không in ra terminal, không qua argv của worker).
 *   pnpm worker-token create --name mac-ducanh --workspace <ws-id> --out ~/.config/mtl/worker.token [--capabilities a,b]
 *   pnpm worker-token create --name modal --platform --out ./modal.token        # token nền tảng (Modal, Phase 7)
 *   pnpm worker-token revoke --id <token-id>
 * Worker đọc token qua MTL_TOKEN_FILE=<file> hoặc macOS Keychain (xem worker/README).
 */
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { closeDb } from "../apps/api/src/db.ts";
import { createWorkerToken, revokeWorkerToken } from "../apps/api/src/lib/worker-token.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    workspace: { type: "string" },
    platform: { type: "boolean", default: false },
    capabilities: { type: "string" },
    out: { type: "string" },
    force: { type: "boolean", default: false },
    id: { type: "string" },
  },
});

const usage = () => {
  console.error(
    "usage: pnpm worker-token create --name N (--workspace WS | --platform) --out FILE [--capabilities a,b] [--force]\n" +
      "       pnpm worker-token revoke --id TOKEN_ID",
  );
  process.exit(2);
};

/** Ghi file mới với mode 600 ngay lúc tạo (không có khoảnh khắc file đọc được bởi người khác). */
function writeSecret(path: string, content: string, force: boolean) {
  if (existsSync(path) && !force) throw new Error(`${path} đã tồn tại (dùng --force để ghi đè)`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, force ? "w" : "wx", 0o600);
  try {
    writeSync(fd, `${content}\n`);
  } finally {
    closeSync(fd);
  }
}

try {
  const [cmd] = positionals;
  if (cmd === "create") {
    if (!values.name || !values.out || values.platform === !!values.workspace) usage();
    const caps = values.capabilities ? values.capabilities.split(",").map((c) => c.trim()) : [];
    const out = resolve((values.out as string).replace(/^~(?=\/)/, homedir()));
    const { id, token } = await createWorkerToken({
      name: values.name as string,
      workspaceId: values.platform ? null : (values.workspace as string),
      capabilities: caps,
    });
    writeSecret(out, token, values.force ?? false);
    console.info(`token id=${id} → ${out} (mode 600). Worker: MTL_TOKEN_FILE=${out}`);
  } else if (cmd === "revoke") {
    if (!values.id) usage();
    console.info((await revokeWorkerToken(values.id as string)) ? "revoked" : "not found");
  } else {
    usage();
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
