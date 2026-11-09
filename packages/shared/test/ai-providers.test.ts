import { describe, expect, it } from "vitest";
import {
  AiModelInput,
  AiModelPatch,
  AiProviderInput,
  AiProviderPatch,
  AiSlots,
  ApiKey,
  isModelUnsupported,
  normalizeBaseUrl,
  RECOMMENDED_ANTHROPIC_MODEL,
} from "../src/ai-providers.ts";

const KEY = "sk-test-abcdefgh1234";
const model = { model_id: "gpt-4.1-mini", price_in: 0.4, price_out: 1.6 };

describe("ApiKey", () => {
  it("trims the ends and accepts printable ASCII", () => {
    expect(ApiKey.parse(`  ${KEY}\n`)).toBe(KEY);
  });
  it.each(["short", "sk-abc def-1234", "sk-abc\ndef-1234", "sk-abc​def-1234", "sk-ábc-defgh1234"])("rejects %j", (k) => {
    expect(ApiKey.safeParse(k).success).toBe(false);
  });
});

describe("normalizeBaseUrl", () => {
  it("keeps https origin + path, drops query/hash/trailing slash", () => {
    expect(normalizeBaseUrl("https://example.com/v1/?a=1#x")).toBe("https://example.com/v1");
    expect(normalizeBaseUrl(" https://example.com:8443/ ")).toBe("https://example.com:8443");
  });
  it.each(["http://example.com/v1", "https://u:p@example.com", "ftp://x.com", "not a url", ""])("rejects %j", (u) => {
    expect(normalizeBaseUrl(u)).toBeNull();
  });
});

describe("AiProviderInput", () => {
  it("openai without base_url; defaults for flags", () => {
    const r = AiProviderInput.parse({ type: "openai", name: "OpenAI", api_key: KEY, models: [model] });
    expect(r.structured_output).toBe("json_schema");
    expect(r.models[0]).toMatchObject({ vision: false, reasoning: false });
  });
  it("compatible requires https base_url; other types must not have one", () => {
    const base = { name: "X", api_key: KEY };
    expect(AiProviderInput.safeParse({ ...base, type: "openai_compatible" }).success).toBe(false);
    expect(AiProviderInput.safeParse({ ...base, type: "openai_compatible", base_url: "http://x.com/v1" }).success).toBe(
      false,
    );
    expect(AiProviderInput.safeParse({ ...base, type: "openai", base_url: "https://x.com/v1" }).success).toBe(false);
    const ok = AiProviderInput.parse({ ...base, type: "openai_compatible", base_url: "https://x.com/v1/" });
    expect(ok.base_url).toBe("https://x.com/v1");
  });
  it("rejects duplicate model ids, negative price, unknown fields", () => {
    const base = { type: "openai", name: "X", api_key: KEY };
    expect(AiProviderInput.safeParse({ ...base, models: [model, model] }).success).toBe(false);
    expect(AiProviderInput.safeParse({ ...base, models: [{ ...model, price_in: -1 }] }).success).toBe(false);
    expect(AiProviderInput.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
  it("validation issues do not echo the key", () => {
    const r = AiProviderInput.safeParse({ type: "nope", name: "", api_key: "bad key with spaces" });
    expect(JSON.stringify(r.error?.issues)).not.toContain("bad key with spaces");
  });
});

describe("patches and slots", () => {
  it("model patch cannot carry model_id; provider patch cannot carry type", () => {
    expect(AiModelPatch.safeParse({ model_id: "x" }).success).toBe(false);
    expect(AiModelPatch.safeParse({ price_in: 1 }).success).toBe(true);
    expect(AiProviderPatch.safeParse({ type: "openai" }).success).toBe(false);
    expect(AiModelInput.safeParse(model).success).toBe(true);
  });
  it("slots need all three keys, uuid or null", () => {
    const id = "0194f6a0-0000-7000-8000-000000000001";
    expect(AiSlots.safeParse({ ocr: id, translate: null, proofread: null }).success).toBe(true);
    expect(AiSlots.safeParse({ ocr: id, translate: null }).success).toBe(false);
    expect(AiSlots.safeParse({ ocr: "x", translate: null, proofread: null }).success).toBe(false);
  });
});

describe("models the worker cannot run", () => {
  const body = (type: string, model_id: string) => ({
    type,
    name: "x",
    api_key: KEY,
    ...(type === "openai_compatible" ? { base_url: "https://llm.example.com/v1" } : {}),
    models: [{ model_id, price_in: 1, price_out: 1 }],
  });

  it.each(["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-mythos-5-1"])(
    "rejects %s for Anthropic, with a hint at the supported model",
    (id) => {
      expect(isModelUnsupported("anthropic", id)).toBe(true);
      const r = AiProviderInput.safeParse(body("anthropic", id));
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toContain(RECOMMENDED_ANTHROPIC_MODEL);
    },
  );

  it.each([
    ["anthropic", "claude-haiku-5-5"],
    ["anthropic", "claude-sonnet-5"],
    ["anthropic", "claude-opus-5"],
    ["openai_compatible", "claude-sonnet-5-5"],
  ])("accepts %s %s", (type, id) => {
    expect(isModelUnsupported(type, id)).toBe(false);
    expect(AiProviderInput.safeParse(body(type, id)).success).toBe(true);
  });
});
