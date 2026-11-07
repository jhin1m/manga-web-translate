/**
 * Token worker của chế độ local nằm ở file (`/data/worker/token`, 0600) — worker container chỉ mount thư mục này
 * (read-only), không thấy secret khác. Boot nào cũng đối chiếu file với bảng `worker_tokens`:
 * - file hợp lệ + hash còn hiệu lực → giữ nguyên;
 * - file hợp lệ nhưng DB mất hash (DB bị xoá/khôi phục) → thêm lại hash, worker không phải đổi gì;
 * - hash bị thu hồi / file hỏng / chưa có file → sinh token mới, ghi tmp rồi rename (không bao giờ lộ file dở).
 */
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { type DbLike, workerTokens } from "@mtl/db";
import { eq } from "drizzle-orm";
import {
  generateWorkerToken,
  hashWorkerToken,
  looksLikeWorkerToken,
  registerWorkerToken,
} from "../lib/worker-token.ts";

export const LOCAL_WORKER_TOKEN_NAME = "local-worker";

export type WorkerTokenFileResult = "kept" | "restored" | "created";

async function readTokenFile(path: string): Promise<string | null> {
  try {
    const t = (await readFile(path, "utf8")).trim();
    return looksLikeWorkerToken(t) ? t : null;
  } catch {
    return null;
  }
}

export async function ensureWorkerTokenFile(conn: DbLike, path: string): Promise<WorkerTokenFileResult> {
  const opts = { name: LOCAL_WORKER_TOKEN_NAME, kind: "mac" as const };
  const existing = await readTokenFile(path);
  if (existing) {
    const [row] = await conn
      .select({ revokedAt: workerTokens.revokedAt })
      .from(workerTokens)
      .where(eq(workerTokens.tokenHash, hashWorkerToken(existing)))
      .limit(1);
    if (row && !row.revokedAt) {
      await chmod(path, 0o600); // worker từ chối file quyền rộng hơn 600
      return "kept";
    }
    if (!row) {
      await registerWorkerToken(existing, opts, conn);
      await chmod(path, 0o600);
      return "restored";
    }
  }
  const token = generateWorkerToken();
  await registerWorkerToken(token, opts, conn);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, `${token}\n`, { mode: 0o600 });
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return "created";
}
