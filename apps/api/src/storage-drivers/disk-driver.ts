/**
 * Driver lưu file trên đĩa (`<root>/<key>`) cho bản self-host 1 người dùng (không MinIO). Link presign là
 * `/files/<key>?…` (tương đối, cùng origin với web) ký HMAC — route `routes/files.ts` phục vụ GET/HEAD/PUT/POST.
 *
 * - Content-Type lưu ở sidecar `<file>.meta.json` (xattr không portable trên bind mount macOS/Windows).
 * - Ghi atomic: `<root>/.tmp/<uuid>` rồi `rename` (cùng filesystem); sidecar rename TRƯỚC file data → đọc thấy data
 *   là đã có meta.
 * - Tag (`x-amz-tagging`) chỉ kiểm khớp chữ ký, không lưu: dọn file theo đường dẫn (export cleanup).
 * Không import env/db: cấu hình truyền vào factory (unit test không cần env).
 */
import { randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { type FileSigParams, signFileUrl, verifyFileSig } from "./file-signing.ts";
import { checkTtl, type HeadResult, type PresignedPost, type StorageDriver } from "./types.ts";

export type DiskDriverOptions = {
  root: string;
  signingKey: Buffer;
  /** Đồng hồ (ms) — test tua giờ để kiểm link hết hạn. */
  now?: () => number;
};

export type FileStat = { bytes: number; contentType: string | undefined; mtimeMs: number };
/** Khoảng byte, `end` tính cả (như header Range). */
export type ByteRange = { start: number; end: number };
export type WriteSource = Uint8Array | ReadableStream<Uint8Array> | null;

export interface DiskDriver extends StorageDriver {
  readonly root: string;
  /** Key → đường dẫn tuyệt đối trong root; key không hợp lệ (traversal, sidecar…) → RangeError. */
  resolveKey(key: string): string;
  /** Kiểm chữ ký link theo đồng hồ của driver. */
  verify(p: FileSigParams, sig: string): boolean;
  nowS(): number;
  stat(key: string): Promise<FileStat | null>;
  openRead(key: string, range?: ByteRange): ReadableStream<Uint8Array>;
  writeAtomic(key: string, source: WriteSource, contentType: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,1023}$/;
const META_SUFFIX = ".meta.json";

/** Key trên URL: mã hoá từng segment, giữ `/`. */
export const encodeKeyPath = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

const isNotFound = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export function createDiskDriver({ root: rootIn, signingKey, now = () => Date.now() }: DiskDriverOptions): DiskDriver {
  const root = resolve(rootIn);
  const tmpDir = join(root, ".tmp");
  const nowS = () => Math.floor(now() / 1000);

  function resolveKey(key: string): string {
    if (!KEY_RE.test(key)) throw new RangeError("invalid storage key");
    if (key.split("/").some((s) => s === "" || s === "." || s === "..")) throw new RangeError("invalid storage key");
    if (key.endsWith(META_SUFFIX)) throw new RangeError("invalid storage key");
    const abs = resolve(root, key);
    if (!abs.startsWith(root + sep)) throw new RangeError("invalid storage key");
    return abs;
  }

  /** `/files/<key>?<params>&sig=…` — chỉ đưa tham số có giá trị lên query; route đọc lại đúng các tham số này. */
  function signedUrl(p: FileSigParams, extra: Record<string, string> = {}): string {
    const q = new URLSearchParams(extra);
    q.set("exp", String(p.exp));
    if (p.ct !== undefined) q.set("ct", p.ct);
    if (p.max !== undefined) q.set("max", String(p.max));
    if (p.tag !== undefined) q.set("tag", p.tag);
    if (p.cd !== undefined) q.set("cd", p.cd);
    q.set("sig", signFileUrl(p, signingKey));
    return `/files/${encodeKeyPath(p.key)}?${q.toString()}`;
  }

  async function presignPost(
    key: string,
    contentType: string,
    maxBytes: number,
    ttlSeconds: number,
  ): Promise<PresignedPost> {
    checkTtl("POST", ttlSeconds);
    if (maxBytes < 1) throw new RangeError("maxBytes must be ≥ 1");
    resolveKey(key);
    const exp = nowS() + ttlSeconds;
    const url = signedUrl({ method: "POST", key, exp, ct: contentType, max: maxBytes }, { m: "POST" });
    return { url, fields: { "Content-Type": contentType }, expiresAt: new Date(exp * 1000).toISOString() };
  }

  function presignGet(key: string, ttlSeconds: number, disposition?: string): Promise<string> {
    checkTtl("GET", ttlSeconds);
    resolveKey(key);
    return Promise.resolve(signedUrl({ method: "GET", key, exp: nowS() + ttlSeconds, cd: disposition }));
  }

  function presignPut(
    key: string,
    contentType: string,
    ttlSeconds: number,
    opts: { tagging?: string } = {},
  ): Promise<string> {
    checkTtl("PUT", ttlSeconds);
    resolveKey(key);
    const p: FileSigParams = { method: "PUT", key, exp: nowS() + ttlSeconds, ct: contentType, tag: opts.tagging };
    return Promise.resolve(signedUrl(p, { m: "PUT" }));
  }

  async function readMeta(abs: string): Promise<string | undefined> {
    try {
      const meta = JSON.parse(await readFile(abs + META_SUFFIX, "utf8")) as { contentType?: unknown };
      return typeof meta.contentType === "string" ? meta.contentType : undefined;
    } catch {
      return undefined;
    }
  }

  /** Key không hợp lệ = không tồn tại (như S3 trả 404) → caller kiểm key người dùng gửi lên trả 4xx, không 500. */
  async function statFile(key: string): Promise<FileStat | null> {
    let abs: string;
    try {
      abs = resolveKey(key);
    } catch {
      return null;
    }
    try {
      const s = await stat(abs);
      if (!s.isFile()) return null;
      return { bytes: s.size, contentType: await readMeta(abs), mtimeMs: s.mtimeMs };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function head(key: string): Promise<HeadResult | null> {
    const s = await statFile(key);
    return s && { bytes: s.bytes, contentType: s.contentType, etag: `"${s.bytes}-${Math.trunc(s.mtimeMs)}"` };
  }

  async function readPrefix(key: string, n: number): Promise<Uint8Array> {
    if (n < 1) throw new RangeError("n must be ≥ 1");
    const fh = await open(resolveKey(key), "r");
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, 0);
      return new Uint8Array(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  }

  async function readObject(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(resolveKey(key)));
  }

  const tmpPath = () => join(tmpDir, randomUUID());

  /** Đặt file tạm vào đích (mkdir -p thư mục cha); lỗi → xoá file tạm. */
  async function commit(tmp: string, dest: string): Promise<void> {
    try {
      await mkdir(dirname(dest), { recursive: true });
      await rename(tmp, dest);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async function writeMeta(abs: string, contentType: string): Promise<void> {
    const tmp = tmpPath();
    await writeFile(tmp, JSON.stringify({ contentType }), { flag: "wx" });
    await commit(tmp, abs + META_SUFFIX);
  }

  async function writeAtomic(key: string, source: WriteSource, contentType: string): Promise<void> {
    const abs = resolveKey(key);
    await mkdir(tmpDir, { recursive: true });
    const tmp = tmpPath();
    try {
      if (source === null || source instanceof Uint8Array) {
        await writeFile(tmp, source ?? new Uint8Array(), { flag: "wx" });
      } else {
        await pipeline(
          Readable.fromWeb(source as WebReadableStream<Uint8Array>),
          createWriteStream(tmp, { flags: "wx" }),
        );
      }
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    try {
      await writeMeta(abs, contentType);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    await commit(tmp, abs);
  }

  function openRead(key: string, range?: ByteRange): ReadableStream<Uint8Array> {
    const s = createReadStream(resolveKey(key), range ? { start: range.start, end: range.end } : {});
    return Readable.toWeb(s) as ReadableStream<Uint8Array>;
  }

  async function copyObject(from: string, to: string): Promise<void> {
    const src = resolveKey(from);
    const dest = resolveKey(to);
    const contentType = await readMeta(src);
    await mkdir(tmpDir, { recursive: true });
    const tmp = tmpPath();
    try {
      await copyFile(src, tmp);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    if (contentType !== undefined) await writeMeta(dest, contentType);
    else await rm(dest + META_SUFFIX, { force: true });
    await commit(tmp, dest);
  }

  async function deleteObject(key: string): Promise<void> {
    const abs = resolveKey(key);
    await rm(abs, { force: true });
    await rm(abs + META_SUFFIX, { force: true });
  }

  async function deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith("/")) throw new RangeError("prefix must end with /");
    const dir = resolveKey(prefix.slice(0, -1));
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch (err) {
      if (isNotFound(err)) return 0;
      throw err;
    }
    const count = entries.filter((d) => d.isFile() && !d.name.endsWith(META_SUFFIX)).length;
    await rm(dir, { recursive: true, force: true });
    return count;
  }

  async function bucketReachable(): Promise<boolean> {
    try {
      await mkdir(tmpDir, { recursive: true });
      await access(root, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  return {
    root,
    resolveKey,
    verify: (p, sig) => verifyFileSig(p, sig, signingKey, nowS()),
    nowS,
    stat: statFile,
    openRead,
    writeAtomic,
    presignPost,
    presignGet,
    presignPut,
    objectTags: async (key) => {
      resolveKey(key);
      return {};
    },
    head,
    readPrefix,
    readObject,
    copyObject,
    deleteObject,
    deletePrefix,
    bucketReachable,
  };
}
