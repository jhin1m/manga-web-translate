// Composition root của kết nối DB. Route KHÔNG import file này (lint chặn) — dùng c.var.sdb (scoped).
import { createDb } from "@mtl/db";
import { env } from "./env.ts";

export const { db, close: closeDb } = createDb(env.DATABASE_URL);
