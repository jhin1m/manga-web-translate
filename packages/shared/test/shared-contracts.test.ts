import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyPageState,
  idempotencyKey,
  JOB_TYPES,
  JobPayload,
  keyBelongsToWorkspace,
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
});

describe("JobPayload", () => {
  it("covers every JobType", () => {
    const covered = JobPayload.options.map((o) => o.shape.type.value);
    expect([...covered].sort()).toEqual([...JOB_TYPES].sort());
  });
});

describe("storage keys", () => {
  it("are namespaced by workspace and revisioned", () => {
    expect(storageKeys.clean("w1", "p1", 7)).toBe("ws/w1/pg/p1/clean/7.png");
    expect(keyBelongsToWorkspace(storageKeys.source("w1", "c1", "u1", "png"), "w1")).toBe(true);
    expect(keyBelongsToWorkspace(storageKeys.source("w1", "c1", "u1", "png"), "w2")).toBe(false);
    expect(keyBelongsToWorkspace("ws/w1/../w2/x", "w1")).toBe(false);
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
