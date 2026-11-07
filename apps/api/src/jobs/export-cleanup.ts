/**
 * Dọn file export hết hạn của disk driver (S3 dùng lifecycle của bucket). Chạy trong `jobs` mỗi giờ khi
 * STORAGE_DRIVER=disk: xoá `root/u/<user>/ch/<chapter>/export/<file>` cũ hơn `retentionMs` (kèm sidecar `.meta.json`)
 * và file tạm `root/.tmp/*` cũ hơn 24h (ghi dở do process chết). Chỉ xoá file thường; symlink/thư mục bỏ qua.
 */
import type { Dirent } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const META_SUFFIX = ".meta.json";
export const TMP_RETENTION_MS = 24 * 3600_000;

async function dirents(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // chưa có / bị xoá giữa chừng
  }
}

async function subdirs(dir: string): Promise<string[]> {
  return (await dirents(dir)).filter((d) => d.isDirectory()).map((d) => join(dir, d.name));
}

/** mtime của file thường; không tồn tại / không phải file thường → null. */
async function fileMtime(path: string): Promise<number | null> {
  try {
    const st = await lstat(path);
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  return (await fileMtime(path)) !== null;
}

export async function cleanupExpiredExports({
  root,
  now = Date.now(),
  retentionMs,
}: {
  root: string;
  now?: number;
  retentionMs: number;
}): Promise<{ exports: number; tmp: number }> {
  const cutoff = now - retentionMs;
  let exports = 0;
  for (const userDir of await subdirs(join(root, "u"))) {
    for (const chDir of await subdirs(join(userDir, "ch"))) {
      const exportDir = join(chDir, "export");
      for (const d of await dirents(exportDir)) {
        if (!d.isFile()) continue;
        const path = join(exportDir, d.name);
        const mtime = await fileMtime(path);
        if (mtime === null || mtime >= cutoff) continue;
        if (d.name.endsWith(META_SUFFIX)) {
          // Sidecar mồ côi (file chính đã mất) → dọn; còn file chính thì xoá cùng file chính.
          if (!(await exists(path.slice(0, -META_SUFFIX.length)))) await rm(path, { force: true });
          continue;
        }
        await rm(path, { force: true });
        await rm(path + META_SUFFIX, { force: true });
        exports++;
      }
    }
  }

  let tmp = 0;
  const tmpDir = join(root, ".tmp");
  for (const d of await dirents(tmpDir)) {
    if (!d.isFile()) continue;
    const path = join(tmpDir, d.name);
    const mtime = await fileMtime(path);
    if (mtime === null || mtime >= now - TMP_RETENTION_MS) continue;
    await rm(path, { force: true });
    tmp++;
  }
  return { exports, tmp };
}
