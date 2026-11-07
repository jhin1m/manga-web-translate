/** Tích hợp MinIO qua domain file riêng (infra/docker-compose.dev.yml phải đang chạy). */
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { head, presignGet, presignPost, presignPut, readPrefix } from "../src/storage.ts";
import { PNG, postUpload, runStorageContract, testKey } from "./storage-contract.ts";

const fetcher = (url: string, init?: RequestInit) => fetch(url, init);

runStorageContract("s3", () => ({
  presignPost,
  presignGet,
  presignPut,
  head,
  readPrefix,
  fetcher,
  expire: () => sleep(2100),
}));

describe("storage presign (s3 specifics)", () => {
  it("signs against FILES_DOMAIN, not the internal endpoint", async () => {
    const post = await presignPost(testKey(), "image/png", 1024, 60);
    expect(new URL(post.url).host).toBe(env.FILES_DOMAIN);
    expect(new URL(await presignGet(testKey(), 60)).host).toBe(env.FILES_DOMAIN);
  });

  it("unsigned path-style GET through the files proxy → 403 with nosniff", async () => {
    const k = testKey();
    await postUpload({ fetcher }, await presignPost(k, "image/png", 1024, 60), PNG, "image/png");
    const unsigned = await fetch(`${env.FILES_SCHEME}://${env.FILES_DOMAIN}/${env.S3_BUCKET}/${k}`);
    expect(unsigned.status).toBe(403);
    expect(unsigned.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
