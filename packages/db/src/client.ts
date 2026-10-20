import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export type Schema = typeof schema;
/** DB hoặc transaction — cả hai đều là PgDatabase. */
export type DbLike = PgDatabase<PostgresJsQueryResultHKT, Schema>;

/**
 * Tạo kết nối. Chỉ composition root (apps/api/src/db.ts, scripts, test) được gọi;
 * route không được import — lint chặn (biome noRestrictedImports).
 */
export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
export type Db = ReturnType<typeof createDb>["db"];
