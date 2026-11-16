/** GET /api/thumbs/:fileId — tạo thumbnail theo yêu cầu, cache trong storage, chỉ file của chính người dùng. */
import { chapters, scoped, sourceFiles } from "@mtl/db";
import { storageKeys } from "@mtl/shared";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { deleteObject, deletePrefix, head, putObject, readObject } from "../src/storage.ts";
import { call, db, seedUser } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let A: Seed;
let B: Seed;

beforeAll(async () => {
  [A, B] = await Promise.all([seedUser("thumb-a"), seedUser("thumb-b")]);
});

const strip = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 60, b: 200 } } })
    .png()
    .toBuffer();

/** Ảnh gốc của chương `chapterId`; `bytes: null` = hàng có nhưng chưa upload. */
async function sourceFile(s: Seed, chapterId: string, bytes: Uint8Array | null, ord = 0) {
  const key = storageKeys.source(s.userId, chapterId, uuidv7(), "png");
  if (bytes) await putObject(key, bytes, "image/png");
  return scoped(db, s.userId).insert(sourceFiles, {
    chapterId,
    ord,
    storageKey: key,
    bytes: bytes?.length ?? 1,
    mime: "image/png",
  });
}

const get = (id: string, cookie = A.cookie) => call(`/api/thumbs/${id}`, { cookie });

describe("thumbs", () => {
  it("renders on first view, redirects to a signed URL and caches the result", async () => {
    const f = await sourceFile(A, A.chapterId, await strip(800, 12000));
    const res = await get(f.id);
    expect(res.status, await res.clone().text()).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    expect(res.headers.get("location")).toBeTruthy();

    const key = storageKeys.thumb(A.userId, A.chapterId, f.id, 0, 0);
    const stored = await readObject(key);
    const m = await sharp(stored).metadata();
    expect([m.format, m.width, m.height]).toEqual(["webp", 300, 400]);
    expect(stored.byteLength).toBeLessThan(40 * 1024);
    expect((await head(key))?.contentType).toBe("image/webp");

    // Xoá ảnh gốc: lần 2 vẫn 302 → phục vụ từ cache, không dựng lại.
    await deleteObject(f.storageKey);
    expect((await get(f.id)).status).toBe(302);
  });

  it("uses a new thumbnail key when the trim changes", async () => {
    const f = await sourceFile(A, A.chapterId, await strip(600, 3000));
    expect((await get(f.id)).status).toBe(302);
    await scoped(db, A.userId).update(sourceFiles, eq(sourceFiles.id, f.id), {
      trim: { top: 100, bottom: 200, by: "user" },
    });
    expect((await get(f.id)).status).toBe(302);
    expect(await head(storageKeys.thumb(A.userId, A.chapterId, f.id, 0, 0))).not.toBeNull();
    expect(await head(storageKeys.thumb(A.userId, A.chapterId, f.id, 100, 200))).not.toBeNull();
  });

  it("ignores the version query on the url", async () => {
    const f = await sourceFile(A, A.chapterId, await strip(400, 600));
    expect((await call(`/api/thumbs/${f.id}?t=5-9`, { cookie: A.cookie })).status).toBe(302);
  });

  it("returns 404 for a file that is not uploaded yet", async () => {
    const f = await sourceFile(A, A.chapterId, null);
    expect((await get(f.id)).status).toBe(404);
  });

  it("returns 404 for another user's file and for a bad id, without creating a thumbnail", async () => {
    const f = await sourceFile(B, B.chapterId, await strip(400, 600));
    expect((await get(f.id)).status).toBe(404);
    expect(await head(storageKeys.thumb(B.userId, B.chapterId, f.id, 0, 0))).toBeNull();
    expect((await get("not-a-uuid")).status).toBe(404);
    expect((await get(f.id, B.cookie)).status).toBe(302);
  });

  it("requires a session", async () => {
    const f = await sourceFile(A, A.chapterId, await strip(100, 100));
    expect((await call(`/api/thumbs/${f.id}`)).status).toBe(401);
  });

  it("returns 422 for a source that is not a decodable image", async () => {
    const f = await sourceFile(A, A.chapterId, new TextEncoder().encode("definitely not an image"));
    const res = await get(f.id);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "invalid_image" });
  });

  it("deleting the chapter removes its thumbnails with the rest of its prefix", async () => {
    const ch = await scoped(db, A.userId).insert(chapters, { seriesId: A.seriesId, number: "77" });
    const f = await sourceFile(A, ch.id, await strip(300, 300));
    expect((await get(f.id)).status).toBe(302);
    const key = storageKeys.thumb(A.userId, ch.id, f.id, 0, 0);
    expect(await head(key)).not.toBeNull();
    expect((await call(`/api/chapters/${ch.id}`, { method: "DELETE", cookie: A.cookie })).status).toBe(204);
    expect(await head(key)).toBeNull();
    await deletePrefix(`u/${A.userId}/ch/${ch.id}/`);
  });
});
