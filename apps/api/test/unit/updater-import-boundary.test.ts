/** The updater runs with the Docker socket: it must not pull in the API (env parsing, DB, secrets) by accident. */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../src/updater/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const IMPORT_RE =
  /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

describe("updater import boundary", () => {
  it("has source files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const f of files) {
    it(`${f} imports only node:*, ./* and @mtl/shared/update`, () => {
      const src = readFileSync(new URL(f, dir), "utf8");
      const specs = [...src.matchAll(IMPORT_RE)].map((m) => (m[1] ?? m[2] ?? m[3]) as string);
      const bad = specs.filter((s) => !(s.startsWith("node:") || s.startsWith("./") || s === "@mtl/shared/update"));
      expect(bad).toEqual([]);
    });
  }
});
