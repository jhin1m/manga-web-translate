/**
 * Font hệ thống (admin): upload / commit kiểm như font riêng, id `custom-<8 hex>`, trùng sha256, trần 20 font / 100MB,
 * xoá bị chặn khi series của người khác dùng làm mặc định (không lộ tên), user thường 403.
 * Cần MinIO dev (pnpm infra:up).
 */
import { readFileSync } from "node:fs";
import { series, systemFonts } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { head } from "../src/storage.ts";
import { call, db, seedAdmin, seedUser } from "./helpers.ts";

type UploadUrl = { key: string; url: string; fields: Record<string, string> };
type FontView = { id: string; name: string; system: boolean; vi_complete: boolean; url: string };

const ITIM = readFileSync(new URL("../../../worker/fonts/Itim-Regular.ttf", import.meta.url));
/** Bản font khác sha256 nhưng vẫn parse được (byte thừa cuối file sfnt). */
const variant = (n: number) => Buffer.concat([ITIM, Buffer.from([n])]);

let admin: Awaited<ReturnType<typeof seedAdmin>>;

// seedAdmin đặt ADMIN_EMAILS và isolate-queue khôi phục sau mỗi ca → đặt lại trước mỗi request.
const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) => {
  if (!env.ADMIN_EMAILS.includes(admin.email)) env.ADMIN_EMAILS.push(admin.email);
  return call(`/api/admin${path}`, { cookie: admin.cookie, ...init });
};

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function putFile(bytes: Uint8Array): Promise<string> {
  const u = await json<UploadUrl>(
    await api("/fonts/upload-url", { method: "POST", body: { bytes: bytes.length } }),
    201,
  );
  expect(u.key.startsWith("system/fonts/uploads/")).toBe(true);
  const form = new FormData();
  for (const [k, v] of Object.entries(u.fields)) form.append(k, v);
  form.append("file", new Blob([bytes]));
  expect((await fetch(u.url, { method: "POST", body: form })).status).toBe(204);
  return u.key;
}

const commit = (key: string) => api("/fonts", { method: "POST", body: { key } });
const upload = async (bytes: Uint8Array) => commit(await putFile(bytes));
const list = async () => (await json<{ fonts: FontView[] }>(await api("/fonts"), 200)).fonts;

const seedRow = (i: number, bytes = 1) =>
  db.insert(systemFonts).values({
    fontId: `custom-${i.toString(16).padStart(8, "0")}`,
    name: `F${i}`,
    fileKey: `system/fonts/seed-${i}`,
    sha256: i.toString(16).padStart(64, "0"),
    bytes,
    unitsPerEm: 1000,
    ascent: 900,
    descent: 200,
    metricsSource: "hhea",
    viComplete: true,
    missing: [],
  });

beforeAll(async () => {
  admin = await seedAdmin("admin-fonts");
});
beforeEach(async () => {
  await db.delete(systemFonts);
});

describe("system font upload", () => {
  it("stores a TTF under system/fonts with a custom-<8hex> id and lists it as a system font", async () => {
    const font = await json<FontView>(await upload(ITIM), 201);
    expect(font.id).toMatch(/^custom-[0-9a-f]{8}$/);
    expect(font).toMatchObject({ system: true, vi_complete: true });
    const [row] = await db.select().from(systemFonts).where(eq(systemFonts.fontId, font.id));
    expect(row?.fileKey).toBe(`system/fonts/${font.id}`);
    expect(row?.createdBy).toBe(admin.userId);

    const listed = (await list()).find((f) => f.id === font.id);
    const file = await fetch(listed?.url ?? "");
    expect(Buffer.from(await file.arrayBuffer()).equals(ITIM)).toBe(true);
  });

  it("returns the existing font for the same bytes and drops the duplicate upload", async () => {
    const first = await json<FontView>(await upload(variant(1)), 201);
    const key = await putFile(variant(1));
    const again = await json<FontView>(await commit(key), 200);
    expect(again.id).toBe(first.id);
    expect(await head(key)).toBeNull();
    expect((await list()).filter((f) => f.id === first.id)).toHaveLength(1);
  });

  it("rejects WOFF and a corrupt font with 400 and removes the object", async () => {
    for (const [bytes, error] of [
      [Buffer.from("wOFF\0\x01\0\0 rest of a woff file"), "not_font"],
      [ITIM.subarray(0, 300), "corrupt_font"],
    ] as const) {
      const key = await putFile(bytes);
      expect((await json<{ error: string }>(await commit(key), 400)).error).toBe(error);
      expect(await head(key)).toBeNull();
    }
  });

  it("rejects a key outside system/fonts/uploads/ and one never uploaded", async () => {
    for (const key of [`u/${admin.userId}/fonts/x`, "system/fonts/custom-aaaaaaaa", "system/fonts/uploads/../../u/x"]) {
      expect((await json<{ error: string }>(await commit(key), 400)).error).toBe("invalid_key");
    }
    const { key } = await json<UploadUrl>(await api("/fonts/upload-url", { method: "POST", body: { bytes: 10 } }), 201);
    expect((await commit(key)).status).toBe(409);
  });

  it("refuses the 21st font with 409 limit and removes both objects", async () => {
    for (let i = 0; i < 20; i++) await seedRow(i);
    const key = await putFile(ITIM);
    expect((await json<{ error: string }>(await commit(key), 409)).error).toBe("limit");
    expect(await head(key)).toBeNull();
    expect(await db.select().from(systemFonts)).toHaveLength(20);
  });

  it("refuses a font that would push the total over 100MB", async () => {
    await seedRow(1, 100 * 1024 * 1024 - ITIM.length + 1);
    const key = await putFile(ITIM);
    expect((await json<{ error: string }>(await commit(key), 409)).error).toBe("limit");
    expect(await db.select().from(systemFonts)).toHaveLength(1);
    // Vừa đủ trần vẫn nhận.
    await db.delete(systemFonts);
    await seedRow(1, 100 * 1024 * 1024 - ITIM.length);
    await json(await upload(ITIM), 201);
  });
});

describe("system font delete", () => {
  it("is blocked with a series count (no titles) while any user's series uses it, then allowed", async () => {
    const font = await json<FontView>(await upload(variant(2)), 201);
    const U = await seedUser("sysfont-owner");
    await db
      .update(series)
      .set({ defaultFonts: { dialogue: font.id } })
      .where(eq(series.id, U.seriesId));

    const blocked = await json<Record<string, unknown>>(await api(`/fonts/${font.id}`, { method: "DELETE" }), 409);
    expect(blocked).toMatchObject({ error: "in_use", series_count: 1 });
    expect(blocked).not.toHaveProperty("series");
    expect(JSON.stringify(blocked)).not.toContain(U.email);
    expect(await db.select().from(systemFonts)).toHaveLength(1);

    await db.update(series).set({ defaultFonts: {} }).where(eq(series.id, U.seriesId));
    const [row] = await db.select().from(systemFonts);
    expect((await api(`/fonts/${font.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await head(row?.fileKey ?? "")).toBeNull();
    expect((await api(`/fonts/${font.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("access", () => {
  it("is admin-only: a normal user gets 403 on every route", async () => {
    const U = await seedUser("sysfont-plain");
    const plain = (path: string, method = "GET", body?: unknown) =>
      call(`/api/admin${path}`, { method, cookie: U.cookie, body });
    expect((await plain("/fonts")).status).toBe(403);
    expect((await plain("/fonts/upload-url", "POST", { bytes: 10 })).status).toBe(403);
    expect((await plain("/fonts", "POST", { key: "system/fonts/uploads/x" })).status).toBe(403);
    expect((await plain("/fonts/custom-aaaaaaaa", "DELETE")).status).toBe(403);
  });
});
