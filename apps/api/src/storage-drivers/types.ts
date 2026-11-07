/**
 * Hợp đồng chung của driver lưu file (S3/MinIO hoặc đĩa). `storage.ts` chọn 1 driver lúc khởi động và re-export các
 * hàm này với nguyên tên/chữ ký cũ → caller không biết đang chạy driver nào.
 */

/** Trần TTL (red team #12): xem ảnh ≤ 15', tải export ≤ 5' (caller tự chọn ttl thấp hơn). */
export const MAX_GET_TTL_S = 15 * 60;
export const EXPORT_GET_TTL_S = 5 * 60;
export const MAX_POST_TTL_S = 15 * 60;
/** Trần TTL presigned PUT cho output worker; caller còn phải giới hạn ≤ thời gian lease còn lại. */
export const MAX_PUT_TTL_S = 120;

export type PresignedPost = { url: string; fields: Record<string, string>; expiresAt: string };

export type HeadResult = { bytes: number; contentType: string | undefined; etag: string | undefined };

export interface StorageDriver {
  /** Upload người dùng: dung lượng trong [1, maxBytes], Content-Type cố định — server lưu trữ kiểm, không tin browser. */
  presignPost(key: string, contentType: string, maxBytes: number, ttlSeconds: number): Promise<PresignedPost>;
  /** GET TTL ngắn; `disposition` (VD `attachment; filename="x.zip"`) ép header tải về. Trần TTL ném RangeError đồng bộ. */
  presignGet(key: string, ttlSeconds: number, disposition?: string): Promise<string>;
  /** PUT cho output worker; Content-Type (+ `x-amz-tagging` nếu có) nằm trong chữ ký → worker phải gửi đúng header. */
  presignPut(key: string, contentType: string, ttlSeconds: number, opts?: { tagging?: string }): Promise<string>;
  objectTags(key: string): Promise<Record<string, string>>;
  /** Metadata object; null nếu không tồn tại. */
  head(key: string): Promise<HeadResult | null>;
  /** Đọc n byte đầu (magic bytes) — không tải cả file. */
  readPrefix(key: string, n: number): Promise<Uint8Array>;
  /** Đọc cả object vào bộ nhớ (chỉ cho file nhỏ đã kiểm kích thước bằng `head`). */
  readObject(key: string): Promise<Uint8Array>;
  copyObject(from: string, to: string): Promise<void>;
  /** Xoá 1 object (không có cũng không lỗi). */
  deleteObject(key: string): Promise<void>;
  /** Xoá mọi object dưới `prefix` (phải kết thúc `/`). Trả số object đã xoá. */
  deletePrefix(prefix: string): Promise<number>;
  /** healthz: nơi lưu trữ tới được / ghi được. */
  bucketReachable(): Promise<boolean>;
}

export function checkTtl(kind: "GET" | "POST" | "PUT", ttlSeconds: number): void {
  const max = kind === "GET" ? MAX_GET_TTL_S : kind === "POST" ? MAX_POST_TTL_S : MAX_PUT_TTL_S;
  if (ttlSeconds <= 0 || ttlSeconds > max) throw new RangeError(`${kind} ttl must be 1..${max}s`);
}
