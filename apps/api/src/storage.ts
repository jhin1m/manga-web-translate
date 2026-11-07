/**
 * Storage private — facade chọn driver theo `STORAGE_DRIVER` lúc khởi động:
 * - `s3` (mặc định, bản VPS): MinIO/S3, xem storage-drivers/s3-driver.ts.
 * - `disk` (self-host): file trên đĩa + link `/files/…` ký HMAC, xem storage-drivers/disk-driver.ts + routes/files.ts.
 * Tên/chữ ký các hàm export giữ nguyên → caller không biết đang chạy driver nào.
 */
import { env } from "./env.ts";
import { createDiskDriver, type DiskDriver } from "./storage-drivers/disk-driver.ts";
import { deriveFilesKey } from "./storage-drivers/file-signing.ts";
import { createS3Driver } from "./storage-drivers/s3-driver.ts";
import type { StorageDriver } from "./storage-drivers/types.ts";

export {
  EXPORT_GET_TTL_S,
  type HeadResult,
  MAX_GET_TTL_S,
  MAX_POST_TTL_S,
  MAX_PUT_TTL_S,
  type PresignedPost,
} from "./storage-drivers/types.ts";

/** superRefine trong env.ts đã bắt buộc các biến này khi driver = s3; kiểm lại để TS có kiểu string. */
const required = (name: string, v: string | undefined): string => {
  if (!v) throw new Error(`STORAGE_DRIVER=s3 cần ${name}`);
  return v;
};

const disk: DiskDriver | null =
  env.STORAGE_DRIVER === "disk"
    ? createDiskDriver({ root: env.FILES_DIR, signingKey: deriveFilesKey(env.BETTER_AUTH_SECRET) })
    : null;

const driver: StorageDriver =
  disk ??
  createS3Driver({
    endpoint: required("S3_ENDPOINT", env.S3_ENDPOINT),
    region: env.S3_REGION,
    bucket: required("S3_BUCKET", env.S3_BUCKET),
    accessKey: required("S3_ACCESS_KEY", env.S3_ACCESS_KEY),
    secretKey: required("S3_SECRET_KEY", env.S3_SECRET_KEY),
    filesScheme: env.FILES_SCHEME,
    filesDomain: required("FILES_DOMAIN", env.FILES_DOMAIN),
  });

/** Driver đĩa đang dùng (để `app.ts` mount `/files`); null khi chạy S3. */
export const diskDriver = (): DiskDriver | null => disk;

export const {
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
} = driver;
