/** Giữ N bản backup mới nhất + bản mới nhất của các schema gần nhất; file không đúng mẫu tên không bị đụng. */
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_RE, backupName, backupStamp, pruneBackups, STALE_TMP_MS } from "../../src/local/boot-backup.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mtl-backups-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const touch = async (names: string[]) => {
  for (const n of names) await writeFile(join(dir, n), "x");
};
const day = (d: number) => `mtl-202611${String(d).padStart(2, "0")}T000000Z`;

describe("boot backup", () => {
  it("names dumps by UTC stamp + applied migration count", () => {
    const d = new Date("2026-11-07T13:20:05.123Z");
    expect(backupStamp(d)).toBe("20261107T132005Z");
    expect(backupName(d, 26)).toBe("mtl-20261107T132005Z-m26.dump");
    expect(BACKUP_RE.test(backupName(d, 26))).toBe(true);
  });

  it("same schema: keeps the 5 newest and ignores unrelated files", async () => {
    const backups = Array.from({ length: 7 }, (_, i) => `${day(i + 1)}-m26.dump`);
    const others = ["notes.txt", "mtl-latest.dump", "mtl-20261101T000000Z.dump", ".mtl-20261101T000000Z-m26.dump.tmp"];
    await touch([...backups, ...others]);

    expect(await pruneBackups(dir, 5)).toEqual(backups.slice(0, 2));
    expect((await readdir(dir)).sort()).toEqual([...backups.slice(2), ...others].sort());
  });

  it("restarts after an upgrade never rotate out the newest pre-upgrade dump", async () => {
    // 1 bản m25 (trước nâng cấp), rồi 8 lần restart ở m26.
    const pre = `${day(1)}-m25.dump`;
    const after = Array.from({ length: 8 }, (_, i) => `${day(i + 2)}-m26.dump`);
    await touch([pre, ...after]);

    const dropped = await pruneBackups(dir, 5);

    expect(dropped).toEqual(after.slice(0, 3));
    expect(await readdir(dir)).toContain(pre);
  });

  it("only the 3 most recent schema versions are pinned", async () => {
    const names = [`${day(1)}-m21.dump`, `${day(2)}-m22.dump`, `${day(3)}-m23.dump`, `${day(4)}-m24.dump`];
    await touch(names);
    expect(await pruneBackups(dir, 1)).toEqual([`${day(1)}-m21.dump`]);
  });

  it("removes orphaned pg_dump temp files only once they are stale", async () => {
    const stale = ".mtl-20261101T000000Z-m26.dump.tmp";
    const fresh = ".mtl-20261107T000000Z-m26.dump.tmp";
    await touch([stale, fresh, `${day(1)}-m26.dump`]);
    const old = new Date(Date.now() - STALE_TMP_MS - 60_000);
    await utimes(join(dir, stale), old, old);

    expect(await pruneBackups(dir, 5)).toEqual([stale]);
    expect((await readdir(dir)).sort()).toEqual([fresh, `${day(1)}-m26.dump`].sort());
  });

  it("does nothing when under the limit", async () => {
    await touch([`${day(1)}-m26.dump`]);
    expect(await pruneBackups(dir, 5)).toEqual([]);
  });
});
