import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_SETTINGS,
  isLlmPayload,
  JobPayload,
  legacyProofreadTier,
  PipelineSettings,
  prepareInputRev,
  prepareOptions,
  resolvePipelineSettings,
} from "../src/index.ts";

const PAGE = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b";
const SHA = "ab".repeat(32);

describe("legacy proofread tier", () => {
  it("is no longer a pipeline setting but is still readable from stored jsonb", () => {
    expect(DEFAULT_PIPELINE_SETTINGS).not.toHaveProperty("proofread_tier");
    expect(resolvePipelineSettings({ proofread_tier: "premium" })).not.toHaveProperty("proofread_tier");
    expect(legacyProofreadTier({ proofread_tier: "premium" })).toBe("premium");
    for (const raw of [undefined, null, {}, "premium", { proofread_tier: "gold" }, { proofread_tier: "standard" }]) {
      expect(legacyProofreadTier(raw)).toBe("standard");
    }
  });
});

describe("pipeline settings", () => {
  it("defaults validate and resolve from empty/garbage", () => {
    expect(PipelineSettings.parse(DEFAULT_PIPELINE_SETTINGS)).toEqual(DEFAULT_PIPELINE_SETTINGS);
    expect(resolvePipelineSettings({})).toEqual(DEFAULT_PIPELINE_SETTINGS);
    expect(resolvePipelineSettings(null)).toEqual(DEFAULT_PIPELINE_SETTINGS);
    expect(resolvePipelineSettings("x")).toEqual(DEFAULT_PIPELINE_SETTINGS);
  });

  it("keeps valid keys, drops invalid ones per key", () => {
    const s = resolvePipelineSettings({
      inpainter: "lama_manga",
      detection_threshold: 2,
      ocr_engines: { ja: "manga_ocr", ko: "manga_ocr", zh: "paddle_ocr" },
      unknown: 1,
    });
    expect(s.inpainter).toBe("lama_manga");
    expect(s.detection_threshold).toBe(DEFAULT_PIPELINE_SETTINGS.detection_threshold);
    expect(s.ocr_engines).toEqual({ ko: "paddle_ocr", ja: "manga_ocr", zh: "paddle_ocr", en: "paddle_ocr" });
    const llm = resolvePipelineSettings({ ocr_engines: { ko: "llm", ja: "llm", zh: "llm", en: "llm" } });
    expect(llm.ocr_engines).toEqual({ ko: "llm", ja: "llm", zh: "llm", en: "llm" });
  });

  it("rejects engine that cannot read the language", () => {
    const bad = {
      ...DEFAULT_PIPELINE_SETTINGS,
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "manga_ocr" },
    };
    expect(PipelineSettings.safeParse(bad).success).toBe(false);
  });

  it("prepare input_rev omits options only for the LLM-OCR baseline, changes otherwise", () => {
    const base = prepareInputRev(SHA, 1, "0.4.0");
    const allLlm = {
      ...DEFAULT_PIPELINE_SETTINGS,
      ocr_engines: { ko: "llm", ja: "llm", zh: "llm", en: "llm" },
    } as const;
    expect(prepareInputRev(SHA, 1, "0.4.0", prepareOptions(allLlm, "ja"))).toBe(base);
    // Mặc định OCR local ≠ mốc LLM: không được trùng rev với trang đã OCR bằng LLM.
    const local = prepareInputRev(SHA, 1, "0.4.0", prepareOptions(DEFAULT_PIPELINE_SETTINGS, "ko"));
    expect(local).not.toBe(base);
    const custom = prepareOptions({ ...allLlm, inpainter: "lama_manga" }, "ko");
    expect(prepareInputRev(SHA, 1, "0.4.0", custom)).not.toBe(base);
  });

  it("local OCR prepare is not an LLM job", () => {
    const local = prepareOptions(DEFAULT_PIPELINE_SETTINGS, "ja");
    expect(local.ocr_engine).toBe("manga_ocr");
    const llm = { ...local, ocr_engine: "llm" as const };
    const p = (pipeline?: typeof local) =>
      JobPayload.parse({ type: "page.prepare", page_id: PAGE, source_lang: "ja", pipeline });
    expect(isLlmPayload(p())).toBe(true);
    expect(isLlmPayload(p(llm))).toBe(true);
    expect(isLlmPayload(p(local))).toBe(false);
    expect(isLlmPayload({ type: "page.ocr_region" })).toBe(true);
    expect(isLlmPayload({ type: "chapter.export" })).toBe(false);
  });
});
