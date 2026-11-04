import { AI_PROVIDER_TYPES, type AiProviderType, STRUCTURED_OUTPUTS, type StructuredOutput } from "@mtl/shared";
import { sql } from "drizzle-orm";
import { boolean, check, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { idPk, inList, timestamps } from "./columns.ts";

/**
 * Nhà cung cấp AI do admin cấu hình. `api_key_enc` = blob AES-256-GCM (AAD gắn id dòng) — chỉ API giải mã;
 * `key_last4` là phần duy nhất của key được hiển thị.
 */
export const aiProviders = pgTable(
  "ai_providers",
  {
    id: idPk(),
    type: text("type").$type<AiProviderType>().notNull(),
    name: text("name").notNull(),
    /** Chỉ `openai_compatible` (bắt buộc), https. */
    baseUrl: text("base_url"),
    apiKeyEnc: text("api_key_enc").notNull(),
    keyLast4: text("key_last4").notNull(),
    structuredOutput: text("structured_output").$type<StructuredOutput>().notNull().default("json_schema"),
    ...timestamps,
  },
  (t) => [
    check("ai_providers_type_chk", inList(sql`${t.type}`, AI_PROVIDER_TYPES)),
    check("ai_providers_base_url_chk", sql`(${t.type} = 'openai_compatible') = (${t.baseUrl} is not null)`),
    check("ai_providers_structured_output_chk", inList(sql`${t.structuredOutput}`, STRUCTURED_OUTPUTS)),
  ],
);

/** Model của provider + giá (USD / 1M token, admin nhập). `model_id` bất biến sau khi tạo. */
export const aiModels = pgTable(
  "ai_models",
  {
    id: idPk(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    priceIn: numeric("price_in", { mode: "number" }).notNull(),
    priceOut: numeric("price_out", { mode: "number" }).notNull(),
    vision: boolean("vision").notNull().default(false),
    reasoning: boolean("reasoning").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_models_provider_model_uq").on(t.providerId, t.modelId),
    check("ai_models_price_chk", sql`${t.priceIn} >= 0 and ${t.priceOut} >= 0`),
  ],
);
