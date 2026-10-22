/** Glossary workspace/series: CRUD, glossary_rev cùng transaction, ghi đè theo series, import/export CSV. */
import { chapters, glossaryEntries, scoped, series } from "@mtl/db";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inJobTx, translateSettings } from "../src/jobs/enqueue.ts";
import { parseCsvRows, parseGlossaryCsv, toCsv } from "../src/routes/glossary.ts";
import { call, db, seedWorkspace } from "./helpers.ts";

type Entry = {
  id: string;
  series_id: string | null;
  source_lang: string | null;
  target_lang: string | null;
  source_term: string;
  target_term: string;
  note: string;
};
type Listed = { entries: Entry[]; inherited: Entry[] };

/** Query cặp ngôn ngữ bắt buộc của route glossary chung. */
const KO_VI = "?source_lang=ko&target_lang=vi";
const KO_EN = "?source_lang=ko&target_lang=en";

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function setup() {
  const A = await seedWorkspace("glo");
  const sdb = scoped(db, A.workspaceId);
  const other = await sdb.insert(series, { title: "Other" });
  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    call(`/api/w/${A.workspaceId}${path}`, { cookie: A.cookie, ...init });
  const revs = async () => {
    const rows = await sdb.select(series);
    return Object.fromEntries(rows.map((r) => [r.id, r.glossaryRev]));
  };
  return { A, sdb, other, api, revs };
}

describe("glossary CRUD + revs", () => {
  it("series entry bumps only that series; workspace entry bumps every series", async () => {
    const { A, other, api, revs } = await setup();
    const r0 = await revs();
    const se = await json<Entry>(
      await api(`/series/${A.seriesId}/glossary`, { method: "POST", body: { source_term: "검", target_term: "kiếm" } }),
      201,
    );
    expect(se.series_id).toBe(A.seriesId);
    let r = await revs();
    expect(r[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 1);
    expect(r[other.id]).toBe(r0[other.id]);

    const we = await json<Entry>(
      await api(`/glossary${KO_VI}`, { method: "POST", body: { source_term: "검", target_term: "gươm" } }),
      201,
    );
    expect(we.series_id).toBeNull();
    r = await revs();
    expect(r[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 2);
    expect(r[other.id]).toBe((r0[other.id] ?? 0) + 1);

    // Trùng source_term cùng cấp → 409; khác cấp được.
    expect(
      (await api(`/glossary${KO_VI}`, { method: "POST", body: { source_term: "검", target_term: "x" } })).status,
    ).toBe(409);

    // Series ghi đè workspace khi dựng snapshot cho job.
    const sA = await scoped(db, A.workspaceId).byId(series, A.seriesId);
    const settings = await inJobTx((tx) => translateSettings(tx, sA));
    expect(settings.glossary).toMatchObject({ 검: "kiếm" });

    const listed = await json<{ entries: Entry[]; inherited: Entry[] }>(
      await api(`/series/${A.seriesId}/glossary`),
      200,
    );
    expect(listed.entries.map((e) => e.target_term)).toEqual(["kiếm"]);
    expect(listed.inherited.map((e) => e.target_term)).toEqual(["gươm"]);

    const patched = await json<Entry>(
      await api(`/glossary/${se.id}`, { method: "PATCH", body: { target_term: "thanh kiếm" } }),
      200,
    );
    expect(patched.target_term).toBe("thanh kiếm");
    expect((await revs())[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 3);

    expect((await api(`/glossary/${we.id}`, { method: "DELETE" })).status).toBe(204);
    r = await revs();
    expect(r[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 4);
    expect(r[other.id]).toBe((r0[other.id] ?? 0) + 2);
    expect((await api(`/glossary/${we.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("validates bodies", async () => {
    const { api } = await setup();
    const error = async (res: Response) => (await json<{ error: string }>(res, 400)).error;
    expect(
      await error(await api(`/glossary${KO_VI}`, { method: "POST", body: { source_term: "", target_term: "x" } })),
    ).toBe("invalid_body");
    expect(await error(await api(`/glossary${KO_VI}`, { method: "POST", body: { source_term: "a" } }))).toBe(
      "invalid_body",
    );
  });

  it("chapter of the series is unaffected by glossary writes (no chapter rows touched)", async () => {
    const { A, sdb, api } = await setup();
    const before = await sdb.byId(chapters, A.chapterId);
    await api(`/glossary${KO_VI}`, { method: "POST", body: { source_term: "용", target_term: "rồng" } });
    expect((await sdb.byId(chapters, A.chapterId)).updatedAt).toEqual(before.updatedAt);
  });
});

describe("unique term per scope (DB constraint)", () => {
  it("concurrent creates of the same term → exactly one row, the loser gets 409 duplicate_term", async () => {
    const { sdb, api } = await setup();
    const body = { source_term: "동시", target_term: "đồng thời" };
    const res = await Promise.all(Array.from({ length: 6 }, () => api(`/glossary${KO_VI}`, { method: "POST", body })));
    const codes = res.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c !== 201).every((c) => c === 409)).toBe(true);
    for (const r of res.filter((r) => r.status === 409)) {
      expect(((await r.json()) as { error: string }).error).toBe("duplicate_term");
    }
    const rows = await sdb.select(
      glossaryEntries,
      and(isNull(glossaryEntries.seriesId), eq(glossaryEntries.sourceTerm, "동시")),
    );
    expect(rows).toHaveLength(1);
  });

  it("same term is allowed once per scope (workspace and each series)", async () => {
    const { A, other, api } = await setup();
    const body = { source_term: "범위", target_term: "phạm vi" };
    expect((await api(`/glossary${KO_VI}`, { method: "POST", body })).status).toBe(201);
    expect((await api(`/series/${A.seriesId}/glossary`, { method: "POST", body })).status).toBe(201);
    expect((await api(`/series/${other.id}/glossary`, { method: "POST", body })).status).toBe(201);
  });
});

describe("workspace glossary per language pair", () => {
  it("requires a valid pair in the query (400 invalid_query); outsiders still get 403 first", async () => {
    const { api } = await setup();
    const error = async (res: Response) => (await json<{ error: string }>(res, 400)).error;
    const body = { source_term: "검", target_term: "kiếm" };
    expect(await error(await api("/glossary"))).toBe("invalid_query");
    expect(await error(await api("/glossary?source_lang=ko"))).toBe("invalid_query");
    expect(await error(await api("/glossary?source_lang=vi&target_lang=ko"))).toBe("invalid_query");
    expect(await error(await api("/glossary", { method: "POST", body }))).toBe("invalid_query");
    expect(await error(await api("/glossary/csv"))).toBe("invalid_query");
    expect(
      await error(await api("/glossary/csv", { method: "POST", body: { csv: "source_term,target_term\na,b\n" } })),
    ).toBe("invalid_query");
    const B = await seedWorkspace("glo-out");
    const { A } = await setup();
    const res = await call(`/api/w/${A.workspaceId}/glossary${KO_VI}`, { cookie: B.cookie });
    expect(res.status).toBe(403);
  });

  it("same term in two pairs; duplicate within one pair → 409; series entries carry no pair", async () => {
    const { A, api } = await setup();
    const body = { source_term: "회장", target_term: "chủ tịch" };
    const vi = await json<Entry>(await api(`/glossary${KO_VI}`, { method: "POST", body }), 201);
    const en = await json<Entry>(
      await api(`/glossary${KO_EN}`, { method: "POST", body: { ...body, target_term: "chairman" } }),
      201,
    );
    expect([vi.source_lang, vi.target_lang, en.source_lang, en.target_lang]).toEqual(["ko", "vi", "ko", "en"]);
    const dup = await api(`/glossary${KO_EN}`, { method: "POST", body: { ...body, target_term: "president" } });
    expect((await json<{ error: string }>(dup, 409)).error).toBe("duplicate_term");
    // PATCH đổi term trùng trong cùng cặp → 409; cặp của entry giữ nguyên.
    await json(
      await api(`/glossary${KO_EN}`, { method: "POST", body: { source_term: "검", target_term: "sword" } }),
      201,
    );
    expect((await api(`/glossary/${en.id}`, { method: "PATCH", body: { source_term: "검" } })).status).toBe(409);
    const patched = await json<Entry>(await api(`/glossary/${en.id}`, { method: "PATCH", body: { note: "n" } }), 200);
    expect([patched.source_lang, patched.target_lang]).toEqual(["ko", "en"]);

    const se = await json<Entry>(await api(`/series/${A.seriesId}/glossary`, { method: "POST", body }), 201);
    expect([se.source_lang, se.target_lang]).toEqual([null, null]);

    const listVi = await json<Listed>(await api(`/glossary${KO_VI}`), 200);
    expect(listVi.entries.map((e) => e.target_term)).toEqual(["chủ tịch"]);
    expect(listVi.inherited).toEqual([]);
  });

  it("a series only inherits/translates with workspace entries of its own pair (series entry still wins)", async () => {
    const { A, sdb, api } = await setup();
    const koEn = await sdb.insert(series, { title: "KO→EN", sourceLang: "ko", targetLang: "en" });
    await json(
      await api(`/glossary${KO_VI}`, { method: "POST", body: { source_term: "회장", target_term: "chủ tịch" } }),
      201,
    );
    await json(
      await api(`/glossary${KO_EN}`, { method: "POST", body: { source_term: "회장", target_term: "chairman" } }),
      201,
    );
    await json(
      await api(`/glossary${KO_EN}`, { method: "POST", body: { source_term: "검", target_term: "sword" } }),
      201,
    );
    await json(
      await api(`/series/${koEn.id}/glossary`, { method: "POST", body: { source_term: "검", target_term: "blade" } }),
      201,
    );
    // Workspace khác có entry chung ko→en cùng term → không lọt sang (lọc kèm workspace_id).
    const B = await seedWorkspace("glo-b");
    await scoped(db, B.workspaceId).insert(glossaryEntries, {
      sourceLang: "ko",
      targetLang: "en",
      sourceTerm: "마왕",
      targetTerm: "demon king",
    });

    const settings = await inJobTx((tx) => translateSettings(tx, koEn));
    expect(settings.glossary).toEqual({ 회장: "chairman", 검: "blade" });
    const sA = await sdb.byId(series, A.seriesId);
    expect((await inJobTx((tx) => translateSettings(tx, sA))).glossary).toEqual({ 회장: "chủ tịch" });

    const listed = await json<Listed>(await api(`/series/${koEn.id}/glossary`), 200);
    expect(listed.inherited.map((e) => [e.source_term, e.target_term])).toEqual([
      ["검", "sword"],
      ["회장", "chairman"],
    ]);
    expect(listed.entries.map((e) => e.target_term)).toEqual(["blade"]);
  });

  it("editing a workspace entry still bumps glossary_rev of every series in the workspace", async () => {
    const { A, sdb, api, revs } = await setup();
    const koEn = await sdb.insert(series, { title: "KO→EN", sourceLang: "ko", targetLang: "en" });
    const r0 = await revs();
    const e = await json<Entry>(
      await api(`/glossary${KO_EN}`, { method: "POST", body: { source_term: "회장", target_term: "chairman" } }),
      201,
    );
    await json(await api(`/glossary/${e.id}`, { method: "PATCH", body: { target_term: "president" } }), 200);
    const r = await revs();
    expect(r[koEn.id]).toBe((r0[koEn.id] ?? 0) + 2);
    expect(r[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 2);
  });

  it("CSV import/export work on the selected pair only", async () => {
    const { api } = await setup();
    await json(
      await api(`/glossary${KO_EN}`, { method: "POST", body: { source_term: "회장", target_term: "chairman" } }),
      201,
    );
    await json(
      await api(`/glossary${KO_VI}`, { method: "POST", body: { source_term: "검", target_term: "kiếm" } }),
      201,
    );
    const replaced = await json<{ created: number }>(
      await api(`/glossary/csv${KO_VI}`, {
        method: "POST",
        body: { csv: "source_term,target_term\n용,rồng\n", mode: "replace" },
      }),
      200,
    );
    expect(replaced.created).toBe(1);
    const vi = await json<Listed>(await api(`/glossary${KO_VI}`), 200);
    expect(vi.entries.map((e) => [e.source_term, e.source_lang, e.target_lang])).toEqual([["용", "ko", "vi"]]);
    expect((await json<Listed>(await api(`/glossary${KO_EN}`), 200)).entries.map((e) => e.source_term)).toEqual([
      "회장",
    ]);

    const exp = await api(`/glossary/csv${KO_EN}`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get("content-disposition")).toContain("glossary-workspace-ko-en.csv");
    expect(parseGlossaryCsv(await exp.text()).entries.map((e) => e.target_term)).toEqual(["chairman"]);
  });
});

describe("CSV", () => {
  it("round-trips quotes, commas, newlines and BOM", () => {
    const rows = [
      { source_term: '말 "했다"', target_term: "nói, rằng", note: "dòng 1\ndòng 2", case_sensitive: true },
      { source_term: "용", target_term: "rồng", note: "", case_sensitive: false },
    ];
    const csv = toCsv(rows);
    expect(csv.startsWith("﻿")).toBe(true);
    const back = parseGlossaryCsv(csv);
    expect(back.errors).toEqual([]);
    expect(back.entries).toEqual(rows);
    expect(parseCsvRows('a,"b\r\nc"\r\n')).toEqual([["a", "b\r\nc"]]);
    const formula = { source_term: "=HYPERLINK(1)", target_term: "+x", note: "@y", case_sensitive: false };
    const fcsv = toCsv([formula]);
    expect(fcsv).toContain("'=HYPERLINK(1)");
    expect(parseGlossaryCsv(fcsv).entries).toEqual([formula]);
  });

  it("reports bad header / rows by line number", () => {
    expect(parseGlossaryCsv("foo,bar\nx,y\n").errors[0]?.line).toBe(1);
    const r = parseGlossaryCsv("source_term,target_term\nx,y\n,z\n");
    expect(r.entries).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3]);
    expect(parseGlossaryCsv('source_term,target_term\n"x,y\n').errors[0]?.line).toBe(0);
  });

  it("import merge upserts by source_term, replace swaps the set; export returns the series entries", async () => {
    const { A, api, revs } = await setup();
    const base = `/series/${A.seriesId}/glossary`;
    await json(await api(base, { method: "POST", body: { source_term: "검", target_term: "kiếm" } }), 201);
    const r0 = (await revs())[A.seriesId] ?? 0;

    const merged = await json<{ created: number; updated: number }>(
      await api(`${base}/csv`, {
        method: "POST",
        body: { csv: "source_term,target_term,note\n검,gươm,vũ khí\n용,rồng,\n" },
      }),
      200,
    );
    expect(merged).toMatchObject({ created: 1, updated: 1 });
    // Cả lần import chỉ tăng rev 1 lần.
    expect((await revs())[A.seriesId]).toBe(r0 + 1);

    const exp = await api(`${base}/csv`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get("content-type")).toContain("text/csv");
    const parsed = parseGlossaryCsv(await exp.text());
    expect(parsed.entries.map((e) => [e.source_term, e.target_term])).toEqual([
      ["검", "gươm"],
      ["용", "rồng"],
    ]);

    const replaced = await json<{ created: number }>(
      await api(`${base}/csv`, {
        method: "POST",
        body: { csv: "source_term,target_term\n마법,ma pháp\n", mode: "replace" },
      }),
      200,
    );
    expect(replaced.created).toBe(1);
    const listed = await json<{ entries: Entry[] }>(await api(base), 200);
    expect(listed.entries.map((e) => e.source_term)).toEqual(["마법"]);

    const empty = await api(`${base}/csv`, {
      method: "POST",
      body: { csv: "source_term,target_term\n", mode: "replace" },
    });
    expect(empty.status).toBe(400);
    expect((await json<{ entries: Entry[] }>(await api(base), 200)).entries).toHaveLength(1);
    const bad = await api(`${base}/csv`, { method: "POST", body: { csv: "a,b\n" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_csv");
  });
});
