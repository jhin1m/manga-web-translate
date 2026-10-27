import { and, eq, type SQL, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbLike } from "./client.ts";

/** Bảng nghiệp vụ: có cột user_id. */
export type OwnedTable = PgTable & { userId: PgColumn };
export type OwnedTableWithId = OwnedTable & { id: PgColumn };
type Row<T extends PgTable> = T["$inferSelect"];
type Values<T extends PgTable> = Omit<T["$inferInsert"], "userId">;

/** Không thấy trong dữ liệu của người dùng hiện tại — kể cả khi id thuộc người khác. Route map sang 404. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(what = "resource") {
    super(`${what} not found`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

/** Bỏ userId khỏi dữ liệu ghi — không cho chuyển bản ghi sang người dùng khác. */
function withoutOwner<T extends object>(values: T): T {
  const { userId: _ignored, ...rest } = values as T & { userId?: unknown };
  return rest as T;
}

/** Truy cập DB giới hạn trong dữ liệu của một người dùng. */
export interface Scoped {
  readonly userId: string;
  select<T extends OwnedTable>(table: T, where?: SQL): Promise<Row<T>[]>;
  find<T extends OwnedTable>(table: T, where?: SQL): Promise<Row<T> | undefined>;
  /** Đếm dòng theo nhóm cột (GROUP BY trong SQL) — không kéo cả dòng về khi chỉ cần số lượng. */
  countBy<T extends OwnedTable, C extends Record<string, PgColumn>>(
    table: T,
    by: C,
    where?: SQL,
  ): Promise<({ [K in keyof C]: C[K]["_"]["data"] } & { n: number })[]>;
  /** Giá trị lớn nhất của `col` theo nhóm cột (GROUP BY trong SQL). */
  maxBy<T extends OwnedTable, C extends Record<string, PgColumn>, M extends PgColumn>(
    table: T,
    by: C,
    col: M,
    where?: SQL,
  ): Promise<({ [K in keyof C]: C[K]["_"]["data"] } & { max: M["_"]["data"] })[]>;
  /** Không thấy trong dữ liệu người dùng (kể cả id của người khác, id không phải uuid) → NotFoundError. */
  byId<T extends OwnedTableWithId>(table: T, id: string, what?: string): Promise<Row<T>>;
  insert<T extends OwnedTable>(table: T, values: Values<T>): Promise<Row<T>>;
  update<T extends OwnedTable>(table: T, where: SQL, set: Partial<Values<T>>): Promise<Row<T>[]>;
  delete<T extends OwnedTable>(table: T, where: SQL): Promise<Row<T>[]>;
  transaction<R>(fn: (tx: Scoped) => Promise<R>): Promise<R>;
}

/**
 * Mọi câu lệnh tự thêm `user_id = userId`, kể cả tra theo id (byId không thấy → NotFoundError → 404);
 * dữ liệu ghi luôn bị ép user_id = userId. Route chỉ dùng helper này.
 */
export function scoped(db: DbLike, userId: string): Scoped {
  const own = (t: OwnedTable, where?: SQL) => and(eq(t.userId, userId), where);

  const api: Scoped = {
    userId,

    select<T extends OwnedTable>(table: T, where?: SQL): Promise<Row<T>[]> {
      return db
        .select()
        .from(table as PgTable)
        .where(own(table, where)) as unknown as Promise<Row<T>[]>;
    },

    async find<T extends OwnedTable>(table: T, where?: SQL): Promise<Row<T> | undefined> {
      const rows = (await db
        .select()
        .from(table as PgTable)
        .where(own(table, where))
        .limit(1)) as Row<T>[];
      return rows[0];
    },

    countBy<T extends OwnedTable, C extends Record<string, PgColumn>>(table: T, by: C, where?: SQL) {
      return db
        .select({ ...by, n: sql<number>`count(*)::int` })
        .from(table as PgTable)
        .where(own(table, where))
        .groupBy(...Object.values(by)) as unknown as Promise<({ [K in keyof C]: C[K]["_"]["data"] } & { n: number })[]>;
    },

    maxBy<T extends OwnedTable, C extends Record<string, PgColumn>, M extends PgColumn>(
      table: T,
      by: C,
      col: M,
      where?: SQL,
    ) {
      return db
        .select({ ...by, max: sql`max(${col})`.mapWith(col) })
        .from(table as PgTable)
        .where(own(table, where))
        .groupBy(...Object.values(by)) as unknown as Promise<
        ({ [K in keyof C]: C[K]["_"]["data"] } & { max: M["_"]["data"] })[]
      >;
    },

    async byId<T extends OwnedTableWithId>(table: T, id: string, what?: string): Promise<Row<T>> {
      if (!isUuid(id)) throw new NotFoundError(what);
      const row = await api.find(table, eq(table.id, id));
      if (!row) throw new NotFoundError(what);
      return row;
    },

    async insert<T extends OwnedTable>(table: T, values: Values<T>): Promise<Row<T>> {
      const rows = (await db
        .insert(table as PgTable)
        .values({ ...withoutOwner(values as object), userId } as T["$inferInsert"])
        .returning()) as Row<T>[];
      return rows[0] as Row<T>;
    },

    update<T extends OwnedTable>(table: T, where: SQL, set: Partial<Values<T>>): Promise<Row<T>[]> {
      return db
        .update(table as PgTable)
        .set(withoutOwner(set as object))
        .where(own(table, where))
        .returning() as unknown as Promise<Row<T>[]>;
    },

    delete<T extends OwnedTable>(table: T, where: SQL): Promise<Row<T>[]> {
      return db
        .delete(table as PgTable)
        .where(own(table, where))
        .returning() as unknown as Promise<Row<T>[]>;
    },

    transaction<R>(fn: (tx: Scoped) => Promise<R>): Promise<R> {
      return db.transaction((tx) => fn(scoped(tx as unknown as DbLike, userId)));
    },
  };
  return api;
}
