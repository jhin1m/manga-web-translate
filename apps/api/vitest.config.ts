import { testDatabaseUrl } from "@mtl/db/testing";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { NODE_ENV: "test", DATABASE_URL: testDatabaseUrl("api") },
    globalSetup: ["./test/global-setup.ts"],
    // Hàng đợi/breaker/reaper là trạng thái toàn cục của DB test → chạy tuần tự từng file.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
