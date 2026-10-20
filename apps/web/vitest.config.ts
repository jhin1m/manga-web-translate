import { defineConfig } from "vitest/config";

// Unit test trong src; e2e/ chạy bằng Playwright (`pnpm e2e`).
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
