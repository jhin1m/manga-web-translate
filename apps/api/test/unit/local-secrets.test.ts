/** Secret tự sinh của chế độ local: sinh 1 lần (0600), đọc lại ổn định, không ghi đè file/biến có sẵn. */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEnv } from "../../src/env.ts";
import { applyLocalEnvDefaults, localModeRequested, readOrCreateSecret } from "../../src/local/local-secrets.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mtl-secrets-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = (extra: Record<string, string | undefined> = {}) => {
  const raw: Record<string, string | undefined> = { MTL_LOCAL_MODE: "1", MTL_DATA_DIR: dir, ...extra };
  applyLocalEnvDefaults(raw);
  return raw;
};

describe("local secrets", () => {
  it("detects the raw flag like the schema does", () => {
    expect(localModeRequested({ MTL_LOCAL_MODE: "1" })).toBe(true);
    expect(localModeRequested({ MTL_LOCAL_MODE: "true" })).toBe(true);
    expect(localModeRequested({ MTL_LOCAL_MODE: "0" })).toBe(false);
    expect(localModeRequested({})).toBe(false);
  });

  it("generates both secrets as 0600 files in a 0700 dir; second run reads the same values", async () => {
    const a = run();
    const b = run();
    expect(a.BETTER_AUTH_SECRET).toBe(b.BETTER_AUTH_SECRET);
    expect(a.SECRETS_KEY).toBe(b.SECRETS_KEY);
    for (const f of ["better-auth-secret", "secrets-key"]) {
      expect((await stat(join(dir, "secrets", f))).mode & 0o777).toBe(0o600);
    }
    expect((await stat(join(dir, "secrets"))).mode & 0o777).toBe(0o700);
    expect((await readFile(join(dir, "secrets", "secrets-key"), "utf8")).trim()).toBe(a.SECRETS_KEY);
  });

  it("generated values pass the env schema (SECRETS_KEY = 32 bytes base64, auth secret ≥ 32 chars)", () => {
    const raw = run({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" });
    const e = parseEnv(raw);
    expect(Buffer.from(e.SECRETS_KEY ?? "", "base64")).toHaveLength(32);
    expect(e.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(e.BETTER_AUTH_URL).toBe("http://localhost:8080");
    expect(e.WEB_ORIGIN).toBe("http://localhost:8080");
    expect(e.API_PORT).toBe(8080);
  });

  it("never overwrites an existing file", async () => {
    const p = join(dir, "s");
    await writeFile(p, "keep-me\n");
    expect(readOrCreateSecret(p, () => "new")).toBe("keep-me");
    expect(await readFile(p, "utf8")).toBe("keep-me\n");
  });

  it("variables already set win over files and are not written to disk", async () => {
    const raw = run({ BETTER_AUTH_SECRET: "y".repeat(40), API_PORT: "9999", WEB_ORIGIN: "http://box:1" });
    expect(raw.BETTER_AUTH_SECRET).toBe("y".repeat(40));
    expect(raw.API_PORT).toBe("9999");
    expect(raw.WEB_ORIGIN).toBe("http://box:1");
    await expect(stat(join(dir, "secrets", "better-auth-secret"))).rejects.toThrow();
    // Biến rỗng (`KEY=`) = chưa đặt → vẫn sinh.
    expect(run({ SECRETS_KEY: "" }).SECRETS_KEY).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });
});
