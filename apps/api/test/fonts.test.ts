/** Danh sách font chọn được + font thoại mặc định phải khớp worker/fonts/manifest.json (worker vẽ, editor đo theo đó). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_DIALOGUE_FONT } from "../src/jobs/enqueue.ts";
import { FONT_IDS } from "../src/routes/series.ts";

const manifest = JSON.parse(readFileSync(new URL("../../../worker/fonts/manifest.json", import.meta.url), "utf8")) as {
  defaults: string[];
  fonts: Record<string, { viComplete: boolean }>;
};

describe("fonts", () => {
  it("series font choices are exactly the manifest fonts, all covering Vietnamese", () => {
    expect([...FONT_IDS].sort()).toEqual(Object.keys(manifest.fonts).sort());
    for (const id of FONT_IDS) expect(manifest.fonts[id]?.viComplete).toBe(true);
  });

  it("default dialogue font is the manifest's first default", () => {
    expect(DEFAULT_DIALOGUE_FONT).toBe(manifest.defaults[0]);
  });
});
