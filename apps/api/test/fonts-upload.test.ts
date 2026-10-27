/**
 * Font tuỳ chỉnh của người dùng: upload (presigned POST → commit kiểm magic bytes / kích thước / parse), trùng sha256,
 * giới hạn 20 font, xoá font đang là mặc định series, `default_fonts` kiểm động.
 * Cần MinIO dev (pnpm infra:up).
 */
import { readFileSync } from "node:fs";
import { scoped, userFonts } from "@mtl/db";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_FONT_BYTES } from "../src/lib/font-metrics.ts";
import { MAX_USER_FONTS } from "../src/routes/fonts.ts";
import { head, presignPut } from "../src/storage.ts";
import { call, db, seedUser } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type UploadUrl = { key: string; url: string; fields: Record<string, string> };
type FontView = {
  id: string;
  name: string;
  units_per_em: number;
  ascent: number;
  descent: number;
  metrics_source: string;
  vi_complete: boolean;
  missing: string[];
  url: string;
};

const fontFile = (name: string) => readFileSync(new URL(`../../../worker/fonts/${name}`, import.meta.url));
const ITIM = fontFile("Itim-Regular.ttf");

let A: Seed;

beforeAll(async () => {
  A = await seedUser("fontup");
});

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  call(`/api${path}`, { cookie: A.cookie, ...init });

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

/** upload-url → POST file lên storage → trả key (chưa commit). */
async function putFile(bytes: Uint8Array): Promise<string> {
  const u = await json<UploadUrl>(
    await api("/fonts/upload-url", { method: "POST", body: { bytes: bytes.length } }),
    201,
  );
  const form = new FormData();
  for (const [k, v] of Object.entries(u.fields)) form.append(k, v);
  form.append("file", new Blob([bytes]));
  expect((await fetch(u.url, { method: "POST", body: form })).status).toBe(204);
  return u.key;
}

const commit = (key: string, cookie = A.cookie) => api("/fonts", { method: "POST", body: { key }, cookie });
const upload = async (bytes: Uint8Array) => commit(await putFile(bytes));

/** Bản font khác sha256 nhưng vẫn parse được (byte thừa cuối file sfnt). */
const variant = (n: number) => Buffer.concat([ITIM, Buffer.from([n])]);

describe("font upload", () => {
  it("stores a TTF with metrics identical to the bundled manifest and lists it with a presigned URL", async () => {
    const font = await json<FontView>(await upload(ITIM), 201);
    expect(font.id).toMatch(/^custom-[0-9a-f]{8}$/);
    expect(font).toMatchObject({
      units_per_em: 1000,
      ascent: 950,
      descent: 250,
      metrics_source: "hhea",
      vi_complete: true,
    });
    expect(font.missing).toEqual([]);

    const { fonts } = await json<{ fonts: FontView[] }>(await api("/fonts"), 200);
    const listed = fonts.find((f) => f.id === font.id);
    expect(listed?.url).toContain("X-Amz-Signature");
    const file = await fetch(listed?.url ?? "");
    expect(Buffer.from(await file.arrayBuffer()).equals(ITIM)).toBe(true);
  });

  it("returns the existing font for the same bytes and drops the duplicate object", async () => {
    const first = await json<FontView>(await upload(variant(1)), 201);
    const key = await putFile(variant(1));
    const again = await json<FontView>(await commit(key), 200);
    expect(again.id).toBe(first.id);
    expect(await head(key)).toBeNull();
    // Commit lặp cùng key của font đã lưu không xoá file của chính nó.
    const { fonts } = await json<{ fonts: FontView[] }>(await api("/fonts"), 200);
    expect(fonts.filter((f) => f.id === first.id)).toHaveLength(1);
    const stored = await fetch(fonts.find((f) => f.id === first.id)?.url ?? "");
    expect(stored.status).toBe(200);
  });

  it("moves the verified file to a key the upload form cannot write, so the old key cannot be reused", async () => {
    const bytes = variant(7);
    const u = await json<UploadUrl>(
      await api("/fonts/upload-url", { method: "POST", body: { bytes: bytes.length } }),
      201,
    );
    const post = async (data: Uint8Array) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(u.fields)) form.append(k, v);
      form.append("file", new Blob([data]));
      return (await fetch(u.url, { method: "POST", body: form })).status;
    };
    expect(await post(bytes)).toBe(204);
    const font = await json<FontView>(await commit(u.key), 201);
    expect(await head(u.key)).toBeNull();

    // Form POST còn hạn chỉ ghi lại key upload; file của font đã lưu không đổi.
    expect(await post(variant(8))).toBe(204);
    const stored = await fetch(font.url);
    expect(Buffer.from(await stored.arrayBuffer()).equals(bytes)).toBe(true);

    // Commit lại key upload cho ra font khác (sha mới), không dùng chung object với font cũ.
    const second = await json<FontView>(await commit(u.key), 201);
    expect(second.id).not.toBe(font.id);
    const again = await fetch(font.url);
    expect(Buffer.from(await again.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("rejects WOFF, HTML and a corrupt font with 400 and removes the object", async () => {
    for (const [bytes, error] of [
      [Buffer.from("wOFF\0\x01\0\0 rest of a woff file"), "not_font"],
      [Buffer.from("wOF2\0\x01\0\0 rest of a woff2 file"), "not_font"],
      [Buffer.from("<!doctype html><script>alert(1)</script>"), "not_font"],
      [ITIM.subarray(0, 300), "corrupt_font"],
    ] as const) {
      const key = await putFile(bytes);
      const body = await json<{ error: string }>(await commit(key), 400);
      expect(body.error).toBe(error);
      expect(await head(key)).toBeNull();
    }
  });

  it("rejects an upload-url request over 10MB, and a committed object over 10MB", async () => {
    expect((await api("/fonts/upload-url", { method: "POST", body: { bytes: MAX_FONT_BYTES + 1 } })).status).toBe(400);
    expect((await api("/fonts/upload-url", { method: "POST", body: { bytes: 0 } })).status).toBe(400);
    // Object lớn đặt thẳng (bỏ qua policy POST) vẫn bị commit chặn.
    const { key } = await json<UploadUrl>(await api("/fonts/upload-url", { method: "POST", body: { bytes: 10 } }), 201);
    const big = Buffer.alloc(MAX_FONT_BYTES + 1);
    ITIM.copy(big);
    const put = await fetch(await presignPut(key, "application/octet-stream", 60), { method: "PUT", body: big });
    expect(put.status).toBe(200);
    const body = await json<{ error: string }>(await commit(key), 400);
    expect(body.error).toBe("too_large");
    expect(await head(key)).toBeNull();
  });

  it("rejects a key that was never uploaded or belongs elsewhere", async () => {
    const { key } = await json<UploadUrl>(await api("/fonts/upload-url", { method: "POST", body: { bytes: 10 } }), 201);
    expect((await commit(key)).status).toBe(409);
    expect((await commit(`u/${A.userId}/ch/${A.chapterId}/src/x.png`)).status).toBe(400);
    expect((await commit(`u/${A.userId}/fonts/../../other/x`)).status).toBe(400);
    expect((await commit("u/00000000-0000-7000-8000-000000000000/fonts/x")).status).toBe(400);
  });
});

describe("series default fonts", () => {
  it("accepts bundled and own fonts, rejects unknown ones, blocks deleting a font in use", async () => {
    const font = await json<FontView>(await upload(variant(2)), 201);
    const patch = (default_fonts: Record<string, string>) =>
      api(`/series/${A.seriesId}`, { method: "PATCH", body: { default_fonts } });

    await json(await patch({ dialogue: "Bangers-Regular" }), 200);
    expect((await patch({ dialogue: "custom-deadbeef" })).status).toBe(400);
    expect((await patch({ dialogue: "Comic-Sans" })).status).toBe(400);

    const ok = await json<{ default_fonts: Record<string, string> }>(await patch({ dialogue: font.id }), 200);
    expect(ok.default_fonts.dialogue).toBe(font.id);

    const blocked = await json<{ error: string; series: string[] }>(
      await api(`/fonts/${font.id}`, { method: "DELETE" }),
      409,
    );
    expect(blocked).toMatchObject({ error: "in_use", series: [expect.any(String)] });

    await json(await patch({ dialogue: "Bangers-Regular" }), 200);
    expect((await api(`/fonts/${font.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/fonts/${font.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await patch({ dialogue: font.id })).status).toBe(400);
  });

  it("a font of another user is not accepted", async () => {
    const B = await seedUser("fontup-b");
    const res = await call(`/api/fonts`, { cookie: B.cookie });
    expect(res.status).toBe(200);
    const mine = (await json<{ fonts: FontView[] }>(await api("/fonts"), 200)).fonts[0];
    const patch = await call(`/api/series/${B.seriesId}`, {
      method: "PATCH",
      cookie: B.cookie,
      body: { default_fonts: { dialogue: mine?.id } },
    });
    expect(patch.status).toBe(400);
  });
});

describe("font limit", () => {
  it("allows at most 20 fonts per user", async () => {
    const C = await seedUser("fontup-limit");
    const sdb = scoped(db, C.userId);
    for (let i = 0; i < MAX_USER_FONTS; i++) {
      await sdb.insert(userFonts, {
        fontId: `custom-${i.toString(16).padStart(8, "0")}`,
        name: `F${i}`,
        fileKey: `u/${C.userId}/fonts/seed-${i}`,
        sha256: i.toString(16).padStart(64, "0"),
        bytes: 1,
        unitsPerEm: 1000,
        ascent: 900,
        descent: 200,
        metricsSource: "hhea",
        viComplete: true,
        missing: [],
      });
    }
    const u = await json<UploadUrl>(
      await call(`/api/fonts/upload-url`, {
        method: "POST",
        cookie: C.cookie,
        body: { bytes: ITIM.length },
      }),
      201,
    );
    const form = new FormData();
    for (const [k, v] of Object.entries(u.fields)) form.append(k, v);
    form.append("file", new Blob([ITIM]));
    expect((await fetch(u.url, { method: "POST", body: form })).status).toBe(204);
    const res = await call(`/api/fonts`, { method: "POST", cookie: C.cookie, body: { key: u.key } });
    expect(await json<{ error: string }>(res, 409)).toMatchObject({ error: "limit" });
    expect(await head(u.key)).toBeNull();
  });
});
