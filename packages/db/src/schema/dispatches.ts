import { DISPATCH_STATUSES } from "@mtl/shared";
import { sql } from "drizzle-orm";
import { check, index, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { idPk, inList } from "./columns.ts";

/**
 * Mỗi lần dispatcher gọi Modal `/drain` = 1 dòng (1 container). pending → active khi container claim lần đầu
 * (kèm dispatch_id) → ended khi container báo `sessions/end` (hoặc reaper ước lượng khi bị kill); pending quá
 * hạn không có claim → no_claim (backoff). Dispatcher không bắn thêm khi còn dispatch mở → không trùng GPU.
 */
export const dispatches = pgTable(
  "dispatches",
  {
    id: idPk(),
    status: text("status").$type<(typeof DISPATCH_STATUSES)[number]>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    firstClaimAt: timestamp("first_claim_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Container tự báo lúc thoát; null khi reaper ước lượng. */
    lifetimeS: real("lifetime_s"),
    busyS: real("busy_s"),
    /** Lý do kết thúc bất thường (lỗi gọi /drain, `killed_estimated`…). */
    note: text("note"),
  },
  (t) => [
    index("dispatches_open_idx").on(t.createdAt).where(sql`${t.status} in ('pending', 'active')`),
    check("dispatches_status_chk", inList(sql`${t.status}`, DISPATCH_STATUSES)),
  ],
);
