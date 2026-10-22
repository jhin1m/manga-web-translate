/**
 * Storage private (MinIO/S3). Hai client:
 * - `internal`: API gọi thẳng S3_ENDPOINT (HEAD, đọc magic bytes) — không lộ ra trình duyệt.
 * - `publicSigner`: chỉ để KÝ URL theo FILES_DOMAIN (domain file riêng, proxy thêm nosniff);
 *   chữ ký SigV4 gắn với host nên URL phải ký đúng host trình duyệt sẽ gọi.
 */
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.ts";

/** Trần TTL (red team #12): xem ảnh ≤ 15', tải export ≤ 5' (caller tự chọn ttl thấp hơn). */
export const MAX_GET_TTL_S = 15 * 60;
export const EXPORT_GET_TTL_S = 5 * 60;
export const MAX_POST_TTL_S = 15 * 60;

const credentials = { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY };
const common = { region: env.S3_REGION, credentials, forcePathStyle: true } as const;

const internal = new S3Client({ ...common, endpoint: env.S3_ENDPOINT });
const publicSigner = new S3Client({ ...common, endpoint: `${env.FILES_SCHEME}://${env.FILES_DOMAIN}` });
const Bucket = env.S3_BUCKET;

export type PresignedPost = { url: string; fields: Record<string, string>; expiresAt: string };

/**
 * Presigned POST cho upload người dùng: dung lượng trong [1, maxBytes] và Content-Type cố định —
 * MinIO kiểm policy, sai thì từ chối (không tin kiểm tra ở browser).
 */
export async function presignPost(
  key: string,
  contentType: string,
  maxBytes: number,
  ttlSeconds: number,
): Promise<PresignedPost> {
  if (ttlSeconds <= 0 || ttlSeconds > MAX_POST_TTL_S) throw new RangeError(`POST ttl must be 1..${MAX_POST_TTL_S}s`);
  if (maxBytes < 1) throw new RangeError("maxBytes must be ≥ 1");
  const { url, fields } = await createPresignedPost(publicSigner, {
    Bucket,
    Key: key,
    Expires: ttlSeconds,
    Fields: { "Content-Type": contentType },
    Conditions: [
      ["content-length-range", 1, maxBytes],
      ["eq", "$Content-Type", contentType],
    ],
  });
  return { url, fields, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}

/** Presigned GET TTL ngắn; `disposition` (VD `attachment; filename="x.zip"`) ép header tải về. */
export function presignGet(key: string, ttlSeconds: number, disposition?: string): Promise<string> {
  if (ttlSeconds <= 0 || ttlSeconds > MAX_GET_TTL_S) throw new RangeError(`GET ttl must be 1..${MAX_GET_TTL_S}s`);
  const cmd = new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition });
  return getSignedUrl(publicSigner, cmd, { expiresIn: ttlSeconds });
}

/** Trần TTL presigned PUT cho output worker; caller còn phải giới hạn ≤ thời gian lease còn lại. */
export const MAX_PUT_TTL_S = 120;

/**
 * Presigned PUT (worker ghi output vào key bất biến); Content-Type cố định nằm trong chữ ký. `tagging`
 * (`k=v&k2=v2`) giữ ở dạng header ký (`x-amz-tagging`, không đưa lên query) → worker phải gửi đúng header,
 * lifecycle MinIO lọc theo tag này.
 */
export function presignPut(
  key: string,
  contentType: string,
  ttlSeconds: number,
  opts: { tagging?: string } = {},
): Promise<string> {
  if (ttlSeconds <= 0 || ttlSeconds > MAX_PUT_TTL_S) throw new RangeError(`PUT ttl must be 1..${MAX_PUT_TTL_S}s`);
  const cmd = new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, Tagging: opts.tagging });
  return getSignedUrl(publicSigner, cmd, {
    expiresIn: ttlSeconds,
    ...(opts.tagging ? { unhoistableHeaders: new Set(["x-amz-tagging"]) } : {}),
  });
}

/** Tag của object (kiểm lifecycle trong test). */
export async function objectTags(key: string): Promise<Record<string, string>> {
  const r = await internal.send(new GetObjectTaggingCommand({ Bucket, Key: key }));
  return Object.fromEntries((r.TagSet ?? []).map((t) => [t.Key ?? "", t.Value ?? ""]));
}

export type HeadResult = { bytes: number; contentType: string | undefined; etag: string | undefined };

/** Metadata object; null nếu không tồn tại. */
export async function head(key: string): Promise<HeadResult | null> {
  try {
    const r = await internal.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { bytes: r.ContentLength ?? 0, contentType: r.ContentType, etag: r.ETag };
  } catch (err) {
    if (err instanceof NotFound || err instanceof NoSuchKey) return null;
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** Đọc n byte đầu (magic bytes) bằng Range — không tải cả file. */
export async function readPrefix(key: string, n: number): Promise<Uint8Array> {
  if (n < 1) throw new RangeError("n must be ≥ 1");
  const r = await internal.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${n - 1}` }));
  const bytes = await r.Body?.transformToByteArray();
  return bytes ?? new Uint8Array();
}

/** Chép object trong bucket (server-side, không tải về). */
export async function copyObject(from: string, to: string): Promise<void> {
  const source = `${Bucket}/${from}`.split("/").map(encodeURIComponent).join("/");
  await internal.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: source }));
}

/** Xoá 1 object (không có cũng không lỗi). */
export async function deleteObject(key: string): Promise<void> {
  await internal.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
}

/** Xoá mọi object dưới `prefix` (theo trang 1000 key — trần của ListObjectsV2/DeleteObjects). Trả số key đã xoá. */
export async function deletePrefix(prefix: string): Promise<number> {
  if (!prefix.endsWith("/")) throw new RangeError("prefix must end with /");
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await internal.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (keys.length > 0) {
      await internal.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

/** healthz: bucket tới được bằng credential của API. */
export async function bucketReachable(): Promise<boolean> {
  try {
    await internal.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(3_000) });
    return true;
  } catch {
    return false;
  }
}
