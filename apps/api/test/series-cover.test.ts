/** cover_src ở danh sách series, thumb_src ở chi tiết, và ảnh bìa tuỳ chỉnh (PUT/DELETE /series/:id/cover). */
import { chapters, scoped, series, sourceFiles } from "@mtl/db";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { head, readObject } from "../src/storage.ts";
import { app, call, db, seedUser } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type ListItem = { id: string; cover_src: string | null; cover_custom: boolean };
type Detail = { cover_custom: boolean; chapters: { id: string; number: string; thumb_src: string | null }[] };

let A: Seed;
let B: Seed;
beforeAll(async () => {
  [A, B] = await Promise.all([seedUser("cover-a"), seedUser("cover-b")]);
});

const png = (w = 120, h = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    .png()
    .toBuffer();

async function newSeries(s: Seed, title: string) {
  return scoped(db, s.userId).insert(series, { title });
}
async function newChapter(s: Seed, seriesId: string, number: string) {
  return scoped(db, s.userId).insert(chapters, { seriesId, number });
}
async function newFile(s: Seed, chapterId: string, ord: number, skip: "credit" | null = null) {
  return scoped(db, s.userId).insert(sourceFiles, {
    chapterId,
    ord,
    storageKey: `u/${s.userId}/ch/${chapterId}/src/${ord}-${Math.random().toString(36).slice(2)}.png`,
    bytes: 10,
    mime: "image/png",
    skip,
  });
}

async function listOf(s: Seed): Promise<Map<string, ListItem>> {
  const res = await call("/api/series", { cookie: s.cookie });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { series: ListItem[] };
  return new Map(body.series.map((x) => [x.id, x]));
}
async function detailOf(s: Seed, id: string): Promise<Detail> {
  const res = await call(`/api/series/${id}`, { cookie: s.cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Detail;
}

function putCover(s: Seed, seriesId: string, body: Uint8Array | string, type = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([body], { type }), "cover.bin");
  return app.request(`/api/series/${seriesId}/cover`, {
    method: "PUT",
    headers: { origin: env.WEB_ORIGIN, cookie: s.cookie },
    body: form,
  });
}
const keyOf = async (seriesId: string) =>
  (await db.select().from(series).where(eq(series.id, seriesId)))[0]?.coverKey ?? null;

describe("cover_src / thumb_src", () => {
  it("picks the first non-skipped page of the lowest-numbered chapter that has one", async () => {
    const s = await newSeries(A, "cover pick");
    const ch10 = await newChapter(A, s.id, "10");
    const ch2 = await newChapter(A, s.id, "2");
    const ch1 = await newChapter(A, s.id, "1");
    await newFile(A, ch10.id, 0);
    const skipped = await newFile(A, ch2.id, 0, "credit");
    const first = await newFile(A, ch2.id, 1);
    await newFile(A, ch2.id, 2);
    await newFile(A, ch1.id, 0, "credit"); // chương số nhỏ nhất toàn ảnh bỏ qua → lấy chương kế

    const item = (await listOf(A)).get(s.id);
    expect(item?.cover_src).toBe(`/api/thumbs/${first.id}`);
    expect(item?.cover_src).not.toContain(skipped.id);
    expect(item?.cover_custom).toBe(false);

    const d = await detailOf(A, s.id);
    const thumb = (n: string) => d.chapters.find((c) => c.number === n)?.thumb_src;
    expect(thumb("2")).toBe(`/api/thumbs/${first.id}`);
    expect(thumb("1")).toBeNull();
    expect(thumb("10")).toMatch(/^\/api\/thumbs\//);
  });

  it("is null for a series without chapters or without usable pages", async () => {
    const empty = await newSeries(A, "cover empty");
    const onlySkipped = await newSeries(A, "cover only skipped");
    await newFile(A, (await newChapter(A, onlySkipped.id, "1")).id, 0, "credit");
    const list = await listOf(A);
    expect(list.get(empty.id)?.cover_src).toBeNull();
    expect(list.get(onlySkipped.id)?.cover_src).toBeNull();
  });

  it("never exposes pages of another user's series", async () => {
    const s = await newSeries(B, "cover other user");
    await newFile(B, (await newChapter(B, s.id, "1")).id, 0);
    expect((await listOf(A)).has(s.id)).toBe(false);
    expect((await listOf(B)).get(s.id)?.cover_src).toMatch(/^\/api\/thumbs\//);
  });
});

describe("PUT/DELETE /series/:id/cover", () => {
  it("stores a 600x800 WebP, wins over the first page, and replaces + deletes the old object", async () => {
    const s = await newSeries(A, "cover custom");
    await newFile(A, (await newChapter(A, s.id, "1")).id, 0);

    const res = await putCover(A, s.id, await png());
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { cover_custom: boolean; cover_src: string };
    expect(body.cover_custom).toBe(true);
    expect(body.cover_src).not.toContain("/api/thumbs/");

    const k1 = await keyOf(s.id);
    expect(k1).toContain(`/series/${s.id}/cover/`);
    const m = await sharp(await readObject(k1 as string)).metadata();
    expect([m.format, m.width, m.height]).toEqual(["webp", 600, 800]);
    expect((await listOf(A)).get(s.id)).toMatchObject({ cover_custom: true });
    expect((await listOf(A)).get(s.id)?.cover_src).not.toContain("/api/thumbs/");
    expect((await detailOf(A, s.id)).cover_custom).toBe(true);

    expect((await putCover(A, s.id, await png(300, 300))).status).toBe(200);
    const k2 = await keyOf(s.id);
    expect(k2).not.toBe(k1);
    expect(await head(k1 as string)).toBeNull();
    expect(await head(k2 as string)).not.toBeNull();

    const del = await call(`/api/series/${s.id}/cover`, { method: "DELETE", cookie: A.cookie });
    expect(del.status).toBe(204);
    expect(await keyOf(s.id)).toBeNull();
    expect(await head(k2 as string)).toBeNull();
    expect((await listOf(A)).get(s.id)).toMatchObject({ cover_custom: false });
    expect((await listOf(A)).get(s.id)?.cover_src).toMatch(/^\/api\/thumbs\//);
    // idempotent
    expect((await call(`/api/series/${s.id}/cover`, { method: "DELETE", cookie: A.cookie })).status).toBe(204);
  });

  it("serves the custom cover through a stable URL that only changes with the cover", async () => {
    const s = await newSeries(A, "cover stable");
    expect((await putCover(A, s.id, await png())).status).toBe(200);
    const first = (await listOf(A)).get(s.id)?.cover_src as string;
    expect(first).toMatch(new RegExp(`^/api/series/${s.id}/cover\\?v=[0-9a-f-]+$`));
    expect((await listOf(A)).get(s.id)?.cover_src).toBe(first);

    const res = await call(first, { cookie: A.cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    expect(res.headers.get("location")).toBeTruthy();

    expect((await putCover(A, s.id, await png(300, 300))).status).toBe(200);
    const second = (await listOf(A)).get(s.id)?.cover_src;
    expect(second).not.toBe(first);
    expect(second).toContain(`/api/series/${s.id}/cover?v=`);
  });

  it("GET cover is 404 without a custom cover and for another user's series", async () => {
    const none = await newSeries(A, "cover none");
    expect((await call(`/api/series/${none.id}/cover`, { cookie: A.cookie })).status).toBe(404);
    const foreign = await newSeries(B, "cover foreign get");
    expect((await putCover(B, foreign.id, await png())).status).toBe(200);
    expect((await call(`/api/series/${foreign.id}/cover`, { cookie: A.cookie })).status).toBe(404);
    expect((await call(`/api/series/${foreign.id}/cover`, { cookie: B.cookie })).status).toBe(302);
  });

  it("does not trust Content-Type: non-image and unsupported formats are 400", async () => {
    const s = await newSeries(A, "cover bad");
    expect((await putCover(A, s.id, "<html>not an image</html>", "image/png")).status).toBe(400);
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } })
      .gif()
      .toBuffer();
    expect((await putCover(A, s.id, gif, "image/png")).status).toBe(400);
    expect(await keyOf(s.id)).toBeNull();
    // missing file field / JSON body
    const noFile = await call(`/api/series/${s.id}/cover`, { method: "PUT", cookie: A.cookie, body: {} });
    expect(noFile.status).toBe(400);
  });

  it("rejects an image above the pixel limit with 422", async () => {
    const s = await newSeries(A, "cover huge");
    // PNG 1x1 với IHDR 20000x20000 + CRC đúng
    const { crc32 } = await import("node:zlib");
    const b = Buffer.from(await png(1, 1));
    b.writeUInt32BE(20000, 16);
    b.writeUInt32BE(20000, 20);
    b.writeUInt32BE(crc32(b.subarray(12, 29)), 29);
    expect((await putCover(A, s.id, b)).status).toBe(422);
  });

  it("rejects a file above 10 MB with 413", async () => {
    const s = await newSeries(A, "cover big");
    const res = await putCover(A, s.id, new Uint8Array(10 * 1024 * 1024 + 1024 * 1024));
    expect(res.status).toBe(413);
    expect(await keyOf(s.id)).toBeNull();
  });

  it("cannot touch another user's series", async () => {
    const s = await newSeries(B, "cover foreign");
    expect((await putCover(A, s.id, await png())).status).toBe(404);
    expect((await call(`/api/series/${s.id}/cover`, { method: "DELETE", cookie: A.cookie })).status).toBe(404);
    expect(await keyOf(s.id)).toBeNull();
  });

  it("deleting the series removes its cover object", async () => {
    const s = await newSeries(A, "cover cleanup");
    expect((await putCover(A, s.id, await png())).status).toBe(200);
    const key = (await keyOf(s.id)) as string;
    expect(await head(key)).not.toBeNull();
    expect((await call(`/api/series/${s.id}`, { method: "DELETE", cookie: A.cookie })).status).toBe(204);
    expect(await head(key)).toBeNull();
  });
});
