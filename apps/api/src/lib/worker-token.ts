/**
 * Token worker: chuỗi ngẫu nhiên 32 byte, DB chỉ lưu sha256. Worker gửi `Authorization: Bearer <token>`.
 * Worker chung toàn hệ thống (claim job mọi người dùng): `kind='mac'` = máy người vận hành, `kind='modal'` = GPU thuê
 * qua dispatcher (tính tiền GPU, phiên dispatch).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { workerTokens } from "@mtl/db";
import { JOB_TYPES } from "@mtl/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../db.ts";

const PREFIX = "mtlw_";

export type WorkerIdentity = {
  tokenId: string;
  kind: "mac" | "modal";
  /** Rỗng = không giới hạn thêm (vẫn phải là tập con JobType). */
  capabilities: string[];
};

export function generateWorkerToken(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export function hashWorkerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Tra token theo hash rồi so constant-time; token thu hồi/không có → null. Cập nhật last_seen_at tối đa 1 lần/phút. */
export async function authenticateWorker(token: string): Promise<WorkerIdentity | null> {
  if (!token.startsWith(PREFIX) || token.length > 128) return null;
  const hash = hashWorkerToken(token);
  const [row] = await db.select().from(workerTokens).where(eq(workerTokens.tokenHash, hash)).limit(1);
  if (!row || row.revokedAt) return null;
  if (!timingSafeEqual(Buffer.from(row.tokenHash, "hex"), Buffer.from(hash, "hex"))) return null;
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 60_000) {
    await db.update(workerTokens).set({ lastSeenAt: sql`now()` }).where(eq(workerTokens.id, row.id));
  }
  return { tokenId: row.id, kind: row.kind, capabilities: row.capabilities };
}

/** Tạo token mới → trả token gốc (chỉ hiện một lần). */
export async function createWorkerToken(opts: {
  name: string;
  kind: "mac" | "modal";
  capabilities?: string[];
}): Promise<{ id: string; token: string }> {
  const bad = (opts.capabilities ?? []).filter((c) => !(JOB_TYPES as readonly string[]).includes(c));
  if (bad.length) throw new Error(`capability không hợp lệ: ${bad.join(", ")}`);
  const token = generateWorkerToken();
  const [row] = await db
    .insert(workerTokens)
    .values({
      name: opts.name,
      kind: opts.kind,
      capabilities: opts.capabilities ?? [],
      tokenHash: hashWorkerToken(token),
    })
    .returning({ id: workerTokens.id });
  if (!row) throw new Error("insert worker token failed");
  return { id: row.id, token };
}

export async function revokeWorkerToken(id: string): Promise<boolean> {
  const rows = await db
    .update(workerTokens)
    .set({ revokedAt: sql`now()` })
    .where(eq(workerTokens.id, id))
    .returning({ id: workerTokens.id });
  return rows.length > 0;
}
