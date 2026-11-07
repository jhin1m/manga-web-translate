/** Chọn driver lưu file trong env: bản VPS không đặt gì vẫn là s3 và vẫn bắt buộc đủ biến S3. */
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/env.ts";

const base = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:8787",
  WEB_ORIGIN: "http://localhost:5173",
};
const s3 = {
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "mtl",
  S3_ACCESS_KEY: "ak",
  S3_SECRET_KEY: "sk",
  FILES_DOMAIN: "localhost:9100",
};

describe("env storage driver", () => {
  it("defaults to s3 when nothing is set (VPS unchanged)", () => {
    const e = parseEnv({ ...base, ...s3 });
    expect(e.STORAGE_DRIVER).toBe("s3");
    expect(e.S3_BUCKET).toBe("mtl");
  });

  it("s3 driver (explicit or default) missing a variable → error naming it", () => {
    const { S3_BUCKET: _drop, ...noBucket } = s3;
    expect(() => parseEnv({ ...base, ...noBucket })).toThrow(/S3_BUCKET/);
    expect(() => parseEnv({ ...base, ...s3, STORAGE_DRIVER: "s3", FILES_DOMAIN: "" })).toThrow(/FILES_DOMAIN/);
  });

  it("disk driver needs no S3 variables; FILES_DIR defaults to /data/files", () => {
    const e = parseEnv({ ...base, STORAGE_DRIVER: "disk" });
    expect(e.STORAGE_DRIVER).toBe("disk");
    expect(e.FILES_DIR).toBe("/data/files");
    expect(parseEnv({ ...base, STORAGE_DRIVER: "disk", FILES_DIR: "/tmp/f" }).FILES_DIR).toBe("/tmp/f");
  });

  it("blank STORAGE_DRIVER = unset; unknown value rejected", () => {
    expect(parseEnv({ ...base, ...s3, STORAGE_DRIVER: "" }).STORAGE_DRIVER).toBe("s3");
    expect(() => parseEnv({ ...base, ...s3, STORAGE_DRIVER: "gcs" })).toThrow();
  });
});
