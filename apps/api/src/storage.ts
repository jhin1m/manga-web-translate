/**
 * Storage private: file trên đĩa (`FILES_DIR`) + link `/files/…` ký HMAC do chính API phục vụ, xem
 * storage-drivers/disk-driver.ts + routes/files.ts. Caller chỉ dùng các hàm export dưới đây.
 */
import { env } from "./env.ts";
import { createDiskDriver, type DiskDriver } from "./storage-drivers/disk-driver.ts";
import { deriveFilesKey } from "./storage-drivers/file-signing.ts";

export {
  EXPORT_GET_TTL_S,
  type HeadResult,
  MAX_GET_TTL_S,
  MAX_POST_TTL_S,
  MAX_PUT_TTL_S,
  type PresignedPost,
} from "./storage-drivers/types.ts";

const disk: DiskDriver = createDiskDriver({
  root: env.FILES_DIR,
  signingKey: deriveFilesKey(env.BETTER_AUTH_SECRET),
});

/** Driver đang dùng (để `app.ts` mount `/files`). */
export const diskDriver = (): DiskDriver => disk;

export const {
  presignPost,
  presignGet,
  presignPut,
  head,
  readPrefix,
  readObject,
  putObject,
  copyObject,
  deleteObject,
  deletePrefix,
  bucketReachable,
} = disk;
