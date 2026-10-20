import { testDatabaseUrl } from "@mtl/db/testing";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { NODE_ENV: "test", DATABASE_URL: testDatabaseUrl("api") },
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
