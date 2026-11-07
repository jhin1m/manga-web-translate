import { defineConfig } from "vitest/config";

/**
 * Unit test không cần Docker (không Postgres/MinIO, không globalSetup): disk driver, route `/files`, ký link, env.
 * `src/env.ts` parse process.env lúc import (env-storage.test) → cấp giá trị giả hợp lệ; không gì mở kết nối DB.
 */
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unit:unit@127.0.0.1:1/unit",
      BETTER_AUTH_SECRET: "unit-test-secret-unit-test-secret-0000",
      BETTER_AUTH_URL: "http://localhost:8787",
      WEB_ORIGIN: "http://localhost:5173",
      STORAGE_DRIVER: "disk",
      FILES_DIR: "/nonexistent-unit-files",
    },
  },
});
