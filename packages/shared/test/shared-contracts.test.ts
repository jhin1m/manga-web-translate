import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClaimResponse,
  emptyPageState,
  idempotencyKey,
  JOB_TYPES,
  JobFonts,
  JobPayload,
  JobResult,
  keyBelongsToUser,
  LlmConfig,
  PageState,
  pageId,
  prepareInputRev,
  storageKeys,
  translateInputRev,
} from "../src/index.ts";
import { buildJsonSchemas } from "../src/json-schema.ts";

const CH = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b";

describe("page id", () => {
  it("is deterministic uuid v5 of (chapter, ingest_rev, ord)", () => {
    expect(pageId(CH, 1, 0)).toBe(pageId(CH, 1, 0));
    expect(pageId(CH, 1, 0)).not.toBe(pageId(CH, 2, 0));
    expect(pageId(CH, 1, 0)).not.toBe(pageId(CH, 1, 1));
    expect(pageId(CH, 1, 0)).toMatch(/^[0-9a-f-]{8}-[0-9a-f]{4}-5/);
  });
});

describe("input_rev / idempotency", () => {
  it("translate input_rev ignores page order", () => {
    const a = { pageId: "p1", prepareInputRev: "x" };
    const b = { pageId: "p2", prepareInputRev: "y" };
    expect(translateInputRev([a, b], 1, 2, "0.3.0")).toBe(translateInputRev([b, a], 1, 2, "0.3.0"));
    expect(translateInputRev([a, b], 2, 2, "0.3.0")).not.toBe(translateInputRev([a, b], 1, 2, "0.3.0"));
  });

  it("prepare input_rev changes with settings_rev and pipeline_version", () => {
    const base = prepareInputRev("ab".repeat(32), 1, "0.3.0");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(prepareInputRev("ab".repeat(32), 2, "0.3.0")).not.toBe(base);
    expect(prepareInputRev("ab".repeat(32), 1, "0.3.1")).not.toBe(base);
  });

  it("idempotency key is stable under option key order", () => {
    expect(idempotencyKey("chapter.export", CH, "r", { a: 1, b: 2 })).toBe(
      idempotencyKey("chapter.export", CH, "r", { b: 2, a: 1 }),
    );
    expect(idempotencyKey("chapter.export", CH, "r", { a: 1 })).not.toBe(
      idempotencyKey("chapter.export", CH, "r", { a: 2 }),
    );
  });
});

describe("PageState", () => {
  it("accepts an empty state and rejects non-NFC text (layout contract)", () => {
    const s = emptyPageState(800, 12000);
    expect(PageState.parse(s)).toEqual(s);
    const box = {
      id: "t1",
      region_id: null,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rotation: 0,
      text: "Anh đang làm gì vậy?",
      lines: ["Anh đang", "làm gì vậy?"],
      font_family: "BeVietnamPro-Bold",
      font_size: 22,
      line_height: 1.15,
      pad: 4,
      letter_spacing: 0,
      align: "center",
      fill: "#111",
      stroke: { color: "#fff", width: 3 },
      auto_fit: true,
      hidden: false,
    };
    expect(PageState.safeParse({ ...s, text_boxes: [box] }).success).toBe(true);
    const nfd = "ế".normalize("NFD");
    expect(PageState.safeParse({ ...s, text_boxes: [{ ...box, text: nfd }] }).success).toBe(false);
  });

  it("valign is optional (boxes saved before it exist) and limited to top|middle", () => {
    const s = emptyPageState(800, 1200);
    const box = {
      id: "t1",
      region_id: null,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rotation: 0,
      text: "a",
      lines: ["a"],
      font_family: "BeVietnamPro-Bold",
      font_size: 22,
      line_height: 1.15,
      pad: 4,
      letter_spacing: 0,
      align: "center",
      fill: "#111",
      stroke: null,
      auto_fit: true,
      hidden: false,
    };
    const parse = (extra: object) => PageState.safeParse({ ...s, text_boxes: [{ ...box, ...extra }] });
    const old = parse({});
    expect(old.success && old.data.text_boxes[0]?.valign).toBeUndefined();
    for (const v of ["top", "middle"]) {
      const r = parse({ valign: v });
      expect(r.success && r.data.text_boxes[0]?.valign).toBe(v);
    }
    expect(parse({ valign: "bottom" }).success).toBe(false);
  });

  it("region colors are optional (older pages) but must be #rrggbb when present", () => {
    const s = emptyPageState(800, 1200);
    const region = {
      id: "r1",
      kind: "text_bubble",
      bbox: [0, 0, 10, 10],
      polarity: "dark_on_light",
      source_text: "a",
      translation: "b",
      confidence: 1,
      flags: [],
    };
    const parse = (extra: object) => PageState.safeParse({ ...s, regions: [{ ...region, ...extra }] }).success;
    expect(parse({})).toBe(true);
    expect(parse({ text_color: "#c81414", outline_color: null })).toBe(true);
    expect(parse({ text_color: "#c81414", outline_color: "#000000" })).toBe(true);
    expect(parse({ text_color: "red" })).toBe(false);
    expect(parse({ text_color: "#c81414", outline_color: "#fff" })).toBe(false);
  });
});

describe("JobPayload", () => {
  it("covers every JobType", () => {
    const covered = JobPayload.options.map((o) => o.shape.type.value);
    expect([...covered].sort()).toEqual([...JOB_TYPES].sort());
  });
});

describe("per-job llm config", () => {
  const PROVIDER = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6c";
  const ref = { provider_id: PROVIDER, model: "gpt-4.1-mini" };
  const settings = {
    glossary: {},
    pronoun_rules: "",
    honorific_policy: "",
    style_prompt: "",
    font: "Bangers-Regular",
  };
  const cfg = {
    type: "openai",
    model: "gpt-4.1-mini",
    api_key: "sk-test-123456789",
    base_url: null,
    structured_output: "json_schema",
    reasoning: false,
  };
  const job = (payload: unknown, llm?: unknown) => ({
    id: PROVIDER,
    type: "chapter.proofread",
    attempt: 1,
    lease_token: "t",
    lease_expires_at: "2026-11-05T03:00:00.000Z",
    payload,
    inputs: {},
    outputs: {},
    ...(llm ? { llm } : {}),
  });

  it("payloads accept an llm snapshot and still parse without it", () => {
    const base = { chapter_id: CH, page_ids: [CH], settings };
    expect(
      JobPayload.safeParse({
        type: "chapter.translate",
        ...base,
        context: "rolling",
        glossary_rev: 0,
        settings_rev: 0,
        llm: { translate: ref },
      }).success,
    ).toBe(true);
    expect(
      JobPayload.safeParse({ type: "page.prepare", page_id: CH, source_lang: "ko", llm: { ocr: ref } }).success,
    ).toBe(true);
    expect(
      JobPayload.safeParse({
        type: "page.ocr_region",
        page_id: CH,
        bbox: [0, 0, 5, 5],
        llm: { ocr: ref, translate: ref },
      }).success,
    ).toBe(true);
    expect(JobPayload.safeParse({ type: "page.ocr_region", page_id: CH, bbox: [0, 0, 5, 5] }).success).toBe(true);
    // model_tier optional: job hiệu đính cũ (có tier) và mới (có llm) đều hợp lệ.
    expect(JobPayload.safeParse({ type: "chapter.proofread", ...base, model_tier: "premium" }).success).toBe(true);
    expect(JobPayload.safeParse({ type: "chapter.proofread", ...base, llm: { proofread: ref } }).success).toBe(true);
    expect(JobPayload.safeParse({ type: "chapter.proofread", ...base, model_tier: "gold" }).success).toBe(false);
  });

  it("an llm ref needs a uuid provider and a model; the payload never carries a key", () => {
    const base = { type: "page.prepare", page_id: CH, source_lang: "ko" };
    expect(JobPayload.safeParse({ ...base, llm: { ocr: { provider_id: "x", model: "m" } } }).success).toBe(false);
    expect(JobPayload.safeParse({ ...base, llm: { ocr: { provider_id: PROVIDER, model: "" } } }).success).toBe(false);
    expect(JobPayload.safeParse({ ...base, llm: { ocr: { ...ref, api_key: "sk" } } }).success).toBe(false);
  });

  it("claim response parses with and without llm; LlmConfig rejects unknown fields", () => {
    const payload = { type: "chapter.proofread", chapter_id: CH, page_ids: [CH], model_tier: "standard", settings };
    expect(ClaimResponse.safeParse({ jobs: [job(payload)] }).success).toBe(true);
    expect(ClaimResponse.safeParse({ jobs: [job(payload, { proofread: cfg })] }).success).toBe(true);
    expect(ClaimResponse.safeParse({ jobs: [job(payload, { proofread: { ...cfg, vision: true } })] }).success).toBe(
      false,
    );
    expect(
      LlmConfig.safeParse({ ...cfg, base_url: "https://llm.example.com/v1", type: "openai_compatible" }).success,
    ).toBe(true);
    for (const bad of [{ api_key: "" }, { type: "mistral" }, { structured_output: "text" }]) {
      expect(LlmConfig.safeParse({ ...cfg, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("JobFonts", () => {
  const sha256 = "a".repeat(64);
  const url = "https://files.example/font";

  it("accepts only custom-<8 hex> ids, never a bundled font id or a path", () => {
    expect(JobFonts.safeParse([{ id: "custom-0a1b2c3d", url, sha256 }]).success).toBe(true);
    for (const id of [
      "Bangers-Regular",
      "custom-0A1B2C3D",
      "custom-0a1b2c3",
      "custom-0a1b2c3d/../x",
      "../custom-0a1b2c3d",
      "",
    ]) {
      expect(JobFonts.safeParse([{ id, url, sha256 }]).success, id).toBe(false);
    }
  });
});

describe("chapter.translate result: series memory", () => {
  const base = { type: "chapter.translate", pages: [] };
  const term = { source: "민준", target: "Min Jun", kind: "person" };
  const pair = { speaker: "A", listener: "B", address: "anh - em" };

  it("accepts results without the new keys", () => {
    expect(JobResult.safeParse(base).success).toBe(true);
  });

  it("accepts valid new_terms and pronoun_pairs", () => {
    const r = JobResult.safeParse({ ...base, new_terms: [term], pronoun_pairs: [pair] });
    expect(r.success).toBe(true);
  });

  it("strips unknown keys", () => {
    const r = JobResult.parse({ ...base, new_terms: [{ ...term, extra: 1 }], junk: true });
    expect(r).not.toHaveProperty("junk");
    expect((r as { new_terms: object[] }).new_terms[0]).not.toHaveProperty("extra");
  });

  it("rejects bad kind, empty or oversized strings, and too many items", () => {
    const bad = (extra: object) => JobResult.safeParse({ ...base, ...extra }).success;
    expect(bad({ new_terms: [{ ...term, kind: "item" }] })).toBe(false);
    expect(bad({ new_terms: [{ ...term, source: "" }] })).toBe(false);
    expect(bad({ new_terms: [{ ...term, target: "x".repeat(201) }] })).toBe(false);
    expect(bad({ new_terms: Array.from({ length: 51 }, () => term) })).toBe(false);
    expect(bad({ pronoun_pairs: [{ ...pair, speaker: "x".repeat(81) }] })).toBe(false);
    expect(bad({ pronoun_pairs: [{ ...pair, address: "x".repeat(121) }] })).toBe(false);
    expect(bad({ pronoun_pairs: [{ ...pair, listener: "" }] })).toBe(false);
    expect(bad({ pronoun_pairs: Array.from({ length: 31 }, () => pair) })).toBe(false);
  });
});

describe("storage keys", () => {
  it("are namespaced by user and revisioned", () => {
    expect(storageKeys.clean("w1", "p1", 7)).toBe("u/w1/pg/p1/clean/7.png");
    expect(keyBelongsToUser(storageKeys.source("w1", "c1", "u1", "png"), "w1")).toBe(true);
    expect(keyBelongsToUser(storageKeys.source("w1", "c1", "u1", "png"), "w2")).toBe(false);
    expect(keyBelongsToUser("u/w1/../w2/x", "w1")).toBe(false);
  });
});

describe("committed JSON Schema", () => {
  it("matches the zod source (run `pnpm schema:emit` after changing schemas)", () => {
    const dir = join(import.meta.dirname, "..", "json-schema");
    const built = buildJsonSchemas();
    expect(readdirSync(dir).sort()).toEqual(
      Object.keys(built)
        .map((n) => `${n}.schema.json`)
        .sort(),
    );
    for (const [name, schema] of Object.entries(built)) {
      expect(JSON.parse(readFileSync(join(dir, `${name}.schema.json`), "utf8")), name).toEqual(schema);
    }
  });
});
