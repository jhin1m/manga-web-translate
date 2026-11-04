import { type aiModels, aiProviders, type DbLike } from "@mtl/db";
import type { AiTaskSlot } from "@mtl/shared";
import { HTTPException } from "hono/http-exception";
import { sendAlert } from "./alert.ts";
import { decryptSecret, SecretsError, secretsConfigured } from "./secrets.ts";

type ProviderRow = typeof aiProviders.$inferSelect;
type ModelRow = typeof aiModels.$inferSelect;

export const modelView = (m: ModelRow) => ({
  id: m.id,
  model_id: m.modelId,
  price_in: m.priceIn,
  price_out: m.priceOut,
  vision: m.vision,
  reasoning: m.reasoning,
});

/** Bản trả về web: chỉ `key_last4`, không bao giờ `api_key_enc`. */
export const providerView = (p: ProviderRow, models: ModelRow[]) => ({
  id: p.id,
  type: p.type,
  name: p.name,
  base_url: p.baseUrl,
  key_last4: p.keyLast4,
  structured_output: p.structuredOutput,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
  models: models.map(modelView),
});

/** Lỗi Postgres (kể cả bọc trong `cause` của drizzle) khớp mã SQLSTATE. */
export function pgError(err: unknown, code: string): { constraint_name?: string } | undefined {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === code) return e as { constraint_name?: string };
  }
  return undefined;
}

/** Tên slot từ tên ràng buộc FK của `system_settings` (`system_settings_<slot>_model_id_ai_models_id_fk`). */
export function slotOfConstraint(name: string | undefined): AiTaskSlot | undefined {
  const m = /^system_settings_(ocr|translate|proofread)_model_id_/.exec(name ?? "");
  return m?.[1] as AiTaskSlot | undefined;
}

/**
 * Lúc khởi động: thử giải mã mọi key provider. Không chặn khởi động (API vẫn phục vụ phần còn lại); chỉ log id +
 * báo động để admin nhập lại key.
 */
export async function verifyProviderSecrets(t: DbLike): Promise<void> {
  const rows = await t.select({ id: aiProviders.id, enc: aiProviders.apiKeyEnc }).from(aiProviders);
  if (rows.length === 0) return;
  const bad: string[] = [];
  for (const r of rows) {
    try {
      decryptSecret(r.enc, r.id);
    } catch (err) {
      bad.push(err instanceof SecretsError && err.code === "secrets_key_missing" ? `${r.id}(no-key)` : r.id);
    }
  }
  if (bad.length === 0) return;
  console.error(`[secrets] không giải mã được key của ${bad.length}/${rows.length} provider: ${bad.join(", ")}`);
  await sendAlert(
    "Key provider AI không giải mã được",
    secretsConfigured()
      ? `SECRETS_KEY không khớp với ${bad.length} provider — nhập lại key trên Cài đặt → AI.`
      : "Thiếu SECRETS_KEY nhưng DB có provider AI — đặt lại SECRETS_KEY (hoặc nhập lại key).",
  );
}

/** Lỗi API dạng `{error, ...extra}` với mã HTTP. */
export const fail = (status: 400 | 404 | 409, error: string, extra: Record<string, unknown> = {}) =>
  new HTTPException(status, { res: Response.json({ error, ...extra }, { status }) });

/**
 * Tóm tắt lỗi để log: chỉ tên + mã SQLSTATE / ràng buộc. Không log message / params — lỗi drizzle mang theo tham số
 * câu lệnh (ciphertext key, key_last4).
 */
export function safeErrorSummary(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const x = e as { name?: string; code?: unknown; constraint_name?: unknown };
    parts.push(
      [
        x.name ?? "Error",
        typeof x.code === "string" ? `code=${x.code}` : "",
        typeof x.constraint_name === "string" ? `constraint=${x.constraint_name}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return parts.join(" <- ");
}
