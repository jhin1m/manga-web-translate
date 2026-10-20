import { type SQL, sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

/** PK uuid v7 sinh ở app (Postgres 17 chưa có uuidv7()). */
export const idPk = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** CHECK (col IN (...)) từ danh sách hằng dùng chung với zod ở @mtl/shared. */
export function inList(column: SQL | string, values: readonly string[]): SQL {
  const col = typeof column === "string" ? sql.identifier(column) : column;
  return sql`${col} in (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", "))})`;
}
