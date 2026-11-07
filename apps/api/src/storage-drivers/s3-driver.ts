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
import { checkTtl, type HeadResult, type PresignedPost, type StorageDriver } from "./types.ts";

export type S3DriverConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  filesScheme: "http" | "https";
  filesDomain: string;
};

export function createS3Driver(cfg: S3DriverConfig): StorageDriver {
  const credentials = { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey };
  const common = { region: cfg.region, credentials, forcePathStyle: true } as const;

  const internal = new S3Client({ ...common, endpoint: cfg.endpoint });
  const publicSigner = new S3Client({ ...common, endpoint: `${cfg.filesScheme}://${cfg.filesDomain}` });
  const Bucket = cfg.bucket;

  /** MinIO kiểm policy POST (dung lượng + Content-Type), sai thì từ chối. */
  async function presignPost(
    key: string,
    contentType: string,
    maxBytes: number,
    ttlSeconds: number,
  ): Promise<PresignedPost> {
    checkTtl("POST", ttlSeconds);
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

  function presignGet(key: string, ttlSeconds: number, disposition?: string): Promise<string> {
    checkTtl("GET", ttlSeconds);
    const cmd = new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition });
    return getSignedUrl(publicSigner, cmd, { expiresIn: ttlSeconds });
  }

  /**
   * `tagging` (`k=v&k2=v2`) giữ ở dạng header ký (`x-amz-tagging`, không đưa lên query) → worker phải gửi đúng
   * header, lifecycle MinIO lọc theo tag này.
   */
  function presignPut(
    key: string,
    contentType: string,
    ttlSeconds: number,
    opts: { tagging?: string } = {},
  ): Promise<string> {
    checkTtl("PUT", ttlSeconds);
    const cmd = new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, Tagging: opts.tagging });
    return getSignedUrl(publicSigner, cmd, {
      expiresIn: ttlSeconds,
      ...(opts.tagging ? { unhoistableHeaders: new Set(["x-amz-tagging"]) } : {}),
    });
  }

  /** Tag của object (kiểm lifecycle trong test). */
  async function objectTags(key: string): Promise<Record<string, string>> {
    const r = await internal.send(new GetObjectTaggingCommand({ Bucket, Key: key }));
    return Object.fromEntries((r.TagSet ?? []).map((t) => [t.Key ?? "", t.Value ?? ""]));
  }

  async function head(key: string): Promise<HeadResult | null> {
    try {
      const r = await internal.send(new HeadObjectCommand({ Bucket, Key: key }));
      return { bytes: r.ContentLength ?? 0, contentType: r.ContentType, etag: r.ETag };
    } catch (err) {
      if (err instanceof NotFound || err instanceof NoSuchKey) return null;
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  /** Đọc bằng Range — không tải cả file. */
  async function readPrefix(key: string, n: number): Promise<Uint8Array> {
    if (n < 1) throw new RangeError("n must be ≥ 1");
    const r = await internal.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${n - 1}` }));
    const bytes = await r.Body?.transformToByteArray();
    return bytes ?? new Uint8Array();
  }

  async function readObject(key: string): Promise<Uint8Array> {
    const r = await internal.send(new GetObjectCommand({ Bucket, Key: key }));
    return (await r.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  /** Chép object trong bucket (server-side, không tải về). */
  async function copyObject(from: string, to: string): Promise<void> {
    const source = `${Bucket}/${from}`.split("/").map(encodeURIComponent).join("/");
    await internal.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: source }));
  }

  async function deleteObject(key: string): Promise<void> {
    await internal.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
  }

  /** Theo trang 1000 key — trần của ListObjectsV2/DeleteObjects. */
  async function deletePrefix(prefix: string): Promise<number> {
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

  /** Bucket tới được bằng credential của API. */
  async function bucketReachable(): Promise<boolean> {
    try {
      await internal.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(3_000) });
      return true;
    } catch {
      return false;
    }
  }

  return {
    presignPost,
    presignGet,
    presignPut,
    objectTags,
    head,
    readPrefix,
    readObject,
    copyObject,
    deleteObject,
    deletePrefix,
    bucketReachable,
  };
}
