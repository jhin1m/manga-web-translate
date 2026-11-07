/** Chặn hạ cấp: DB đã áp migration mới hơn journal của image → lỗi rõ ràng kèm hướng dẫn; còn lại cho migrate. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJournal, SchemaNewerThanImageError, schemaDowngradeError } from "../../src/local/schema-guard.ts";

const image = { count: 26, lastWhen: 1_793_780_673_823 };

describe("schema downgrade guard", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("fresh DB (no migrations table yet) → no error", () => {
    expect(schemaDowngradeError(null, image)).toBeNull();
  });

  it("DB at the same or an older schema → no error (migrate applies the rest)", () => {
    expect(schemaDowngradeError({ count: 26, lastCreatedAt: image.lastWhen }, image)).toBeNull();
    expect(schemaDowngradeError({ count: 20, lastCreatedAt: image.lastWhen - 1 }, image)).toBeNull();
  });

  it("DB migrated by a newer release → clear error naming both schema versions and the way out", () => {
    const err = schemaDowngradeError({ count: 29, lastCreatedAt: image.lastWhen + 1 }, image);
    expect(err).toBeInstanceOf(SchemaNewerThanImageError);
    expect(err?.message).toContain("m29");
    expect(err?.message).toContain("m26");
    expect(err?.message).toContain("MTL_TAG");
    expect(err?.message).toContain("N ≤ 26");
  });

  it("reads the journal shipped with the image", async () => {
    const shipped = await readJournal();
    expect(shipped.count).toBeGreaterThan(0);
    expect(shipped.lastWhen).toBeGreaterThan(0);

    dir = await mkdtemp(join(tmpdir(), "mtl-journal-"));
    await mkdir(join(dir, "meta"));
    await writeFile(
      join(dir, "meta", "_journal.json"),
      JSON.stringify({ entries: [{ when: 5 }, { when: 9 }, { when: 7 }] }),
    );
    expect(await readJournal(dir)).toEqual({ count: 3, lastWhen: 9 });
  });
});
