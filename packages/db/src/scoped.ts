import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbLike } from "./client.ts";

/** Bảng nghiệp vụ: có cột workspace_id. */
export type WsTable = PgTable & { workspaceId: PgColumn };
export type WsTableWithId = WsTable & { id: PgColumn };
type Row<T extends PgTable> = T["$inferSelect"];
type Values<T extends PgTable> = Omit<T["$inferInsert"], "workspaceId">;

/** Không thấy trong workspace hiện tại — kể cả khi id tồn tại ở workspace khác. Route map sang 404. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(what = "resource") {
    super(`${what} not found`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

/** Bỏ workspaceId khỏi dữ liệu ghi — không cho chuyển bản ghi sang workspace khác. */
function withoutWorkspace<T extends object>(values: T): T {
  const { workspaceId: _ignored, ...rest } = values as T & { workspaceId?: unknown };
  return rest as T;
}

/** Truy cập DB giới hạn trong một workspace. */
export interface Scoped {
  readonly workspaceId: string;
  select<T extends WsTable>(table: T, where?: SQL): Promise<Row<T>[]>;
  find<T extends WsTable>(table: T, where?: SQL): Promise<Row<T> | undefined>;
  /** Không thấy trong workspace (kể cả id thuộc workspace khác, id không phải uuid) → NotFoundError. */
  byId<T extends WsTableWithId>(table: T, id: string, what?: string): Promise<Row<T>>;
  insert<T extends WsTable>(table: T, values: Values<T>): Promise<Row<T>>;
  update<T extends WsTable>(table: T, where: SQL, set: Partial<Values<T>>): Promise<Row<T>[]>;
  delete<T extends WsTable>(table: T, where: SQL): Promise<Row<T>[]>;
  transaction<R>(fn: (tx: Scoped) => Promise<R>): Promise<R>;
}

/**
 * Mọi câu lệnh tự thêm `workspace_id = wsId`, kể cả tra theo id (byId không thấy → NotFoundError → 404);
 * dữ liệu ghi luôn bị ép workspace_id = wsId. Route chỉ dùng helper này.
 */
export function scoped(db: DbLike, wsId: string): Scoped {
  const own = (t: WsTable, where?: SQL) => and(eq(t.workspaceId, wsId), where);

  const api: Scoped = {
    workspaceId: wsId,

    select<T extends WsTable>(table: T, where?: SQL): Promise<Row<T>[]> {
      return db
        .select()
        .from(table as PgTable)
        .where(own(table, where)) as unknown as Promise<Row<T>[]>;
    },

    async find<T extends WsTable>(table: T, where?: SQL): Promise<Row<T> | undefined> {
      const rows = (await db
        .select()
        .from(table as PgTable)
        .where(own(table, where))
        .limit(1)) as Row<T>[];
      return rows[0];
    },

    async byId<T extends WsTableWithId>(table: T, id: string, what?: string): Promise<Row<T>> {
      if (!isUuid(id)) throw new NotFoundError(what);
      const row = await api.find(table, eq(table.id, id));
      if (!row) throw new NotFoundError(what);
      return row;
    },

    async insert<T extends WsTable>(table: T, values: Values<T>): Promise<Row<T>> {
      const rows = (await db
        .insert(table as PgTable)
        .values({ ...withoutWorkspace(values as object), workspaceId: wsId } as T["$inferInsert"])
        .returning()) as Row<T>[];
      return rows[0] as Row<T>;
    },

    update<T extends WsTable>(table: T, where: SQL, set: Partial<Values<T>>): Promise<Row<T>[]> {
      return db
        .update(table as PgTable)
        .set(withoutWorkspace(set as object))
        .where(own(table, where))
        .returning() as unknown as Promise<Row<T>[]>;
    },

    delete<T extends WsTable>(table: T, where: SQL): Promise<Row<T>[]> {
      return db
        .delete(table as PgTable)
        .where(own(table, where))
        .returning() as unknown as Promise<Row<T>[]>;
    },

    transaction<R>(fn: (tx: Scoped) => Promise<R>): Promise<R> {
      return db.transaction((tx) => fn(scoped(tx as unknown as DbLike, wsId)));
    },
  };
  return api;
}
