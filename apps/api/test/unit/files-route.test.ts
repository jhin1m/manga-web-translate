/** Route `/files`: kiểm chữ ký/hạn/traversal, Range, header bảo mật, policy POST, header PUT. */
import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/routes/files.ts";
import { PNG, postUpload, testKey } from "../storage-contract.ts";
import { createDiskHarness, type DiskHarness } from "./disk-test-harness.ts";

const h: DiskHarness = await createDiskHarness();

async function uploaded(key = testKey()) {
  const res = await postUpload(h, await h.driver.presignPost(key, "image/png", 1 << 20, 60), PNG, "image/png");
  expect(res.status).toBe(204);
  return key;
}

describe("parseRange", () => {
  it("parses single ranges, ignores malformed/multi, flags unsatisfiable", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("bytes=9-1", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});

describe("files route", () => {
  it("rejects encoded traversal / sidecar keys with 400 (+ nosniff)", async () => {
    const url = await h.driver.presignGet(await uploaded(), 60);
    const query = url.slice(url.indexOf("?"));
    for (const path of [
      "/files/..%2f..%2fetc%2fpasswd",
      "/files/%2e%2e%2fx",
      "/files/a/x.meta.json",
      "/files/a%2f%2fb",
    ]) {
      const res = await h.fetcher(path + query);
      expect(res.status, path).toBe(400);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("serves byte ranges with 206 + Content-Range; unsatisfiable → 416", async () => {
    const url = await h.driver.presignGet(await uploaded(), 60);
    const part = await h.fetcher(url, { headers: { range: "bytes=1-3" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 1-3/${PNG.length}`);
    expect(part.headers.get("content-length")).toBe("3");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([...PNG.slice(1, 4)]);

    const tail = await h.fetcher(url, { headers: { range: "bytes=-2" } });
    expect(tail.headers.get("content-range")).toBe(`bytes ${PNG.length - 2}-${PNG.length - 1}/${PNG.length}`);

    const bad = await h.fetcher(url, { headers: { range: `bytes=${PNG.length}-` } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe(`bytes */${PNG.length}`);
  });

  it("GET carries sandbox CSP, content-type, length, cache; HEAD has headers but no body", async () => {
    const url = await h.driver.presignGet(await uploaded(), 60);
    const get = await h.fetcher(url);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(get.headers.get("content-length")).toBe(String(PNG.length));
    expect(get.headers.get("accept-ranges")).toBe("bytes");
    expect(get.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(get.headers.get("cache-control")).toMatch(/^private, max-age=(59|60)$/);
    const headRes = await h.fetcher(url, { method: "HEAD" });
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("content-length")).toBe(String(PNG.length));
    expect((await headRes.arrayBuffer()).byteLength).toBe(0);
  });

  it("tampered query (added disposition / other key) → 403; missing object → 404", async () => {
    const k = await uploaded();
    const url = await h.driver.presignGet(k, 60);
    expect((await h.fetcher(`${url}&cd=attachment`)).status).toBe(403);
    expect((await h.fetcher(`${url}&cd=%0A`)).status).toBe(403);
    const other = await uploaded();
    expect((await h.fetcher(url.replace(k, other))).status).toBe(403);
    expect((await h.fetcher(await h.driver.presignGet(testKey(), 60))).status).toBe(404);
  });

  it("POST: no Content-Length → 411; oversized Content-Length → 413; empty file → 400", async () => {
    const k = testKey();
    const post = await h.driver.presignPost(k, "image/png", 64, 60);
    const form = new FormData();
    form.append("Content-Type", "image/png");
    form.append("file", new Blob([PNG], { type: "image/png" }));
    expect((await h.rawRequest(post.url, { method: "POST", body: form })).status).toBe(411);
    const big = await h.rawRequest(post.url, {
      method: "POST",
      headers: { "content-length": String(64 + 64 * 1024 + 1), "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    expect(big.status).toBe(413);
    expect((await postUpload(h, post, new Uint8Array(), "image/png")).status).toBe(400);
    expect(await h.driver.head(k)).toBeNull();
  });

  it("PUT with wrong content-type / tagging, or a GET link used for PUT → 403, nothing written", async () => {
    const k = testKey();
    const url = await h.driver.presignPut(k, "image/png", 60, { tagging: "a=b" });
    const put = (u: string, headers: Record<string, string>) => h.fetcher(u, { method: "PUT", body: PNG, headers });
    expect((await put(url, { "content-type": "text/html", "x-amz-tagging": "a=b" })).status).toBe(403);
    expect((await put(url, { "content-type": "image/png", "x-amz-tagging": "a=c" })).status).toBe(403);
    expect((await put(url, { "content-type": "image/png" })).status).toBe(403);
    expect((await put(await h.driver.presignGet(k, 60), { "content-type": "image/png" })).status).toBe(403);
    expect(await h.driver.head(k)).toBeNull();
  });

  it("expired PUT link → 403 (worker asks for a fresh URL)", async () => {
    const k = testKey();
    const url = await h.driver.presignPut(k, "image/png", 1);
    h.advance(2100);
    expect((await h.fetcher(url, { method: "PUT", body: PNG, headers: { "content-type": "image/png" } })).status).toBe(
      403,
    );
  });
});
