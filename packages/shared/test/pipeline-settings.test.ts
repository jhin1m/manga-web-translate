import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_SETTINGS,
  isLlmPayload,
  JobPayload,
  PipelineSettings,
  prepareInputRev,
  prepareOptions,
  resolvePipelineSettings,
} from "../src/index.ts";

const PAGE = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b";
const SHA = "ab".repeat(32);

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
    expect(s.ocr_engines).toEqual({ ko: "llm", ja: "manga_ocr", zh: "paddle_ocr", en: "llm" });
  });

  it("rejects engine that cannot read the language", () => {
    const bad = {
      ...DEFAULT_PIPELINE_SETTINGS,
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "manga_ocr" },
    };
    expect(PipelineSettings.safeParse(bad).success).toBe(false);
  });

  it("prepare input_rev unchanged for default options, changes otherwise", () => {
    const base = prepareInputRev(SHA, 1, "0.4.0");
    expect(prepareInputRev(SHA, 1, "0.4.0", prepareOptions(DEFAULT_PIPELINE_SETTINGS, "ja"))).toBe(base);
    const custom = prepareOptions({ ...DEFAULT_PIPELINE_SETTINGS, inpainter: "lama_manga" }, "ko");
    expect(prepareInputRev(SHA, 1, "0.4.0", custom)).not.toBe(base);
  });

  it("local OCR prepare is not an LLM job", () => {
    const llm = prepareOptions(DEFAULT_PIPELINE_SETTINGS, "ja");
    const local = { ...llm, ocr_engine: "manga_ocr" as const };
    const p = (pipeline?: typeof llm) =>
      JobPayload.parse({ type: "page.prepare", page_id: PAGE, source_lang: "ja", pipeline });
    expect(isLlmPayload(p())).toBe(true);
    expect(isLlmPayload(p(llm))).toBe(true);
    expect(isLlmPayload(p(local))).toBe(false);
    expect(isLlmPayload({ type: "page.ocr_region" })).toBe(true);
    expect(isLlmPayload({ type: "chapter.export" })).toBe(false);
  });
});
