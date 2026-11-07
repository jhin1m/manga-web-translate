/**
 * Hợp đồng hành vi chung của mọi driver lưu file (S3/MinIO và đĩa): cùng bộ kiểm chạy cho cả 2 → disk driver hành
 * xử như MinIO ở mọi chỗ web/worker dựa vào (policy POST, link GET có hạn, PUT có header ký).
 */
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import type { HeadResult, PresignedPost, StorageDriver } from "../src/storage-drivers/types.ts";
import { MAX_GET_TTL_S } from "../src/storage-drivers/types.ts";

export type ContractTarget = Pick<
  StorageDriver,
  "presignPost" | "presignGet" | "presignPut" | "head" | "readPrefix"
> & {
  /** Gọi link presign (URL tuyệt đối với S3, tương đối `/files/…` với disk). */
  fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  /** Làm mọi link TTL 1s đã ký hết hạn (S3: chờ thật; disk: tua đồng hồ). */
  expire: () => Promise<void>;
};

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(0)]);
export const testKey = (ext = "png") => `u/test/ch/test/src/${uuidv7()}.${ext}`;

/** Gửi như web (`upload-queue.ts`): `fields` rồi `file`; `contentType` cho phép giả mạo field Content-Type. */
export function postUpload(
  t: Pick<ContractTarget, "fetcher">,
  post: PresignedPost,
  body: Uint8Array,
  contentType: string,
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields)) form.append(k, k === "Content-Type" ? contentType : v);
  form.append("file", new Blob([body], { type: contentType }));
  return t.fetcher(post.url, { method: "POST", body: form });
}

const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());

export function runStorageContract(name: string, setup: () => ContractTarget) {
  describe(`storage contract: ${name}`, () => {
    const t = setup();
    const headOf = (k: string): Promise<HeadResult | null> => t.head(k);

    it("accepts a valid upload; head/readPrefix see it", async () => {
      const k = testKey();
      const res = await postUpload(t, await t.presignPost(k, "image/png", PNG.length, 60), PNG, "image/png");
      expect(res.status, await res.text()).toBe(204);
      expect(await headOf(k)).toMatchObject({ bytes: PNG.length, contentType: "image/png" });
      expect([...(await t.readPrefix(k, 8))]).toEqual([...PNG.slice(0, 8)]);
    });

    it("rejects a file larger than maxBytes", async () => {
      const k = testKey();
      const res = await postUpload(t, await t.presignPost(k, "image/png", 16, 60), PNG, "image/png");
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await headOf(k)).toBeNull();
    });

    it("rejects a Content-Type different from the policy", async () => {
      const k = testKey();
      const res = await postUpload(t, await t.presignPost(k, "image/png", 1024, 60), PNG, "text/html");
      expect(res.status).toBe(403);
      expect(await headOf(k)).toBeNull();
    });

    it("signed GET → 200 with bytes, content-disposition and nosniff", async () => {
      const k = testKey();
      await postUpload(t, await t.presignPost(k, "image/png", 1024, 60), PNG, "image/png");
      const get = await t.fetcher(await t.presignGet(k, 60, 'attachment; filename="a.png"'));
      expect(get.status).toBe(200);
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
      expect(get.headers.get("content-disposition")).toBe('attachment; filename="a.png"');
      expect([...(await bytesOf(get))]).toEqual([...PNG]);
    });

    it("unsigned GET → 403 with nosniff; expired signed GET → 403", async () => {
      const k = testKey();
      await postUpload(t, await t.presignPost(k, "image/png", 1024, 60), PNG, "image/png");
      const signed = await t.presignGet(k, 1);
      const unsigned = await t.fetcher(signed.split("?")[0] ?? signed);
      expect(unsigned.status).toBe(403);
      expect(unsigned.headers.get("x-content-type-options")).toBe("nosniff");

      await t.expire();
      expect((await t.fetcher(signed)).status).toBe(403);
    });

    it("expired presigned POST is rejected", async () => {
      const k = testKey();
      const post = await t.presignPost(k, "image/png", 1024, 1);
      await t.expire();
      expect((await postUpload(t, post, PNG, "image/png")).status).toBe(403);
      expect(await headOf(k)).toBeNull();
    });

    it("enforces TTL ceilings", async () => {
      expect(() => t.presignGet(testKey(), MAX_GET_TTL_S + 1)).toThrow(RangeError);
      expect(() => t.presignPut(testKey(), "image/png", 121)).toThrow(RangeError);
      await expect(t.presignPost(testKey(), "image/png", 1, 3600)).rejects.toThrow(RangeError);
    });

    it("presigned PUT (content-type + tagging) writes the object; GET returns the same bytes", async () => {
      const k = testKey();
      const tagging = "kind=worker-output";
      const url = await t.presignPut(k, "image/png", 60, { tagging });
      const put = await t.fetcher(url, {
        method: "PUT",
        body: PNG,
        headers: { "content-type": "image/png", "x-amz-tagging": tagging },
      });
      expect(put.status, await put.text()).toBe(200);
      expect(await headOf(k)).toMatchObject({ bytes: PNG.length, contentType: "image/png" });
      const get = await t.fetcher(await t.presignGet(k, 60));
      expect([...(await bytesOf(get))]).toEqual([...PNG]);
    });
  });
}
