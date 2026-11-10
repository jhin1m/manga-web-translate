/**
 * Nhà cung cấp AI + model (admin). Key mã hoá ở DB (`lib/secrets.ts`), không bao giờ có trong response / log / lỗi.
 * Xoá / sửa bị chặn khi model còn được gán slot (FK RESTRICT) hoặc job đang hoạt động tham chiếu.
 */
import { aiModels, aiProviders, type DbLike, isUuid, jobs } from "@mtl/db";
import {
  ACTIVE_JOB_STATUSES,
  AiModelInput,
  AiModelPatch,
  AiProviderInput,
  AiProviderPatch,
  isModelUnsupported,
} from "@mtl/shared";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { probeProvider } from "../ai/probe.ts";
import { env } from "../env.ts";
import { inJobTx } from "../jobs/enqueue.ts";
import { fail, modelView, pgError, providerView, safeErrorSummary, slotOfConstraint } from "../lib/ai-providers.ts";
import { decryptSecret, encryptSecret, SecretsError, secretsConfigured } from "../lib/secrets.ts";
import { lockSystemSettings, readSystemSettings, saveSlots, systemSlots } from "../lib/system-settings.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

export const adminProviderRoutes = new Hono<AppEnv>();

// Lỗi bất ngờ (DB...) không đi qua handler chung: nó log cả lỗi drizzle, mà lỗi này mang tham số câu lệnh (ciphertext key).
adminProviderRoutes.onError((err, c) => {
  if (err instanceof HTTPException) return err.res ?? c.json({ error: err.message }, err.status);
  console.error(`[admin-providers] lỗi không mong đợi: ${safeErrorSummary(err)}`);
  return c.json({ error: "internal" }, 500);
});

const requireSecretsKey = () => {
  if (!secretsConfigured()) throw fail(409, "secrets_key_missing");
};

async function modelsOf(t: DbLike, providerIds: string[]) {
  if (providerIds.length === 0) return [];
  return t
    .select()
    .from(aiModels)
    .where(inArray(aiModels.providerId, providerIds))
    .orderBy(asc(aiModels.createdAt), asc(aiModels.modelId));
}

/** `lock` = khoá dòng tới hết transaction (đọc-rồi-ghi không bị request song song chen giữa). */
async function providerById(t: DbLike, id: string, lock = false) {
  const q = isUuid(id) ? t.select().from(aiProviders).where(eq(aiProviders.id, id)) : undefined;
  const [p] = q ? await (lock ? q.for("update") : q) : [];
  if (!p) throw fail(404, "not_found");
  return p;
}

async function modelById(t: DbLike, id: string) {
  const [m] = isUuid(id) ? await t.select().from(aiModels).where(eq(aiModels.id, id)) : [];
  if (!m) throw fail(404, "not_found");
  return m;
}

/** Số job đang hoạt động có `payload.llm` tham chiếu provider (và model, nếu truyền). */
async function activeJobsUsing(t: DbLike, providerId: string, model?: string): Promise<number> {
  const llm = sql`(case when jsonb_typeof(${jobs.payload}->'llm') = 'object' then ${jobs.payload}->'llm' else '{}'::jsonb end)`;
  const [r] = await t
    .select({ n: count() })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, [...ACTIVE_JOB_STATUSES]),
        sql`exists (select 1 from jsonb_each(${llm}) e where e.value->>'provider_id' = ${providerId}${
          model === undefined ? sql`` : sql` and e.value->>'model' = ${model}`
        })`,
      ),
    );
  return r?.n ?? 0;
}

async function assertNoActiveJobs(t: DbLike, providerId: string, model?: string) {
  const n = await activeJobsUsing(t, providerId, model);
  if (n > 0) throw fail(409, "in_use_by_jobs", { jobs: n });
}

/** FK RESTRICT từ slot → 409 `in_use` kèm slot; lỗi khác ném tiếp. */
async function orInUse<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (err) {
    const fk = pgError(err, "23503");
    if (fk) throw fail(409, "in_use", { slot: slotOfConstraint(fk.constraint_name) ?? null });
    throw err;
  }
}

/** Local mode, DB chưa có provider: provider sắp tạo tự được gán slot. Khoá settings trước để 2 request không cùng thấy 0. */
async function isFirstLocalProvider(t: DbLike, modelCount: number): Promise<boolean> {
  if (!env.MTL_LOCAL_MODE || modelCount === 0) return false;
  await lockSystemSettings(t);
  const [r] = await t.select({ n: count() }).from(aiProviders);
  return r?.n === 0;
}

/** Điền ô slot trống theo thứ tự admin nhập (`returning` không đảm bảo thứ tự): dịch = model đầu, OCR + hiệu đính = model vision đầu. */
async function fillEmptySlots(
  t: DbLike,
  input: readonly AiModelInput[],
  rows: readonly { id: string; modelId: string }[],
) {
  const idOf = (m: AiModelInput | undefined) => rows.find((r) => r.modelId === m?.model_id)?.id ?? null;
  const vision = idOf(input.find((m) => m.vision));
  const slots = await systemSlots(t);
  await saveSlots(t, {
    translate: slots.translate ?? idOf(input[0]),
    ocr: slots.ocr ?? vision,
    proofread: slots.proofread ?? vision,
  });
}

adminProviderRoutes.get("/providers", async (c) => {
  const out = await inJobTx(async (tx) => {
    const providers = await tx.select().from(aiProviders).orderBy(asc(aiProviders.createdAt));
    const models = await modelsOf(
      tx,
      providers.map((p) => p.id),
    );
    return providers.map((p) =>
      providerView(
        p,
        models.filter((m) => m.providerId === p.id),
      ),
    );
  });
  return c.json({ providers: out, secrets_configured: secretsConfigured() });
});

adminProviderRoutes.post("/providers", async (c) => {
  const body = await parseJson(c, AiProviderInput);
  requireSecretsKey();
  const id = uuidv7(); // làm AAD của key nên sinh trước khi mã hoá
  const view = await inJobTx(async (tx) => {
    const autoAssign = await isFirstLocalProvider(tx, body.models.length);
    const [p] = await tx
      .insert(aiProviders)
      .values({
        id,
        type: body.type,
        name: body.name,
        baseUrl: body.base_url ?? null,
        apiKeyEnc: encryptSecret(body.api_key, id),
        keyLast4: body.api_key.slice(-4),
        structuredOutput: body.structured_output,
      })
      .returning();
    const models = body.models.length
      ? await tx
          .insert(aiModels)
          .values(
            body.models.map((m) => ({
              providerId: id,
              modelId: m.model_id,
              priceIn: m.price_in,
              priceOut: m.price_out,
              vision: m.vision,
              reasoning: m.reasoning,
            })),
          )
          .returning()
      : [];
    if (!p) throw new Error("insert ai_providers returned no row");
    if (autoAssign) await fillEmptySlots(tx, body.models, models);
    return providerView(p, models);
  });
  return c.json(view, 201);
});

adminProviderRoutes.patch("/providers/:id", async (c) => {
  const body = await parseJson(c, AiProviderPatch);
  const id = c.req.param("id");
  const view = await inJobTx(async (tx) => {
    const cur = await providerById(tx, id, true);
    if (body.base_url !== undefined && cur.type !== "openai_compatible") throw fail(400, "base_url_not_supported");
    // Đổi host mà giữ key cũ = gửi key đã lưu tới host lạ → bắt nhập lại key.
    if (body.base_url !== undefined && body.base_url !== cur.baseUrl && body.api_key === undefined) {
      throw fail(409, "key_required");
    }
    if (body.api_key !== undefined) requireSecretsKey();
    const [p] = await tx
      .update(aiProviders)
      .set({
        name: body.name,
        baseUrl: body.base_url,
        structuredOutput: body.structured_output,
        ...(body.api_key === undefined
          ? {}
          : { apiKeyEnc: encryptSecret(body.api_key, id), keyLast4: body.api_key.slice(-4) }),
      })
      .where(eq(aiProviders.id, id))
      .returning();
    if (!p) throw fail(404, "not_found");
    return providerView(p, await modelsOf(tx, [id]));
  });
  return c.json(view);
});

adminProviderRoutes.delete("/providers/:id", async (c) => {
  const id = c.req.param("id");
  await orInUse(() =>
    inJobTx(async (tx) => {
      await lockSystemSettings(tx);
      await providerById(tx, id);
      await assertNoActiveJobs(tx, id);
      await tx.delete(aiProviders).where(eq(aiProviders.id, id));
    }),
  );
  return c.body(null, 204);
});

adminProviderRoutes.post("/providers/:id/models", async (c) => {
  const body = await parseJson(c, AiModelInput);
  const id = c.req.param("id");
  try {
    const m = await inJobTx(async (tx) => {
      const provider = await providerById(tx, id);
      if (isModelUnsupported(provider.type, body.model_id)) throw fail(400, "model_unsupported");
      const [row] = await tx
        .insert(aiModels)
        .values({
          providerId: id,
          modelId: body.model_id,
          priceIn: body.price_in,
          priceOut: body.price_out,
          vision: body.vision,
          reasoning: body.reasoning,
        })
        .returning();
      if (!row) throw new Error("insert ai_models returned no row");
      return row;
    });
    return c.json(modelView(m), 201);
  } catch (err) {
    if (pgError(err, "23505")) throw fail(409, "duplicate_model");
    // Provider bị xoá giữa lúc kiểm tra và insert.
    if (pgError(err, "23503")) throw fail(404, "not_found");
    throw err;
  }
});

adminProviderRoutes.patch("/models/:id", async (c) => {
  const body = await parseJson(c, AiModelPatch);
  const id = c.req.param("id");
  const m = await inJobTx(async (tx) => {
    await lockSystemSettings(tx);
    const cur = await modelById(tx, id);
    if (body.vision === false && cur.vision) {
      // Model đang gán OCR / Hiệu đính phải còn vision.
      const row = await readSystemSettings(tx);
      const slot = row?.ocrModelId === id ? "ocr" : row?.proofreadModelId === id ? "proofread" : null;
      if (slot) throw fail(409, "in_use", { slot });
    }
    if (Object.values(body).every((v) => v === undefined)) return cur;
    const [row] = await tx
      .update(aiModels)
      .set({ priceIn: body.price_in, priceOut: body.price_out, vision: body.vision, reasoning: body.reasoning })
      .where(eq(aiModels.id, id))
      .returning();
    return row ?? cur;
  });
  return c.json(modelView(m));
});

adminProviderRoutes.delete("/models/:id", async (c) => {
  const id = c.req.param("id");
  await orInUse(() =>
    inJobTx(async (tx) => {
      await lockSystemSettings(tx);
      const m = await modelById(tx, id);
      await assertNoActiveJobs(tx, m.providerId, m.modelId);
      await tx.delete(aiModels).where(eq(aiModels.id, id));
    }),
  );
  return c.body(null, 204);
});

/** "Kiểm tra": giải mã key trong RAM, gọi endpoint nhẹ của provider; chỉ trả phân loại. */
adminProviderRoutes.post("/providers/:id/test", async (c) => {
  const body = await parseJson(c, z.object({ model: z.string().trim().min(1).max(128).optional() }));
  const id = c.req.param("id");
  const { p, firstModel } = await inJobTx(async (tx) => {
    const row = await providerById(tx, id);
    const [first] = await modelsOf(tx, [id]);
    return { p: row, firstModel: first?.modelId };
  });
  let key: string;
  try {
    key = decryptSecret(p.apiKeyEnc, p.id);
  } catch (err) {
    if (err instanceof SecretsError) throw fail(409, err.code === "secrets_key_missing" ? err.code : "key_unreadable");
    throw err;
  }
  const r = await probeProvider({ type: p.type, baseUrl: p.baseUrl }, key, body.model ?? firstModel);
  return c.json(r);
});
