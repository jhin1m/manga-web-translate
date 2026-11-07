/** Dọn export của disk driver: chỉ xoá file trong `export/` quá hạn (+ sidecar) và file tạm > 24h. */
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupExpiredExports } from "../../src/jobs/export-cleanup.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7, 12);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mtl-export-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(rel: string, ageMs: number) {
  const p = join(root, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, "x");
  const t = new Date(NOW - ageMs);
  await utimes(p, t, t);
  return p;
}
const gone = async (p: string) =>
  stat(p).then(
    () => false,
    () => true,
  );

describe("cleanupExpiredExports", () => {
  it("deletes expired exports with their sidecar, keeps fresh ones and files outside export/", async () => {
    const oldZip = await put("u/a/ch/1/export/j1.zip", 8 * DAY);
    const oldMeta = await put("u/a/ch/1/export/j1.zip.meta.json", 8 * DAY);
    const fresh = await put("u/a/ch/1/export/j2.cbz", 1 * DAY);
    const page = await put("u/a/ch/1/p/0001/orig.png", 30 * DAY);
    const orphanMeta = await put("u/b/ch/2/export/gone.zip.meta.json", 9 * DAY);

    const r = await cleanupExpiredExports({ root, now: NOW, retentionMs: 7 * DAY });

    expect(r).toEqual({ exports: 1, tmp: 0 });
    expect(await gone(oldZip)).toBe(true);
    expect(await gone(oldMeta)).toBe(true);
    expect(await gone(orphanMeta)).toBe(true);
    expect(await gone(fresh)).toBe(false);
    expect(await gone(page)).toBe(false);
  });

  it("cleans temp files older than 24h only", async () => {
    const oldTmp = await put(".tmp/aaa", 25 * 3600_000);
    const newTmp = await put(".tmp/bbb", 3600_000);
    expect((await cleanupExpiredExports({ root, now: NOW, retentionMs: 7 * DAY })).tmp).toBe(1);
    expect(await gone(oldTmp)).toBe(true);
    expect(await gone(newTmp)).toBe(false);
  });

  it("skips symlinks and tolerates a missing tree", async () => {
    const target = await put("outside/keep.zip", 30 * DAY);
    await mkdir(join(root, "u/a/ch/1/export"), { recursive: true });
    await symlink(target, join(root, "u/a/ch/1/export/link.zip"));
    expect(await cleanupExpiredExports({ root, now: NOW, retentionMs: 7 * DAY })).toEqual({ exports: 0, tmp: 0 });
    expect(await gone(target)).toBe(false);
    expect(await cleanupExpiredExports({ root: join(root, "nope"), now: NOW, retentionMs: DAY })).toEqual({
      exports: 0,
      tmp: 0,
    });
  });
});
