/** Glossary của series: CRUD, glossary_rev cùng transaction, term duy nhất mỗi series, import/export CSV. */
import { chapters, glossaryEntries, scoped, series } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inJobTx, translateSettings } from "../src/jobs/enqueue.ts";
import { parseCsvRows, parseGlossaryCsv, toCsv } from "../src/routes/glossary.ts";
import { call, db, seedUser } from "./helpers.ts";

type Entry = {
  id: string;
  series_id: string;
  source_term: string;
  target_term: string;
  note: string;
};

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function setup() {
  const A = await seedUser("glo");
  const sdb = scoped(db, A.userId);
  const other = await sdb.insert(series, { title: "Other" });
  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    call(`/api${path}`, { cookie: A.cookie, ...init });
  const revs = async () => {
    const rows = await sdb.select(series);
    return Object.fromEntries(rows.map((r) => [r.id, r.glossaryRev]));
  };
  return { A, sdb, other, api, revs };
}

describe("glossary CRUD + revs", () => {
  it("every write bumps glossary_rev of that series only", async () => {
    const { A, other, api, revs } = await setup();
    const r0 = await revs();
    const se = await json<Entry>(
      await api(`/series/${A.seriesId}/glossary`, { method: "POST", body: { source_term: "검", target_term: "kiếm" } }),
      201,
    );
    expect(se.series_id).toBe(A.seriesId);
    expect(se).not.toHaveProperty("source_lang");
    let r = await revs();
    expect(r[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 1);
    expect(r[other.id]).toBe(r0[other.id]);

    const listed = await json<Record<string, unknown>>(await api(`/series/${A.seriesId}/glossary`), 200);
    expect(Object.keys(listed)).toEqual(["entries"]);
    expect((listed.entries as Entry[]).map((e) => e.target_term)).toEqual(["kiếm"]);

    const patched = await json<Entry>(
      await api(`/glossary/${se.id}`, { method: "PATCH", body: { target_term: "thanh kiếm" } }),
      200,
    );
    expect(patched.target_term).toBe("thanh kiếm");
    expect((await revs())[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 2);

    expect((await api(`/glossary/${se.id}`, { method: "DELETE" })).status).toBe(204);
    r = await revs();
    expect(r[A.seriesId]).toBe((r0[A.seriesId] ?? 0) + 3);
    expect(r[other.id]).toBe(r0[other.id]);
    expect((await api(`/glossary/${se.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("validates bodies", async () => {
    const { A, api } = await setup();
    const base = `/series/${A.seriesId}/glossary`;
    const error = async (res: Response) => (await json<{ error: string }>(res, 400)).error;
    expect(await error(await api(base, { method: "POST", body: { source_term: "", target_term: "x" } }))).toBe(
      "invalid_body",
    );
    expect(await error(await api(base, { method: "POST", body: { source_term: "a" } }))).toBe("invalid_body");
  });

  it("chapter of the series is unaffected by glossary writes (no chapter rows touched)", async () => {
    const { A, sdb, api } = await setup();
    const before = await sdb.byId(chapters, A.chapterId);
    await api(`/series/${A.seriesId}/glossary`, { method: "POST", body: { source_term: "용", target_term: "rồng" } });
    expect((await sdb.byId(chapters, A.chapterId)).updatedAt).toEqual(before.updatedAt);
  });

  it("the old shared glossary routes are gone", async () => {
    const { api } = await setup();
    const body = { source_term: "검", target_term: "kiếm" };
    expect((await api("/glossary?source_lang=ko&target_lang=vi")).status).toBe(404);
    expect((await api("/glossary?source_lang=ko&target_lang=vi", { method: "POST", body })).status).toBe(404);
    expect((await api("/glossary/csv?source_lang=ko&target_lang=vi")).status).toBe(404);
    expect(
      (await api("/glossary/csv?source_lang=ko&target_lang=vi", { method: "POST", body: { csv: "source_term\n" } }))
        .status,
    ).toBe(404);
  });
});

describe("unique term per series (DB constraint)", () => {
  it("concurrent creates of the same term → exactly one row, the loser gets 409 duplicate_term", async () => {
    const { A, sdb, api } = await setup();
    const body = { source_term: "동시", target_term: "đồng thời" };
    const res = await Promise.all(
      Array.from({ length: 6 }, () => api(`/series/${A.seriesId}/glossary`, { method: "POST", body })),
    );
    const codes = res.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c !== 201).every((c) => c === 409)).toBe(true);
    for (const r of res.filter((r) => r.status === 409)) {
      expect(((await r.json()) as { error: string }).error).toBe("duplicate_term");
    }
    const rows = await sdb.select(
      glossaryEntries,
      and(eq(glossaryEntries.seriesId, A.seriesId), eq(glossaryEntries.sourceTerm, "동시")),
    );
    expect(rows).toHaveLength(1);
  });

  it("same term is allowed once per series; PATCH to a taken term → 409", async () => {
    const { A, other, api } = await setup();
    const body = { source_term: "범위", target_term: "phạm vi" };
    expect((await api(`/series/${A.seriesId}/glossary`, { method: "POST", body })).status).toBe(201);
    expect((await api(`/series/${other.id}/glossary`, { method: "POST", body })).status).toBe(201);
    const dup = await api(`/series/${A.seriesId}/glossary`, { method: "POST", body });
    expect((await json<{ error: string }>(dup, 409)).error).toBe("duplicate_term");
    const e = await json<Entry>(
      await api(`/series/${A.seriesId}/glossary`, { method: "POST", body: { source_term: "검", target_term: "kiếm" } }),
      201,
    );
    expect((await api(`/glossary/${e.id}`, { method: "PATCH", body: { source_term: "범위" } })).status).toBe(409);
  });
});

describe("translation snapshot", () => {
  it("uses only the entries of that series and owner, whatever the series language pair", async () => {
    const { A, sdb, other, api } = await setup();
    await json(
      await api(`/series/${A.seriesId}/glossary`, { method: "POST", body: { source_term: "검", target_term: "kiếm" } }),
      201,
    );
    await json(
      await api(`/series/${other.id}/glossary`, { method: "POST", body: { source_term: "용", target_term: "rồng" } }),
      201,
    );
    // Người dùng khác có entry cùng term → không lọt sang (lọc kèm user_id).
    const B = await seedUser("glo-b");
    await scoped(db, B.userId).insert(glossaryEntries, {
      seriesId: B.seriesId,
      sourceTerm: "검",
      targetTerm: "sword",
    });

    const sA = await sdb.byId(series, A.seriesId);
    expect((await inJobTx((tx) => translateSettings(tx, sA))).glossary).toEqual({ 검: "kiếm" });
    // Entry series không gắn cặp ngôn ngữ: đổi cặp của series vẫn giữ glossary.
    await sdb.update(series, eq(series.id, A.seriesId), { targetLang: "en" });
    const koEn = await sdb.byId(series, A.seriesId);
    expect((await inJobTx((tx) => translateSettings(tx, koEn))).glossary).toEqual({ 검: "kiếm" });
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
    // Mỗi dòng lỗi có mã + tham số để web dịch, câu tiếng Việt cũ giữ ở `message`.
    expect(parseGlossaryCsv("foo,bar\nx,y\n").errors[0]).toMatchObject({ error: "csv_missing_columns", params: {} });
    expect(r.errors[0]).toMatchObject({ error: "csv_invalid_fields", params: { fields: "source_term" } });
    expect(r.errors[0]?.message).toBe("source_term");
    expect(parseGlossaryCsv('source_term,target_term\n"x,y\n').errors[0]).toMatchObject({
      error: "csv_unclosed_quote",
      message: "CSV: thiếu dấu nháy kép đóng",
    });
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
    expect(await empty.json()).toEqual({ error: "csv_empty", message: "CSV không có dòng nào", params: {} });
    expect((await json<{ entries: Entry[] }>(await api(base), 200)).entries).toHaveLength(1);
    const bad = await api(`${base}/csv`, { method: "POST", body: { csv: "a,b\n" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_csv");
  });
});
