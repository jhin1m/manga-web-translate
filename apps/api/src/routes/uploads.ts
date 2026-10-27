import { chapters } from "@mtl/db";
import { storageKeys } from "@mtl/shared";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";
import { presignPost } from "../storage.ts";

/** Loại ảnh nhận upload → đuôi key. Kiểm magic bytes khi commit (Phase 4). */
export const UPLOAD_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_TTL_S = 10 * 60;

const UploadRequest = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.enum(Object.keys(UPLOAD_TYPES) as [keyof typeof UPLOAD_TYPES]),
  /** Dung lượng khai báo = trần content-length-range của policy. */
  bytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

export const uploadRoutes = new Hono<AppEnv>();

/** Cấp presigned POST cho 1 slice của chương. Chương phải thuộc người dùng (khác → 404). */
uploadRoutes.post("/chapters/:chapterId/uploads", async (c) => {
  const body = await parseJson(c, UploadRequest);
  const userId = c.get("userId");
  const chapter = await c.get("sdb").byId(chapters, c.req.param("chapterId"), "chapter");
  const uploadId = uuidv7();
  const key = storageKeys.source(userId, chapter.id, uploadId, UPLOAD_TYPES[body.content_type]);
  const post = await presignPost(key, body.content_type, body.bytes, UPLOAD_TTL_S);
  return c.json({ upload_id: uploadId, key, url: post.url, fields: post.fields, expires_at: post.expiresAt }, 201);
});
