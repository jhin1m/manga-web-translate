/** Glossary workspace/series: CRUD, glossary_rev cùng transaction, ghi đè theo series, import/export CSV. */
import { chapters, scoped, series } from "@mtl/db";
import { describe, expect, it } from "vitest";
import { inJobTx, translateSettings } from "../src/jobs/enqueue.ts";
import { parseCsvRows, parseGlossaryCsv, toCsv } from "../src/routes/glossary.ts";
import { call, db, seedWorkspace } from "./helpers.ts";

type Entry = { id: string; series_id: string | null; source_term: string; target_term: string; note: string };

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
      await api("/glossary", { method: "POST", body: { source_term: "검", target_term: "gươm" } }),
      201,
    );
    expect(we.series_id).toBeNull();
    r = await revs();
    expect(r[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 2);
    expect(r[other.id]).toBe((r0[other.id] ?? 0) + 1);

    // Trùng source_term cùng cấp → 409; khác cấp được.
    expect((await api("/glossary", { method: "POST", body: { source_term: "검", target_term: "x" } })).status).toBe(
      409,
    );

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
    expect((await api("/glossary", { method: "POST", body: { source_term: "", target_term: "x" } })).status).toBe(400);
    expect((await api("/glossary", { method: "POST", body: { source_term: "a" } })).status).toBe(400);
  });

  it("chapter of the series is unaffected by glossary writes (no chapter rows touched)", async () => {
    const { A, sdb, api } = await setup();
    const before = await sdb.byId(chapters, A.chapterId);
    await api("/glossary", { method: "POST", body: { source_term: "용", target_term: "rồng" } });
    expect((await sdb.byId(chapters, A.chapterId)).updatedAt).toEqual(before.updatedAt);
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

    const bad = await api(`${base}/csv`, { method: "POST", body: { csv: "a,b\n" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_csv");
  });
});
