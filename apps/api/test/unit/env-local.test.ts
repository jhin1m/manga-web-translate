/** Chế độ local trong env: mặc định disk, bỏ yêu cầu GLOBAL_* ở production, ép tắt cờ nhiều người dùng; tắt = như cũ. */
import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/env.ts";

const base = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:8080",
  WEB_ORIGIN: "http://localhost:8080",
};

describe("env local mode", () => {
  it("accepts 1|true|0|false, off by default", () => {
    expect(parseEnv({ ...base, STORAGE_DRIVER: "disk" }).MTL_LOCAL_MODE).toBe(false);
    for (const v of ["1", "true"]) expect(parseEnv({ ...base, MTL_LOCAL_MODE: v }).MTL_LOCAL_MODE).toBe(true);
    for (const v of ["0", "false", ""])
      expect(parseEnv({ ...base, STORAGE_DRIVER: "disk", MTL_LOCAL_MODE: v }).MTL_LOCAL_MODE).toBe(false);
    expect(() => parseEnv({ ...base, MTL_LOCAL_MODE: "yes" })).toThrow();
  });

  it("local defaults: disk driver under MTL_DATA_DIR, no S3 needed", () => {
    const e = parseEnv({ ...base, MTL_LOCAL_MODE: "1" });
    expect(e.STORAGE_DRIVER).toBe("disk");
    expect(e.MTL_DATA_DIR).toBe("/data");
    expect(e.FILES_DIR).toBe("/data/files");
    expect(parseEnv({ ...base, MTL_LOCAL_MODE: "1", MTL_DATA_DIR: "/srv/mtl" }).FILES_DIR).toBe("/srv/mtl/files");
    expect(parseEnv({ ...base, MTL_LOCAL_MODE: "1", FILES_DIR: "/x" }).FILES_DIR).toBe("/x");
  });

  it("production + local does not require GLOBAL_* budgets; production alone still does", () => {
    expect(parseEnv({ ...base, NODE_ENV: "production", MTL_LOCAL_MODE: "1" }).NODE_ENV).toBe("production");
    expect(() => parseEnv({ ...base, NODE_ENV: "production", STORAGE_DRIVER: "disk" })).toThrow(/GLOBAL_DAILY_USD/);
  });

  it("forces multi-user features off (and does not fail their cross-checks)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = parseEnv({
      ...base,
      NODE_ENV: "production",
      MTL_LOCAL_MODE: "true",
      SIGNUP_ENABLED: "true",
      DISPATCHER_ENABLED: "true",
      ALERT_NTFY_URL: "https://ntfy.sh/x",
      ADMIN_EMAILS: "a@b.c",
      DEV_AUTO_LOGIN_EMAIL: "dev@example.com",
      DEV_AUTO_LOGIN_PASSWORD: "dev-password-1",
    });
    expect(e).toMatchObject({ SIGNUP_ENABLED: false, DISPATCHER_ENABLED: false, ADMIN_EMAILS: [] });
    expect(e.ALERT_NTFY_URL).toBeUndefined();
    expect(e.DEV_AUTO_LOGIN_EMAIL).toBeUndefined();
    expect(e.DEV_AUTO_LOGIN_PASSWORD).toBeUndefined();
    warn.mockRestore();
  });

  it("without local mode the old cross-checks still apply", () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: "disk", DISPATCHER_ENABLED: "true" })).toThrow(/MODAL_DRAIN/);
    expect(parseEnv({ ...base, STORAGE_DRIVER: "disk", ADMIN_EMAILS: "A@b.c" }).ADMIN_EMAILS).toEqual(["a@b.c"]);
  });

  it("MTL_ALLOWED_HOSTS is a lowercase csv list", () => {
    expect(
      parseEnv({ ...base, MTL_LOCAL_MODE: "1", MTL_ALLOWED_HOSTS: " NAS.local, ,box " }).MTL_ALLOWED_HOSTS,
    ).toEqual(["nas.local", "box"]);
    expect(parseEnv({ ...base, MTL_LOCAL_MODE: "1" }).MTL_ALLOWED_HOSTS).toEqual([]);
  });
});
