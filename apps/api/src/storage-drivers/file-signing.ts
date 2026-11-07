/**
 * Chữ ký HMAC cho link `/files/<key>?…` của disk driver (thay presigned URL của S3). Mọi tham số ảnh hưởng hành vi
 * (method, key, hạn, Content-Type, trần dung lượng, tag, Content-Disposition) nằm trong chữ ký → không sửa được trên URL.
 * Không import env: khoá truyền vào (unit test không cần env).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type FileSigParams = {
  /** HEAD ký như GET. */
  method: "GET" | "PUT" | "POST";
  key: string;
  /** Hạn (unix giây). */
  exp: number;
  ct?: string;
  max?: number;
  tag?: string;
  cd?: string;
};

/** Khoá ký dẫn xuất từ BETTER_AUTH_SECRET (không thêm secret riêng; đổi secret = mọi link cũ hết hiệu lực). */
export function deriveFilesKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("mtl-files-v1").digest();
}

/**
 * Thứ tự cố định, mọi trường luôn có mặt (trống = ""), nối bằng `\n`. Trường chứa `\n` bị từ chối khi ký → không dời
 * được nội dung giữa các trường (VD nhét max vào ct) để dùng lại chữ ký.
 */
const canonical = (p: FileSigParams): string =>
  [p.method, p.key, String(p.exp), p.ct ?? "", p.max === undefined ? "" : String(p.max), p.tag ?? "", p.cd ?? ""].join(
    "\n",
  );

const hasNewline = (p: FileSigParams): boolean => [p.key, p.ct, p.tag, p.cd].some((v) => v?.includes("\n"));

export function signFileUrl(p: FileSigParams, k: Buffer): string {
  if (hasNewline(p)) throw new RangeError("signed field contains newline");
  return createHmac("sha256", k).update(canonical(p)).digest("hex");
}

/** Sai chữ ký, sig sai độ dài/không phải hex, trường chứa `\n`, hoặc `exp <= nowS` → false (không ném). */
export function verifyFileSig(p: FileSigParams, sig: string, k: Buffer, nowS: number): boolean {
  if (!Number.isSafeInteger(p.exp) || p.exp <= nowS || hasNewline(p)) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = Buffer.from(signFileUrl(p, k), "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
