import { describe, expect, it } from "vitest";
import { suggestionsFor } from "./price-suggestions.ts";
import {
  applyChoice,
  applySuggestion,
  choiceOf,
  diffModels,
  draftOf,
  emptyDraft,
  emptyModel,
  type ProviderDraft,
  providerTypeLabel,
  type SavedProvider,
  toCreateBody,
  toPatchBody,
  validateDraft,
} from "./provider-form-model.ts";

const KEY = "sk-test-abcdefgh1234";
const draft = (over: Partial<ProviderDraft> = {}): ProviderDraft => ({
  ...emptyDraft(),
  name: "OpenAI",
  api_key: KEY,
  models: [{ ...emptyModel(), model_id: "gpt-4.1-mini", price_in: "0.4", price_out: "1.6" }],
  ...over,
});
const saved: SavedProvider = {
  id: "p1",
  type: "openai_compatible",
  name: "LLM",
  base_url: "https://llm.example.com/v1",
  key_last4: "1234",
  updated_at: "2026-11-04T00:00:00.000Z",
  structured_output: "json_schema",
  models: [
    { id: "m1", model_id: "a", price_in: 1, price_out: 2, vision: false, reasoning: false },
    { id: "m2", model_id: "b", price_in: 1, price_out: 2, vision: true, reasoning: false },
  ],
};

describe("validateDraft (create)", () => {
  it("accepts a complete openai draft", () => {
    expect(validateDraft(draft())).toBeNull();
  });
  it("requires name and key", () => {
    const e = validateDraft(draft({ name: " ", api_key: "" }));
    expect(e?.name).toBeTruthy();
    expect(e?.api_key).toBeTruthy();
    expect(validateDraft(draft({ api_key: "has space 12345" }))?.api_key).toBeTruthy();
  });
  it("compatible requires an https base url", () => {
    expect(validateDraft(draft({ type: "openai_compatible", base_url: "" }))?.base_url).toBeTruthy();
    expect(validateDraft(draft({ type: "openai_compatible", base_url: "http://x.com/v1" }))?.base_url).toMatch(/https/);
    expect(validateDraft(draft({ type: "openai_compatible", base_url: "https://x.com/v1" }))).toBeNull();
  });
  it("model needs both prices (>= 0) and a unique id", () => {
    const m = { ...emptyModel(), model_id: "x", price_in: "1", price_out: "" };
    expect(validateDraft(draft({ models: [m] }))?.models[0]).toMatch(/giá/);
    expect(validateDraft(draft({ models: [{ ...m, price_out: "-1" }] }))?.models[0]).toMatch(/giá/);
    expect(validateDraft(draft({ models: [{ ...m, price_out: "abc" }] }))?.models[0]).toMatch(/giá/);
    expect(validateDraft(draft({ models: [{ ...m, price_out: "100001" }] }))?.models[0]).toMatch(/tối đa 100,000/);
    expect(validateDraft(draft({ models: [{ ...m, price_out: "100000" }] }))).toBeNull();
    const ok = { ...m, price_out: "2" };
    expect(validateDraft(draft({ models: [ok, { ...ok }] }))?.models[1]).toMatch(/Trùng/);
    expect(validateDraft(draft({ models: [{ ...ok, model_id: " " }] }))?.models[0]).toMatch(/model id/);
  });
});

describe("validateDraft (edit)", () => {
  const d = draftOf(saved);
  it("empty key keeps the old one", () => {
    expect(validateDraft(d, saved)).toBeNull();
  });
  it("changing the base url requires re-entering the key", () => {
    const changed = { ...d, base_url: "https://other.example.com/v1" };
    expect(validateDraft(changed, saved)?.api_key).toMatch(/base URL/);
    expect(validateDraft({ ...changed, api_key: KEY }, saved)).toBeNull();
    // Cùng URL (khác dấu / cuối) không bị coi là đổi.
    expect(validateDraft({ ...d, base_url: "https://llm.example.com/v1/" }, saved)).toBeNull();
  });
});

describe("applySuggestion", () => {
  it("fills empty prices and flags for a known openai model", () => {
    const m = applySuggestion("openai", { ...emptyModel(), model_id: "gpt-4.1-mini" });
    expect(m).toMatchObject({ price_in: "0.4", price_out: "1.6", vision: true, reasoning: false });
  });
  it("a reasoning suggestion turns the reasoning flag on", () => {
    expect(applySuggestion("openai", { ...emptyModel(), model_id: "gpt-5-mini" }).reasoning).toBe(true);
  });
  it("never overwrites a price the admin typed", () => {
    const m = applySuggestion("openai", { ...emptyModel(), model_id: "gpt-4.1-mini", price_in: "9" });
    expect(m).toMatchObject({ price_in: "9", price_out: "1.6", vision: false });
  });
  it("ignores other provider types, unknown ids and saved models", () => {
    const m = { ...emptyModel(), model_id: "gpt-4.1-mini" };
    expect(applySuggestion("gemini", m)).toEqual(m);
    expect(applySuggestion("openai", { ...m, model_id: "mystery" })).toMatchObject({ price_in: "" });
    expect(applySuggestion("openai", { ...m, id: "x" })).toEqual({ ...m, id: "x" });
  });
});

describe("request bodies", () => {
  it("create body trims, converts prices, omits base_url for official types", () => {
    const b = toCreateBody(draft({ name: " OpenAI " }));
    expect(b).toMatchObject({ type: "openai", name: "OpenAI", api_key: KEY });
    expect(b).not.toHaveProperty("base_url");
    expect(b.models[0]).toEqual({
      model_id: "gpt-4.1-mini",
      price_in: 0.4,
      price_out: 1.6,
      vision: false,
      reasoning: false,
    });
  });
  it("patch body carries only changed fields and the key only when typed", () => {
    const d = draftOf(saved);
    expect(toPatchBody(d, saved)).toEqual({});
    expect(toPatchBody({ ...d, name: "Mới", api_key: KEY, structured_output: "json_object" }, saved)).toEqual({
      name: "Mới",
      api_key: KEY,
      structured_output: "json_object",
    });
    expect(toPatchBody({ ...d, base_url: "https://llm.example.com/v1/" }, saved)).toEqual({});
  });
});

describe("diffModels", () => {
  it("detects added, changed and removed models", () => {
    const d = draftOf(saved);
    const first = d.models[0];
    if (!first) throw new Error("fixture");
    d.models = [
      { ...first, price_in: "3", vision: true },
      { ...emptyModel(), model_id: "c", price_in: "1", price_out: "1" },
    ];
    expect(diffModels(d, saved)).toEqual({
      add: [{ model_id: "c", price_in: 1, price_out: 1, vision: false, reasoning: false }],
      patch: [{ id: "m1", body: { price_in: 3, vision: true } }],
      remove: [{ id: "m2", model_id: "b" }],
    });
  });
  it("no change → empty diff", () => {
    expect(diffModels(draftOf(saved), saved)).toEqual({ add: [], patch: [], remove: [] });
  });
});

describe("diffModels converges after a partial save", () => {
  const model = (id: string | undefined, model_id: string, price = "1") => ({
    ...emptyModel(),
    id,
    model_id,
    price_in: price,
    price_out: "2",
  });

  it("first save fails midway, second save does only the remaining work", () => {
    // Nháp: bỏ "b" (đang gán slot → xoá lỗi), thêm "c" (chưa có id).
    const d = { ...draftOf(saved), models: [model("m1", "a"), model(undefined, "c")] };
    const first = diffModels(d, saved);
    expect(first.remove).toEqual([{ id: "m2", model_id: "b" }]);
    expect(first.add.map((m) => m.model_id)).toEqual(["c"]);

    // Lần 1: "c" đã được thêm, "b" xoá lỗi → server giờ có a, b, c; nháp vẫn thế.
    const fresh: SavedProvider = {
      ...saved,
      models: [
        ...saved.models,
        { id: "m3", model_id: "c", price_in: 1, price_out: 2, vision: false, reasoning: false },
      ],
    };
    const second = diffModels(d, fresh);
    expect(second.add).toEqual([]); // không POST "c" lần nữa (duplicate_model)
    expect(second.patch).toEqual([]);
    expect(second.remove).toEqual([{ id: "m2", model_id: "b" }]);

    // Lần 2 xoá được "b" → lần 3 không còn việc.
    const done: SavedProvider = { ...fresh, models: fresh.models.filter((m) => m.id !== "m2") };
    expect(diffModels(d, done)).toEqual({ add: [], patch: [], remove: [] });
  });

  it("a removed model that is already gone on the server is not touched again", () => {
    const d = { ...draftOf(saved), models: [model("m1", "a"), model("m2", "b")] };
    const gone: SavedProvider = { ...saved, models: saved.models.filter((m) => m.id !== "m2") };
    expect(diffModels(d, gone)).toEqual({ add: [], patch: [], remove: [] });
  });

  it("removing a saved model and re-adding the same model_id keeps it (price update only, no delete/duplicate)", () => {
    const d = { ...draftOf(saved), models: [model("m1", "a"), model(undefined, "b", "5")] };
    const diff = diffModels(d, saved);
    expect(diff.remove).toEqual([]);
    expect(diff.add).toEqual([]);
    expect(diff.patch).toEqual([{ id: "m2", body: { price_in: 5, vision: false } }]);
  });
});

describe("DeepSeek preset", () => {
  it("chọn DeepSeek → openai_compatible + base URL DeepSeek + json_object; tạo body hợp lệ", () => {
    const d = applyChoice(draft({ name: "", models: [] }), "deepseek");
    expect(d).toMatchObject({
      type: "openai_compatible",
      name: "DeepSeek",
      base_url: "https://api.deepseek.com",
      structured_output: "json_object",
    });
    expect(choiceOf(d)).toBe("deepseek");
    const m = applySuggestion(d.type, { ...emptyModel(), model_id: "deepseek-flash" }, d.base_url);
    expect(m).toMatchObject({ price_in: "0.3", price_out: "1.2", vision: true, reasoning: false });
    const full = { ...d, models: [m] };
    expect(validateDraft(full)).toBeNull();
    expect(toCreateBody(full)).toMatchObject({ type: "openai_compatible", base_url: "https://api.deepseek.com" });
  });

  it("giữ tên đã gõ; rời DeepSeek bỏ base URL / tên mặc định và về json_schema", () => {
    expect(applyChoice(draft({ name: "DS chính" }), "deepseek").name).toBe("DS chính");
    const back = applyChoice(applyChoice(draft({ name: "" }), "deepseek"), "openai_compatible");
    expect(back).toMatchObject({ type: "openai_compatible", base_url: "", name: "", structured_output: "json_schema" });
    expect(choiceOf(back)).toBe("openai_compatible");
  });

  it("gợi ý giá DeepSeek chỉ áp cho endpoint DeepSeek; nhãn danh sách theo host", () => {
    const m = { ...emptyModel(), model_id: "deepseek-flash" };
    expect(applySuggestion("openai_compatible", m, "https://openrouter.ai/api/v1").price_in).toBe("");
    expect(providerTypeLabel({ type: "openai_compatible", base_url: "https://api.deepseek.com" })).toBe("DeepSeek");
    expect(providerTypeLabel({ type: "openai_compatible", base_url: "https://openrouter.ai/api/v1" })).toContain(
      "OpenAI-compatible",
    );
    expect(providerTypeLabel({ type: "openai", base_url: null })).toBe("OpenAI");
  });
});

describe("Anthropic models", () => {
  const anthropic = (models: ProviderDraft["models"]) => draft({ type: "anthropic", models });
  const row = (model_id: string, id?: string) => ({ ...emptyModel(), id, model_id, price_in: "1", price_out: "1" });

  it("rejects a blocked model next to its row and names the supported model", () => {
    expect(validateDraft(anthropic([row("claude-sonnet-5-5")]))?.models[0]).toContain("claude-haiku-5-5");
    expect(validateDraft(anthropic([row("claude-fable-5-1")]))?.models[0]).toContain("claude-haiku-5-5");
  });

  it("does not block a saved row or another provider type", () => {
    expect(validateDraft(anthropic([row("claude-sonnet-5-5", "saved-id")]))).toBeNull();
    expect(
      validateDraft(
        draft({ type: "openai_compatible", base_url: "https://llm.example.com", models: [row("claude-sonnet-5-5")] }),
      ),
    ).toBeNull();
  });

  it("suggests Haiku 5.5 with price and vision", () => {
    const filled = applySuggestion("anthropic", { ...emptyModel(), model_id: "claude-haiku-5-5" });
    expect(filled).toMatchObject({ price_in: "0.1", price_out: "0.5", vision: true, reasoning: false });
    expect(suggestionsFor("anthropic").map((s) => s.model_id)).toEqual(["claude-haiku-5-5"]);
  });
});
