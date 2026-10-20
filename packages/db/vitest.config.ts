import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./src/testing.ts";

const url = testDatabaseUrl("db");

export default defineConfig({
  test: {
    env: { DATABASE_URL: url },
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 20_000,
  },
});
