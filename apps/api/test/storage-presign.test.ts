/** Tích hợp MinIO qua domain file riêng (infra/docker-compose.dev.yml phải đang chạy). */
import { setTimeout as sleep } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { head, MAX_GET_TTL_S, presignGet, presignPost, readPrefix } from "../src/storage.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(0)]);
const key = () => `ws/test/ch/test/src/${uuidv7()}.png`;

async function upload(post: { url: string; fields: Record<string, string> }, body: Uint8Array, contentType: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields)) form.append(k, k === "Content-Type" ? contentType : v);
  form.append("file", new Blob([body], { type: contentType }));
  return fetch(post.url, { method: "POST", body: form });
}

describe("storage presign", () => {
  it("signs against FILES_DOMAIN, not the internal endpoint", async () => {
    const post = await presignPost(key(), "image/png", 1024, 60);
    expect(new URL(post.url).host).toBe(env.FILES_DOMAIN);
    expect(new URL(await presignGet(key(), 60)).host).toBe(env.FILES_DOMAIN);
  });

  it("accepts a valid upload; HEAD/readPrefix see it; signed GET has nosniff", async () => {
    const k = key();
    const res = await upload(await presignPost(k, "image/png", PNG.length, 60), PNG, "image/png");
    expect(res.status, await res.text()).toBe(204);
    expect(await head(k)).toMatchObject({ bytes: PNG.length, contentType: "image/png" });
    expect([...(await readPrefix(k, 8))]).toEqual([...PNG.slice(0, 8)]);

    const get = await fetch(await presignGet(k, 60, 'attachment; filename="a.png"'));
    expect(get.status).toBe(200);
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(get.headers.get("content-disposition")).toBe('attachment; filename="a.png"');
  });

  it("rejects a file larger than maxBytes", async () => {
    const k = key();
    const res = await upload(await presignPost(k, "image/png", 16, 60), PNG, "image/png");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await head(k)).toBeNull();
  });

  it("rejects a Content-Type different from the policy", async () => {
    const k = key();
    const res = await upload(await presignPost(k, "image/png", 1024, 60), PNG, "text/html");
    expect(res.status).toBe(403);
    expect(await head(k)).toBeNull();
  });

  it("unsigned GET → 403 with nosniff; expired signed GET → 403", async () => {
    const k = key();
    await upload(await presignPost(k, "image/png", 1024, 60), PNG, "image/png");
    const unsigned = await fetch(`${env.FILES_SCHEME}://${env.FILES_DOMAIN}/${env.S3_BUCKET}/${k}`);
    expect(unsigned.status).toBe(403);
    expect(unsigned.headers.get("x-content-type-options")).toBe("nosniff");

    const url = await presignGet(k, 1);
    await sleep(2100);
    expect((await fetch(url)).status).toBe(403);
  });

  it("expired presigned POST is rejected", async () => {
    const k = key();
    const post = await presignPost(k, "image/png", 1024, 1);
    await sleep(2100);
    expect((await upload(post, PNG, "image/png")).status).toBe(403);
  });

  it("enforces TTL ceilings", async () => {
    expect(() => presignGet(key(), MAX_GET_TTL_S + 1)).toThrow(RangeError);
    await expect(presignPost(key(), "image/png", 1, 3600)).rejects.toThrow(RangeError);
  });
});
