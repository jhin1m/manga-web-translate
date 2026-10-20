import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

/** Đọc body JSON và validate bằng zod; sai → 400 kèm danh sách lỗi. */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => undefined);
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HTTPException(400, {
      res: Response.json({ error: "invalid_body", issues: r.error.issues }, { status: 400 }),
    });
  }
  return r.data;
}
