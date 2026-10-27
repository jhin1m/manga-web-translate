import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Cờ vận hành toàn cục (không thuộc người dùng nào), VD `llm_paused` (circuit breaker, `until`),
 * `llm_errors` (cửa sổ lỗi provider), `runner_heartbeat` (healthz Phase 7).
 */
export const runtimeFlags = pgTable("runtime_flags", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  until: timestamp("until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
