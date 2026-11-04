/**
 * Cấu hình LLM theo job lúc claim: `payload.llm` (ref, không key) → giải mã key provider trong RAM. Kết quả chỉ nằm
 * trong response claim — không ghi DB, event hay log.
 */
import { aiModels, aiProviders, type DbLike } from "@mtl/db";
import { AI_TASK_SLOTS, type LlmConfigs, type LlmRefs } from "@mtl/shared";
import { eq, inArray } from "drizzle-orm";
import { decryptSecret, SecretsError } from "../lib/secrets.ts";

/** Lỗi cấu hình AI của job (job `failed` lớp `auth`): message dành cho người dùng, không chứa key / blob. */
export class LlmConfigError extends Error {}

const configError = (what: string, provider: string) =>
  new LlmConfigError(`Cấu hình AI lỗi: ${what} của provider «${provider}» — admin nhập lại key ở Cài đặt › AI`);

export async function resolveLlmConfigs(t: DbLike, refs: LlmRefs | undefined): Promise<LlmConfigs | undefined> {
  const wanted = AI_TASK_SLOTS.flatMap((slot) => {
    const ref = refs?.[slot];
    return ref ? [{ slot, ref }] : [];
  });
  if (wanted.length === 0) return undefined;

  const providerIds = [...new Set(wanted.map((w) => w.ref.provider_id))];
  const rows = await t
    .select({ provider: aiProviders, model: aiModels })
    .from(aiProviders)
    .leftJoin(aiModels, eq(aiModels.providerId, aiProviders.id))
    .where(inArray(aiProviders.id, providerIds));

  const out: LlmConfigs = {};
  for (const { slot, ref } of wanted) {
    const provider = rows.find((r) => r.provider.id === ref.provider_id)?.provider;
    if (!provider) {
      throw new LlmConfigError("Cấu hình AI lỗi: nhà cung cấp AI của tác vụ đã bị xoá — admin gán lại ở Cài đặt › AI");
    }
    const model = rows.find((r) => r.provider.id === provider.id && r.model?.modelId === ref.model)?.model;
    if (!model) throw configError(`model «${ref.model}» không còn`, provider.name);
    let apiKey: string;
    try {
      apiKey = decryptSecret(provider.apiKeyEnc, provider.id);
    } catch (err) {
      if (!(err instanceof SecretsError)) throw err;
      throw configError("không giải mã được key", provider.name);
    }
    out[slot] = {
      type: provider.type,
      model: model.modelId,
      api_key: apiKey,
      base_url: provider.baseUrl,
      structured_output: provider.structuredOutput,
      reasoning: model.reasoning,
    };
  }
  return out;
}
