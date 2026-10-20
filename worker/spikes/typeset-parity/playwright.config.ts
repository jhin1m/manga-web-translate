import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "parity.spec.ts",
  reporter: "list",
  use: { browserName: "chromium", headless: true, deviceScaleFactor: 1 },
});
