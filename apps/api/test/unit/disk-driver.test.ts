/** Disk driver: bộ contract chung (như MinIO) + case riêng của đĩa (traversal, ghi atomic, sidecar, xoá/chép). */
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG, postUpload, runStorageContract, testKey } from "../storage-contract.ts";
import { createDiskHarness, type DiskHarness } from "./disk-test-harness.ts";

const h: DiskHarness = await createDiskHarness();

runStorageContract("disk", () => ({
  presignPost: h.driver.presignPost,
  presignGet: h.driver.presignGet,
  presignPut: h.driver.presignPut,
  head: h.driver.head,
  readPrefix: h.driver.readPrefix,
  fetcher: h.fetcher,
  expire: async () => h.advance(2100),
}));

async function uploaded(key = testKey(), body = PNG, ct = "image/png") {
  const res = await postUpload(h, await h.driver.presignPost(key, ct, 1 << 20, 60), body, ct);
  expect(res.status).toBe(204);
  return key;
}

describe("disk driver specifics", () => {
  it("rejects traversal / malformed keys in library calls", async () => {
    for (const bad of ["../x", "a//b", "/abs", "a/./b", "a/../b", "x.meta.json", ".tmp/x", "a/b%2e", ""]) {
      expect(() => h.driver.resolveKey(bad), bad).toThrow(RangeError);
    }
    expect(() => h.driver.presignGet("../etc/passwd", 60)).toThrow(RangeError);
    expect(await h.driver.head("a/../../x")).toBeNull();
    expect(await h.driver.head("u/a/x.meta.json")).toBeNull();
    await expect(h.driver.deletePrefix("/")).rejects.toThrow(RangeError);
  });

  it("writes atomically (no leftovers in .tmp) and stores content type in a sidecar", async () => {
    const k = await uploaded();
    expect(await readdir(join(h.root, ".tmp"))).toEqual([]);
    expect(await readdir(join(h.root, k, ".."))).toContain(`${k.split("/").at(-1)}.meta.json`);
    expect(await h.driver.head(k)).toMatchObject({
      bytes: PNG.length,
      contentType: "image/png",
      etag: expect.any(String),
    });
  });

  it("writeAtomic leaves no orphaned sidecar when the data commit fails", async () => {
    const k = testKey();
    // Đích là thư mục không rỗng → rename dữ liệu lỗi sau khi sidecar đã commit.
    await mkdir(join(h.driver.resolveKey(k), "child"), { recursive: true });
    await expect(h.driver.writeAtomic(k, new Uint8Array([1]), "image/png")).rejects.toThrow();
    const name = k.split("/").at(-1);
    expect(await readdir(join(h.root, k, ".."))).not.toContain(`${name}.meta.json`);
    expect(await readdir(join(h.root, ".tmp"))).toEqual([]);
  });

  it("copyObject keeps the content type; deleteObject is idempotent", async () => {
    const from = await uploaded(testKey("webp"), PNG, "image/webp");
    const to = `u/test/copy/${from.split("/").at(-1)}`;
    await h.driver.copyObject(from, to);
    expect(await h.driver.head(to)).toMatchObject({ bytes: PNG.length, contentType: "image/webp" });
    expect([...(await h.driver.readObject(to))]).toEqual([...PNG]);
    await h.driver.deleteObject(to);
    await h.driver.deleteObject(to);
    expect(await h.driver.head(to)).toBeNull();
  });

  it("deletePrefix counts data files (not sidecars) and removes the tree", async () => {
    const base = `u/del-${Date.now()}/`;
    await uploaded(`${base}a.png`);
    await uploaded(`${base}sub/b.png`);
    expect(await h.driver.deletePrefix(base)).toBe(2);
    expect(await h.driver.head(`${base}a.png`)).toBeNull();
    expect(await h.driver.deletePrefix(base)).toBe(0);
    await expect(h.driver.deletePrefix("u/x")).rejects.toThrow(RangeError);
  });

  it("objectTags is empty; bucketReachable true for a writable root", async () => {
    expect(await h.driver.objectTags(testKey())).toEqual({});
    expect(await h.driver.bucketReachable()).toBe(true);
  });
});
