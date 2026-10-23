/** `fonts` trong inputs translate/export: chỉ font tuỳ chỉnh có thật của workspace, font đã xoá bị bỏ. */
import { type jobs, pageStates, pages, scoped, series, workspaceFonts } from "@mtl/db";
import { ExportInputs, emptyPageState, pageId, storageKeys, TranslateInputs } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { buildInputs } from "../src/jobs/claim-inputs.ts";
import { db, seedWorkspace } from "./helpers.ts";
import { aiState, SHA } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
type Job = typeof jobs.$inferSelect;
let A: Seed;
let B: Seed;

const FONT_A = "custom-aaaaaaaa";
const FONT_A2 = "custom-a2a2a2a2";
const FONT_B = "custom-bbbbbbbb";
const GONE = "custom-deadbeef";
const sha = (c: string) => c.repeat(64);

const font = (fontId: string, ws: Seed, hex: string) => ({
  fontId,
  name: fontId,
  fileKey: `ws/${ws.workspaceId}/fonts/${fontId}`,
  sha256: sha(hex),
  bytes: 10,
  unitsPerEm: 1000,
  ascent: 900,
  descent: 200,
  metricsSource: "hhea",
  viComplete: true,
  missing: [],
});

const job = (ws: Seed, payload: Record<string, unknown>) =>
  ({ workspaceId: ws.workspaceId, payload }) as unknown as Job;

const exportJob = (ws: Seed) =>
  job(ws, {
    type: "chapter.export",
    chapter_id: ws.chapterId,
    format: "cbz",
    layout: "pages",
    quality: 90,
    include_untranslated: true,
  });

const settings = (font: string, narration?: string) => ({
  glossary: {},
  pronoun_rules: "",
  honorific_policy: "",
  style_prompt: "",
  font,
  narration_font: narration,
});

const translateJob = (ws: Seed, pageIds: string[], s: ReturnType<typeof settings>) =>
  job(ws, {
    type: "chapter.translate",
    chapter_id: ws.chapterId,
    page_ids: pageIds,
    context: "rolling",
    glossary_rev: 0,
    settings_rev: 0,
    settings: s,
  });

async function seedPage(ws: Seed, boxFonts: string[], ready = true) {
  const sdb = scoped(db, ws.workspaceId);
  const id = pageId(ws.chapterId, 1, 0);
  await sdb.insert(pages, {
    id,
    chapterId: ws.chapterId,
    ord: 0,
    width: 400,
    height: 900,
    originalKey: storageKeys.ingestPage(ws.workspaceId, ws.chapterId, 1, 0),
    originalSha256: SHA,
    cleanRev: 1,
    status: ready ? "ready" : "failed",
    ocrResult: { regions: [], items: [] },
    sourceMap: [],
  });
  const state = {
    ...aiState(400, 900),
    text_boxes: boxFonts.map((font_family, i) => ({
      ...emptyPageState(400, 900).text_boxes[0],
      id: `b${i}`,
      region_id: null,
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      rotation: 0,
      text: "x",
      lines: ["x"],
      font_family,
      font_size: 20,
      line_height: 1.15,
      pad: 4,
      letter_spacing: 0,
      align: "center",
      fill: "#000000",
      stroke: null,
      auto_fit: false,
      hidden: false,
    })),
  };
  await sdb.insert(pageStates, { pageId: id, state: state as never });
  return id;
}

beforeAll(async () => {
  [A, B] = await Promise.all([seedWorkspace("cf-a"), seedWorkspace("cf-b")]);
  await scoped(db, A.workspaceId).insert(workspaceFonts, font(FONT_A, A, "a"));
  await scoped(db, A.workspaceId).insert(workspaceFonts, font(FONT_A2, A, "c"));
  await scoped(db, B.workspaceId).insert(workspaceFonts, font(FONT_B, B, "b"));
});

describe("translate inputs fonts", () => {
  it("lists the custom fonts of the job settings with signed urls, skipping bundled and unknown ids", async () => {
    const inputs = TranslateInputs.parse(
      await buildInputs(db, translateJob(A, [], settings(FONT_A, "Bangers-Regular"))),
    );
    expect(inputs.fonts).toHaveLength(1);
    expect(inputs.fonts?.[0]).toMatchObject({ id: FONT_A, sha256: sha("a") });
    expect(inputs.fonts?.[0]?.url).toContain(`ws/${A.workspaceId}/fonts/${FONT_A}`);
    expect(inputs.fonts?.[0]?.url).toContain("X-Amz-Signature");
  });

  it("covers dialogue and narration fonts, and omits other workspaces' and deleted fonts", async () => {
    const both = TranslateInputs.parse(await buildInputs(db, translateJob(A, [], settings(FONT_A, FONT_A2))));
    expect(both.fonts?.map((f) => f.id)).toEqual([FONT_A2, FONT_A]);
    const foreign = TranslateInputs.parse(await buildInputs(db, translateJob(A, [], settings(FONT_B, GONE))));
    expect(foreign.fonts).toEqual([]);
  });
});

describe("export inputs fonts", () => {
  it("lists fonts used by page boxes and series defaults, only of this workspace, without deleted ones", async () => {
    await seedPage(A, [FONT_A, "Bangers-Regular", GONE, FONT_B, FONT_A]);
    await db
      .update(series)
      .set({ defaultFonts: { dialogue: FONT_A2 } })
      .where(eq(series.id, A.seriesId));
    const inputs = ExportInputs.parse(await buildInputs(db, exportJob(A)));
    expect(inputs.fonts?.map((f) => [f.id, f.sha256])).toEqual([
      [FONT_A2, sha("c")],
      [FONT_A, sha("a")],
    ]);
  });

  it("is empty when nothing custom is used", async () => {
    await seedPage(B, ["Bangers-Regular"]);
    const inputs = ExportInputs.parse(await buildInputs(db, exportJob(B)));
    expect(inputs.fonts).toEqual([]);
  });
});
