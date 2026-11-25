/** Thư mục file trong env: mặc định `${MTL_DATA_DIR}/files`; production (bản VPS) phải đặt rõ thư mục bền. */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/env.ts";
import { DEFAULT_DATA_DIR } from "../../src/local/local-secrets.ts";

const base = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:8787",
  WEB_ORIGIN: "http://localhost:5173",
};
const budgets = { GLOBAL_DAILY_USD: "10", GLOBAL_MONTHLY_USD: "100" };

describe("env files dir", () => {
  it("defaults to <repo>/.data/files; MTL_DATA_DIR and FILES_DIR override", () => {
    // Test nằm cùng độ sâu với src/local/ → cùng gốc repo.
    expect(DEFAULT_DATA_DIR).toBe(fileURLToPath(new URL("../../../../.data", import.meta.url)));
    expect(parseEnv(base).FILES_DIR).toBe(join(DEFAULT_DATA_DIR, "files"));
    expect(parseEnv({ ...base, MTL_DATA_DIR: "/srv/mtl" }).FILES_DIR).toBe("/srv/mtl/files");
    expect(parseEnv({ ...base, FILES_DIR: "/tmp/f" }).FILES_DIR).toBe("/tmp/f");
    expect(parseEnv({ ...base, FILES_DIR: "" }).FILES_DIR).toBe(join(DEFAULT_DATA_DIR, "files"));
  });

  it("production without local mode requires FILES_DIR or MTL_DATA_DIR", () => {
    expect(() => parseEnv({ ...base, ...budgets, NODE_ENV: "production" })).toThrow(/FILES_DIR/);
    expect(parseEnv({ ...base, ...budgets, NODE_ENV: "production", FILES_DIR: "/srv/f" }).FILES_DIR).toBe("/srv/f");
    expect(parseEnv({ ...base, ...budgets, NODE_ENV: "production", MTL_DATA_DIR: "/srv" }).FILES_DIR).toBe(
      "/srv/files",
    );
    expect(parseEnv({ ...base, NODE_ENV: "production", MTL_LOCAL_MODE: "1" }).FILES_DIR).toBe(
      join(DEFAULT_DATA_DIR, "files"),
    );
  });
});
