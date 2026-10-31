/** Ẩn box khớp chữ bỏ qua trong chương đã dịch: preview, apply theo từng chương, hoàn tác theo batch_id. */
import { chapters, jobs, pageStateHistory, pageStates, pages, scoped, series } from "@mtl/db";
import { compileIgnoreList, emptyPageState, type PageState, pageId, type TextBox } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { hideIgnored } from "../src/routes/series-ignore-apply.ts";
import { call, db, seedUser } from "./helpers.ts";
import { SHA } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type Preview = {
  chapters: {
    chapter_id: string;
    number: string;
    boxes: number;
    pages: number;
    samples: string[];
    versions: Record<string, number>;
  }[];
  skipped: { chapter_id: string; reason: string; holder_name: string | null }[];
  total_boxes: number;
};
type Applied = {
  batch_id: string | null;
  boxes: number;
  chapters: { chapter_id: string; boxes: number; pages: number }[];
  skipped: { chapter_id: string; reason: string }[];
};
type Undone = {
  pages: number;
  chapters: { chapter_id: string; pages: number }[];
  skipped: { chapter_id: string; reason: string; pages: number }[];
};

const box = (id: string, regionId: string | null, text: string, hidden = false): TextBox => ({
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
  hidden,
});

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

/**
 * Watermark `wm` (2 box gắn vùng, 1 box đã ẩn sẵn) + thoại `r1` + box tự thêm chứa đúng chữ watermark nhưng không gắn
 * vùng nào.
 */
function state(n: number): PageState {
  return {
    ...emptyPageState(400, 600),
    regions: [region("wm", `Đọc tại DISCORD . GG/abc${n}`, "Đọc tại discord"), region("r1", "안녕", "Chào")],
    text_boxes: [
      box("wm1", "wm", "Đọc tại discord"),
      box("wm2", "wm", "discord.gg"),
      box("wmHidden", "wm", "đã ẩn", true),
      box("b1", "r1", "Chào"),
      box("free", null, "discord.gg"),
    ],
  };
}

let A: Seed;
let seriesId = "";
const OTHER_USER = "0190a000-0000-7000-8000-0000000000aa";
const sdb = () => scoped(db, A.userId);

async function newSeries(ignore: string[]) {
  const s = await sdb().insert(series, { title: "Ẩn chữ", ignoreText: ignore });
  return s.id;
}

async function newChapter(sid: string, number: string, nPages: number) {
  const ch = await sdb().insert(chapters, { seriesId: sid, number });
  const ids: string[] = [];
  for (let i = 0; i < nPages; i++) {
    const id = pageId(ch.id, 1, i);
    await sdb().insert(pages, {
      id,
      chapterId: ch.id,
      ord: i,
      width: 400,
      height: 600,
      originalKey: `u/${A.userId}/ch/${ch.id}/ingest/1/${i}.png`,
      originalSha256: SHA,
      status: "ready",
    });
    await sdb().insert(pageStates, { pageId: id, state: state(i), version: 3 });
    ids.push(id);
  }
  return { id: ch.id, pageIds: ids };
}

const api = (path: string, body: unknown, sid = seriesId) =>
  call(`/api/series/${sid}/ignore-apply${path}`, { method: "POST", cookie: A.cookie, body });
const stateOf = async (id: string) => {
  const [row] = await sdb().select(pageStates, eq(pageStates.pageId, id));
  if (!row?.state) throw new Error("no state");
  return { ...row, state: row.state };
};
const hiddenOf = async (id: string) => (await stateOf(id)).state.text_boxes.filter((b) => b.hidden).map((b) => b.id);
const mergedVersions = (pv: Preview) => Object.assign({}, ...pv.chapters.map((c) => c.versions));

beforeAll(async () => {
  A = await seedUser("ignore-apply");
});

describe("hideIgnored", () => {
  it("hides only visible boxes linked to a matching region, keeping text and translation", () => {
    const st = state(0);
    const r = hideIgnored(st, compileIgnoreList(["discord.gg"]));
    expect(r.matches.map((m) => m.id)).toEqual(["wm1", "wm2"]);
    expect(r.state.text_boxes.map((b) => [b.id, b.hidden])).toEqual([
      ["wm1", true],
      ["wm2", true],
      ["wmHidden", true],
      ["b1", false],
      ["free", false],
    ]);
    expect(r.state.text_boxes[0]?.text).toBe("Đọc tại discord");
    expect(r.state.regions).toEqual(st.regions);
    expect(st.text_boxes[0]?.hidden).toBe(false);
  });

  it("returns the same state when nothing matches", () => {
    const st = state(0);
    expect(hideIgnored(st, compileIgnoreList(["asura"])).state).toBe(st);
  });
});

describe("ignore list validation on the series form route", () => {
  it("rejects a broken or nested-quantifier regex with a reason, accepts a valid one", async () => {
    const patch = (ignore_text: string[]) =>
      call(`/api/series/${A.seriesId}`, {
        method: "PATCH",
        cookie: A.cookie,
        body: { ignore_text },
      });
    const bad = await patch(["/(a+)+/"]);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toContain("lồng nhau");
    expect((await patch(["/(ab/"])).status).toBe(400);
    const ok = await patch(["/discord\\s*\\.\\s*gg/", "asura scans"]);
    expect(ok.status).toBe(200);
  });
});

describe("preview → apply → undo", () => {
  let c1: Awaited<ReturnType<typeof newChapter>>;
  let c2: Awaited<ReturnType<typeof newChapter>>;
  let c3: Awaited<ReturnType<typeof newChapter>>;
  let preview: Preview;
  let batchId = "";

  beforeAll(async () => {
    seriesId = await newSeries(["discord.gg"]);
    c1 = await newChapter(seriesId, "1", 2);
    c2 = await newChapter(seriesId, "2", 1);
    c3 = await newChapter(seriesId, "3", 1);
    // chương 3: không còn box nào để ẩn
    await sdb().update(pageStates, eq(pageStates.pageId, c3.pageIds[0] as string), {
      state: { ...state(0), regions: [region("r1", "안녕", "Chào")], text_boxes: [box("b1", "r1", "Chào")] },
    });
  });

  it("preview counts boxes per chapter with samples and versions, without writing", async () => {
    const res = await api("/preview", {});
    expect(res.status, await res.clone().text()).toBe(200);
    preview = (await res.json()) as Preview;
    expect(preview.total_boxes).toBe(6);
    expect(preview.skipped).toEqual([]);
    expect(preview.chapters.map((c) => [c.number, c.boxes, c.pages])).toEqual([
      ["1", 4, 2],
      ["2", 2, 1],
    ]);
    expect(preview.chapters[0]?.samples).toEqual(["Đọc tại DISCORD . GG/abc0", "Đọc tại DISCORD . GG/abc1"]);
    expect(Object.keys(mergedVersions(preview)).sort()).toEqual([...c1.pageIds, ...c2.pageIds].sort());
    expect((await stateOf(c1.pageIds[0] as string)).version).toBe(3);
  });

  it("apply hides the right boxes in every chapter under one batch (history, version + 1, origin user)", async () => {
    const res = await api("/apply", { versions: mergedVersions(preview) });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Applied;
    expect(body).toMatchObject({ boxes: 6, skipped: [] });
    expect(body.chapters.map((c) => [c.boxes, c.pages])).toEqual([
      [4, 2],
      [2, 1],
    ]);
    batchId = body.batch_id as string;
    for (const id of [...c1.pageIds, ...c2.pageIds]) {
      const st = await stateOf(id);
      expect(st.version).toBe(4);
      expect(st.stateOrigin).toBe("user");
      expect(st.state.text_boxes.filter((b) => b.hidden).map((b) => b.id)).toEqual(["wm1", "wm2", "wmHidden"]);
      expect(st.state.text_boxes.find((b) => b.id === "free")?.hidden).toBe(false);
      expect(st.state.text_boxes.find((b) => b.id === "b1")?.hidden).toBe(false);
      expect(st.state.regions.map((r) => r.translation)).toEqual(["Đọc tại discord", "Chào"]);
    }
    expect(await hiddenOf(c3.pageIds[0] as string)).toEqual([]);
    const hist = await sdb().select(pageStateHistory, eq(pageStateHistory.batchId, batchId));
    expect(hist).toHaveLength(3);
    expect(hist.every((h) => h.version === 3)).toBe(true);
  });

  it("previewing again finds nothing left to hide", async () => {
    const pv = (await (await api("/preview", {})).json()) as Preview;
    expect(pv).toMatchObject({ chapters: [], total_boxes: 0 });
  });

  it("undo restores every page and the lock is not left behind", async () => {
    const res = await api("/undo", { batch_id: batchId });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()) as Undone).toMatchObject({ pages: 3, skipped: [] });
    for (const id of [...c1.pageIds, ...c2.pageIds]) {
      const st = await stateOf(id);
      expect(st.version).toBe(5);
      expect(st.state.text_boxes.filter((b) => b.hidden).map((b) => b.id)).toEqual(["wmHidden"]);
    }
    const [ch] = await sdb().select(chapters, eq(chapters.id, c1.id));
    expect(ch?.lockedBy).toBeNull();
  });

  it("undo skips and reports pages edited after the batch; the rest is restored", async () => {
    const pv = (await (await api("/preview", {})).json()) as Preview;
    const applied = (await (await api("/apply", { versions: mergedVersions(pv) })).json()) as Applied;
    const edited = await stateOf(c1.pageIds[0] as string);
    // Sửa thật nội dung (lưu lại y nguyên không tính là sửa: undo so theo nội dung).
    const changed = structuredClone(edited.state);
    const box = changed.text_boxes[0];
    if (box) box.x += 5;
    const lock = (method: string) => call(`/api/chapters/${c1.id}/lock`, { method, cookie: A.cookie });
    expect((await lock("POST")).status).toBe(200);
    const put = await call(`/api/pages/${c1.pageIds[0]}/state`, {
      method: "PUT",
      cookie: A.cookie,
      body: { state: changed },
      headers: { "if-match": String(edited.version) },
    });
    expect(put.status).toBe(200);
    expect((await lock("DELETE")).status).toBe(204);
    const res = await api("/undo", { batch_id: applied.batch_id });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Undone;
    expect(body.pages).toBe(2);
    expect(body.skipped).toEqual([{ chapter_id: c1.id, number: "1", title: "", reason: "changed", pages: 1 }]);
    expect(await hiddenOf(c1.pageIds[0] as string)).toEqual(["wm1", "wm2", "wmHidden"]);
    expect(await hiddenOf(c1.pageIds[1] as string)).toEqual(["wmHidden"]);
    expect(await hiddenOf(c2.pageIds[0] as string)).toEqual(["wmHidden"]);
  });

  it("undo of an unknown batch → 410", async () => {
    expect((await api("/undo", { batch_id: "0190a000-0000-7000-8000-00000000dead" })).status).toBe(410);
  });
});

describe("chapters that cannot be touched", () => {
  it("lists a chapter locked by someone else or running a job as skipped, in preview and apply", async () => {
    const sid = await newSeries(["/discord\\s*\\.\\s*gg/"]);
    const free = await newChapter(sid, "1", 1);
    const locked = await newChapter(sid, "2", 1);
    const busy = await newChapter(sid, "3", 1);
    await sdb().update(chapters, eq(chapters.id, locked.id), { lockedBy: OTHER_USER, lockedAt: new Date() });
    await sdb().insert(jobs, {
      type: "chapter.translate",
      payload: { type: "chapter.translate", chapter_id: busy.id, page_ids: busy.pageIds, context: "none" },
      inputRev: "r",
      idempotencyKey: `ignore-apply-${busy.id}`,
      chapterId: busy.id,
    } as never);

    const pv = (await (await api("/preview", {}, sid)).json()) as Preview;
    expect(pv.chapters.map((c) => c.chapter_id)).toEqual([free.id]);
    expect(pv.skipped.map((s) => [s.chapter_id, s.reason])).toEqual([
      [locked.id, "locked"],
      [busy.id, "busy"],
    ]);

    const res = await api("/apply", { versions: mergedVersions(pv) }, sid);
    const body = (await res.json()) as Applied;
    expect(body.chapters.map((c) => c.chapter_id)).toEqual([free.id]);
    expect(body.skipped.map((s) => [s.chapter_id, s.reason])).toEqual([
      [locked.id, "locked"],
      [busy.id, "busy"],
    ]);
    expect(await hiddenOf(free.pageIds[0] as string)).toEqual(["wm1", "wm2", "wmHidden"]);
    expect(await hiddenOf(locked.pageIds[0] as string)).toEqual(["wmHidden"]);
    expect(await hiddenOf(busy.pageIds[0] as string)).toEqual(["wmHidden"]);
    // chương bị người khác khoá vẫn giữ nguyên khoá của họ
    const [ch] = await sdb().select(chapters, eq(chapters.id, locked.id));
    expect(ch?.lockedBy).toBe(OTHER_USER);
  });

  it("a chapter whose page changed after the preview is skipped as changed; others are applied", async () => {
    const sid = await newSeries(["discord.gg"]);
    const a = await newChapter(sid, "1", 1);
    const b = await newChapter(sid, "2", 1);
    const pv = (await (await api("/preview", {}, sid)).json()) as Preview;
    await sdb().update(pageStates, eq(pageStates.pageId, a.pageIds[0] as string), { version: 4 });
    const body = (await (await api("/apply", { versions: mergedVersions(pv) }, sid)).json()) as Applied;
    expect(body.chapters.map((c) => c.chapter_id)).toEqual([b.id]);
    expect(body.skipped.map((s) => [s.chapter_id, s.reason])).toEqual([[a.id, "changed"]]);
    expect(await hiddenOf(a.pageIds[0] as string)).toEqual(["wmHidden"]);
  });

  it("never writes a chapter or page that was not part of the preview, even if it matches by apply time", async () => {
    const sid = await newSeries(["discord.gg"]);
    const a = await newChapter(sid, "1", 2);
    const b = await newChapter(sid, "2", 1);
    const clean = { ...state(0), regions: [region("r1", "안녕", "Chào")], text_boxes: [box("b1", "r1", "Chào")] };
    await sdb().update(pageStates, eq(pageStates.pageId, b.pageIds[0] as string), { state: clean });
    const pv = (await (await api("/preview", {}, sid)).json()) as Preview;
    expect(pv.chapters.map((c) => c.chapter_id)).toEqual([a.id]);
    // Sau preview: chương b có chữ khớp mới; trang 2 của chương a bị bỏ khỏi `versions`.
    await sdb().update(pageStates, eq(pageStates.pageId, b.pageIds[0] as string), { state: state(0) });
    const versions = mergedVersions(pv);
    delete versions[a.pageIds[1] as string];
    const before = await stateOf(b.pageIds[0] as string);
    const body = (await (await api("/apply", { versions }, sid)).json()) as Applied;
    expect(body).toMatchObject({ batch_id: null, boxes: 0, chapters: [] });
    expect(body.skipped.map((x) => [x.chapter_id, x.reason])).toEqual([[a.id, "changed"]]);
    expect(await hiddenOf(b.pageIds[0] as string)).toEqual(["wmHidden"]);
    expect((await stateOf(b.pageIds[0] as string)).version).toBe(before.version);
    expect(await hiddenOf(a.pageIds[0] as string)).toEqual(["wmHidden"]);
    expect(await hiddenOf(a.pageIds[1] as string)).toEqual(["wmHidden"]);
  });

  it("undo skips a chapter that someone else is editing", async () => {
    const sid = await newSeries(["discord.gg"]);
    const ch = await newChapter(sid, "1", 1);
    const pv = (await (await api("/preview", {}, sid)).json()) as Preview;
    const applied = (await (await api("/apply", { versions: mergedVersions(pv) }, sid)).json()) as Applied;
    await sdb().update(chapters, eq(chapters.id, ch.id), { lockedBy: OTHER_USER, lockedAt: new Date() });
    const body = (await (await api("/undo", { batch_id: applied.batch_id }, sid)).json()) as Undone;
    expect(body).toMatchObject({ pages: 0, chapters: [] });
    expect(body.skipped.map((x) => [x.chapter_id, x.reason, x.pages])).toEqual([[ch.id, "locked", 1]]);
    expect(await hiddenOf(ch.pageIds[0] as string)).toEqual(["wm1", "wm2", "wmHidden"]);
  });

  it("undo skips a chapter that has a running job", async () => {
    const sid = await newSeries(["discord.gg"]);
    const ch = await newChapter(sid, "1", 1);
    const pv = (await (await api("/preview", {}, sid)).json()) as Preview;
    const applied = (await (await api("/apply", { versions: mergedVersions(pv) }, sid)).json()) as Applied;
    await sdb().insert(jobs, {
      type: "chapter.translate",
      payload: { type: "chapter.translate", chapter_id: ch.id, page_ids: ch.pageIds, context: "none" },
      inputRev: "r",
      idempotencyKey: `ignore-undo-${ch.id}`,
      chapterId: ch.id,
    } as never);
    const body = (await (await api("/undo", { batch_id: applied.batch_id }, sid)).json()) as Undone;
    expect(body).toMatchObject({ pages: 0, chapters: [] });
    expect(body.skipped.map((x) => [x.chapter_id, x.reason, x.pages])).toEqual([[ch.id, "busy", 1]]);
    expect(await hiddenOf(ch.pageIds[0] as string)).toEqual(["wm1", "wm2", "wmHidden"]);
  });

  it("undo rejects a batch that was not created by ignore-apply", async () => {
    const sid = await newSeries(["discord.gg"]);
    const ch = await newChapter(sid, "1", 1);
    const foreign = "0190a000-0000-7000-8000-00000000beef";
    const before = await stateOf(ch.pageIds[0] as string);
    await sdb().insert(pageStateHistory, {
      pageId: ch.pageIds[0] as string,
      version: before.version - 1,
      state: before.state,
      actor: "user:someone",
      batchId: foreign,
    });
    expect((await api("/undo", { batch_id: foreign }, sid)).status).toBe(410);
    expect((await stateOf(ch.pageIds[0] as string)).version).toBe(before.version);
  });

  it("apply leaves the editor's own lock in place", async () => {
    const sid = await newSeries(["discord.gg"]);
    const ch = await newChapter(sid, "1", 1);
    const pv = (await (await api("/preview", {}, sid)).json()) as Preview;
    await call(`/api/chapters/${ch.id}/lock`, { method: "POST", cookie: A.cookie });
    const body = (await (await api("/apply", { versions: mergedVersions(pv) }, sid)).json()) as Applied;
    expect(body.chapters.map((x) => x.chapter_id)).toEqual([ch.id]);
    const [row] = await sdb().select(chapters, eq(chapters.id, ch.id));
    expect(row?.lockedBy).not.toBeNull();
  });

  it("an empty ignore list previews nothing and apply writes nothing", async () => {
    const sid = await newSeries([]);
    const ch = await newChapter(sid, "1", 1);
    expect(await (await api("/preview", {}, sid)).json()).toMatchObject({ chapters: [], skipped: [], total_boxes: 0 });
    expect(await (await api("/apply", { versions: {} }, sid)).json()).toMatchObject({ batch_id: null, boxes: 0 });
    expect((await stateOf(ch.pageIds[0] as string)).version).toBe(3);
  });

  it("validates bodies", async () => {
    expect((await api("/apply", {})).status).toBe(400);
    expect((await api("/undo", { batch_id: "nope" })).status).toBe(400);
  });
});
