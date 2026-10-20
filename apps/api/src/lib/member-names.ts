import { member, user } from "@mtl/db";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db.ts";

/**
 * Tên hiển thị của các user id — chỉ trả user là thành viên của workspace (không lộ tên người ngoài).
 * Dùng cho "đang được X sửa" (khoá chương).
 */
export async function memberNames(workspaceId: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, workspaceId)))
    .where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
