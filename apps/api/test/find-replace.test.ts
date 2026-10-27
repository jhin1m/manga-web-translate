/** Find/replace + áp glossary trong chương: preview bắt buộc, khoá chương, 1 transaction theo batch_id, hoàn tác. */
import { chapters, glossaryEntries, pageStateHistory, pageStates, pages, scoped } from "@mtl/db";
import { emptyPageState, type PageState, pageId, type TextBox } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { applyRules, replaceLiteral } from "../src/routes/find-replace.ts";
import { call, db, seedUser } from "./helpers.ts";
import { SHA } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type Preview = {
  matches: { page_id: string; ord: number; target: string; id: string; before: string; after: string }[];
  total: number;
  versions: Record<string, number>;
};

const box = (id: string, regionId: string | null, text: string): TextBox => ({
  id,
  region_id: regionId,
  x: 10,
  y: 10,
  w: 200,
  h: 80,
  rotation: 0,
  text,
  lines: [text],
  font_family: "PatrickHand-Regular",
  font_size: 20,
  line_height: 1.15,
  pad: 4,
  letter_spacing: 0,
  align: "center",
  fill: "#000000",
  stroke: null,
  auto_fit: true,
  hidden: false,
});

/** Page có 2 vùng: r0 (nguồn chứa 검) + box gắn r0, r1 (nguồn khác) + box gắn r1. */
function state(t0: string, t1: string): PageState {
  const region = (id: string, source: string, translation: string) => ({
    id,
    kind: "text_bubble" as const,
    bbox: [0, 0, 10, 10] as [number, number, number, number],
    polarity: "dark_on_light" as const,
    source_text: source,
    translation,
    confidence: 0.9,
    flags: [],
  });
  return {
    ...emptyPageState(400, 600),
    regions: [region("r0", "검을 들어라", t0), region("r1", "안녕", t1)],
    text_boxes: [box("b0", "r0", t0), box("b1", "r1", t1)],
  };
}

let A: Seed;
let chapterId = "";
const pageIds: string[] = [];

async function newChapter(n: number, make: (i: number) => PageState) {
  const sdb = scoped(db, A.userId);
  const ch = await sdb.insert(chapters, { seriesId: A.seriesId, number: String(10 + pageIds.length) });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = pageId(ch.id, 1, i);
    await sdb.insert(pages, {
      id,
      chapterId: ch.id,
      ord: i,
      width: 400,
      height: 600,
      originalKey: `u/${A.userId}/ch/${ch.id}/ingest/1/${i}.png`,
      originalSha256: SHA,
      status: "ready",
    });
    await sdb.insert(pageStates, { pageId: id, state: make(i), version: 3 });
    ids.push(id);
  }
  return { chapterId: ch.id, ids };
}

const api = (path: string, body: unknown, ch = chapterId) =>
  call(`/api/chapters/${ch}${path}`, { method: "POST", cookie: A.cookie, body });
const lock = (ch = chapterId) => call(`/api/chapters/${ch}/lock`, { method: "POST", cookie: A.cookie });
const unlock = (ch = chapterId) => call(`/api/chapters/${ch}/lock`, { method: "DELETE", cookie: A.cookie });
const stateOf = async (id: string) => {
  const [row] = await scoped(db, A.userId).select(pageStates, eq(pageStates.pageId, id));
  if (!row?.state) throw new Error("no state");
  return { ...row, state: row.state };
};

beforeAll(async () => {
  A = await seedUser("fr");
  const c = await newChapter(3, (i) => state(`Rút Kiếm ra! ${i}`, i === 2 ? "kiếm khác" : "Chào"));
  chapterId = c.chapterId;
  pageIds.push(...c.ids);
});

describe("pure replace", () => {
  it("literal, case-insensitive on Vietnamese, no regex/$ interpretation", () => {
    expect(replaceLiteral("Kiếm và KIẾM, kiếm", "kiếm", "đao", false)).toEqual(["đao và đao, đao", 3]);
    expect(replaceLiteral("Kiếm và KIẾM", "kiếm", "đao", true)).toEqual(["Kiếm và KIẾM", 0]);
    expect(replaceLiteral("a.b a+b (x)", "a.b", "$&$1", false)).toEqual(["$&$1 a+b (x)", 1]);
    expect(replaceLiteral("(x) [y]", "(x)", "z", true)).toEqual(["z [y]", 1]);
    // thay "a" bằng "e" + dấu mũ rời (U+0302) → kết quả phải NFC ("ê")
    expect(replaceLiteral("ae", "a", "e\u0302", true)[0]).toBe("êe");
  });

  it("scoped rule only touches regions whose source contains the term (and their boxes); changed boxes lose lines", () => {
    const r = applyRules(state("kiếm", "kiếm"), [
      { find: "kiếm", replace: "đao", caseSensitive: false, scope: { sourceTerm: "검", caseSensitive: false } },
    ]);
    expect(r.state.regions.map((x) => x.translation)).toEqual(["đao", "kiếm"]);
    expect(r.state.text_boxes.map((b) => [b.text, b.lines])).toEqual([
      ["đao", []],
      ["kiếm", ["kiếm"]],
    ]);
    expect(r.matches.map((m) => `${m.target}:${m.id}`)).toEqual(["region:r0", "box:b0"]);
  });
});

describe("find/replace", () => {
  let preview: Preview;
  let batchId = "";

  it("preview lists matches (page, box/region, before/after) without writing or needing the lock", async () => {
    const res = await api("/find-replace/preview", { find: "kiếm", replace: "đao", case_sensitive: false });
    expect(res.status).toBe(200);
    preview = (await res.json()) as Preview;
    // trang 0,1: r0 + b0; trang 2: r0, r1, b0, b1
    expect(preview.matches).toHaveLength(8);
    expect(preview.total).toBe(8);
    expect(Object.keys(preview.versions).sort()).toEqual([...pageIds].sort());
    expect(preview.matches[0]).toMatchObject({ ord: 0, before: "Rút Kiếm ra! 0", after: "Rút đao ra! 0" });
    expect((await stateOf(pageIds[0] as string)).version).toBe(3);
  });

  it("apply without the chapter lock → 423", async () => {
    const res = await api("/find-replace/apply", {
      find: "kiếm",
      replace: "đao",
      case_sensitive: false,
      versions: preview.versions,
    });
    expect(res.status).toBe(423);
  });

  it("apply with stale versions → 409 preview_stale, nothing written", async () => {
    expect((await lock()).status).toBe(200);
    const versions = { ...preview.versions, [pageIds[1] as string]: 2 };
    const res = await api("/find-replace/apply", { find: "kiếm", replace: "đao", case_sensitive: false, versions });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "preview_stale", pages: [pageIds[1]] });
    expect((await stateOf(pageIds[0] as string)).state.regions[0]?.translation).toBe("Rút Kiếm ra! 0");
  });

  it("apply writes every page in one batch (history + version + 1, state_origin user)", async () => {
    const res = await api("/find-replace/apply", {
      find: "kiếm",
      replace: "đao",
      case_sensitive: false,
      versions: preview.versions,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { batch_id: string; pages: number; replaced: number };
    expect(body).toMatchObject({ pages: 3, replaced: 8 });
    batchId = body.batch_id;
    const p2 = await stateOf(pageIds[2] as string);
    expect(p2.version).toBe(4);
    expect(p2.stateOrigin).toBe("user");
    expect(p2.state.regions.map((r) => r.translation)).toEqual(["Rút đao ra! 2", "đao khác"]);
    expect(p2.state.text_boxes.every((b) => b.lines.length === 0)).toBe(true);
    const hist = await scoped(db, A.userId).select(pageStateHistory, eq(pageStateHistory.batchId, batchId));
    expect(hist.map((h) => h.version)).toEqual([3, 3, 3]);
  });

  it("undo restores the batch; undoing again (or after a later edit) → 409", async () => {
    const res = await api("/find-replace/undo", { batch_id: batchId });
    expect(res.status, await res.clone().text()).toBe(200);
    const p0 = await stateOf(pageIds[0] as string);
    expect(p0.version).toBe(5);
    expect(p0.state.text_boxes[0]?.text).toBe("Rút Kiếm ra! 0");
    expect(p0.state.text_boxes[0]?.lines).toEqual(["Rút Kiếm ra! 0"]);
    const again = await api("/find-replace/undo", { batch_id: batchId });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("undo_conflict");
    expect((await api("/find-replace/undo", { batch_id: "0190a000-0000-7000-8000-00000000dead" })).status).toBe(404);
  });

  it("undo is refused when one page was edited after the batch", async () => {
    const pv = (await (
      await api("/find-replace/preview", { find: "Chào", replace: "Xin chào", case_sensitive: true })
    ).json()) as Preview;
    const applied = (await (
      await api("/find-replace/apply", {
        find: "Chào",
        replace: "Xin chào",
        case_sensitive: true,
        versions: pv.versions,
      })
    ).json()) as { batch_id: string };
    const edited = await stateOf(pageIds[0] as string);
    const put = await call(`/api/pages/${pageIds[0]}/state`, {
      method: "PUT",
      cookie: A.cookie,
      body: { state: edited.state },
      headers: { "if-match": String(edited.version) },
    });
    expect(put.status).toBe(200);
    const res = await api("/find-replace/undo", { batch_id: applied.batch_id });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "undo_conflict", pages: [pageIds[0]] });
    expect((await stateOf(pageIds[1] as string)).state.text_boxes[1]?.text).toBe("Xin chào");
  });

  it("validates body (empty find)", async () => {
    expect((await api("/find-replace/preview", { find: "  ", replace: "x" })).status).toBe(400);
  });
});

describe("apply glossary", () => {
  it("uses the merged glossary (series overrides shared), scoped to regions whose source has the term", async () => {
    const sdb = scoped(db, A.userId);
    await sdb.insert(glossaryEntries, {
      seriesId: null,
      sourceLang: "ko",
      targetLang: "vi",
      sourceTerm: "검",
      targetTerm: "gươm",
    });
    await sdb.insert(glossaryEntries, { seriesId: A.seriesId, sourceTerm: "검", targetTerm: "thanh kiếm" });
    const c = await newChapter(2, () => state("Rút Kiếm ra!", "kiếm khác"));
    const pv = await api("/glossary-apply/preview", { rules: [{ source_term: "검", from: "Kiếm" }] }, c.chapterId);
    expect(pv.status, await pv.clone().text()).toBe(200);
    const body = (await pv.json()) as Preview;
    // chỉ r0/b0 (nguồn chứa 검), không đụng r1 "kiếm khác"
    expect(body.matches.map((m) => `${m.ord}:${m.target}:${m.id}`)).toEqual([
      "0:region:r0",
      "0:box:b0",
      "1:region:r0",
      "1:box:b0",
    ]);
    expect(body.matches[0]?.after).toBe("Rút thanh kiếm ra!");
    expect((await lock(c.chapterId)).status).toBe(200);
    const res = await api(
      "/glossary-apply/apply",
      { rules: [{ source_term: "검", from: "Kiếm" }], versions: body.versions },
      c.chapterId,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const s = await stateOf(c.ids[1] as string);
    expect(s.state.regions.map((r) => r.translation)).toEqual(["Rút thanh kiếm ra!", "kiếm khác"]);
    await unlock(c.chapterId);
  });

  it("skips hidden pages in preview and apply", async () => {
    const c = await newChapter(2, () => state("Rút Kiếm ra!", "Chào"));
    const hidden = c.ids[1] as string;
    await scoped(db, A.userId).update(pages, eq(pages.id, hidden), { skipped: true });
    const rules = [{ source_term: "검", from: "Kiếm" }];
    const pv = await api("/glossary-apply/preview", { rules }, c.chapterId);
    expect(pv.status, await pv.clone().text()).toBe(200);
    const body = (await pv.json()) as Preview;
    expect(new Set(body.matches.map((m) => m.page_id))).toEqual(new Set([c.ids[0]]));
    expect(Object.keys(body.versions)).toEqual([c.ids[0]]);
    expect((await lock(c.chapterId)).status).toBe(200);
    const res = await api("/glossary-apply/apply", { rules, versions: body.versions }, c.chapterId);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await stateOf(hidden)).state.regions[0]?.translation).toBe("Rút Kiếm ra!");
    await unlock(c.chapterId);
  });

  it("shared entries of another language pair are not part of the series glossary → 400 unknown_terms", async () => {
    await scoped(db, A.userId).insert(glossaryEntries, {
      sourceLang: "ko",
      targetLang: "en",
      sourceTerm: "회장",
      targetTerm: "chairman",
    });
    const res = await api("/glossary-apply/preview", { rules: [{ source_term: "회장", from: "x" }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_terms", terms: ["회장"] });
  });

  it("unknown glossary term → 400", async () => {
    const res = await api("/glossary-apply/preview", { rules: [{ source_term: "없음", from: "x" }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_terms", terms: ["없음"] });
  });
});

describe("performance", () => {
  it("apply 1 term on a 50-page chapter < 2s", async () => {
    const c = await newChapter(50, (i) => state(`Kiếm số ${i}`, "Chào"));
    const pv = (await (
      await api("/find-replace/preview", { find: "Kiếm", replace: "Đao", case_sensitive: true }, c.chapterId)
    ).json()) as Preview;
    expect(Object.keys(pv.versions)).toHaveLength(50);
    expect((await lock(c.chapterId)).status).toBe(200);
    const t0 = performance.now();
    const res = await api(
      "/find-replace/apply",
      { find: "Kiếm", replace: "Đao", case_sensitive: true, versions: pv.versions },
      c.chapterId,
    );
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(2000);
    await unlock(c.chapterId);
  });
});
