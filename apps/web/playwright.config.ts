import { defineConfig, devices } from "@playwright/test";
import { API_URL, E2E_ENV, WEB_PORT, WEB_URL } from "./e2e/env.ts";

/** E2E: API (DB e2e riêng) + Vite dev; worker giả lập chạy trong test, gọi đúng giao thức HTTP có fencing. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  // Màn ≥ 24" (owner chốt): màn chương hiện rail công cụ + panel rộng 560px + canvas + cột trang mà vẫn còn chỗ.
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 },
  },
  webServer: [
    {
      command: "pnpm --filter @mtl/api exec tsx src/index.ts",
      // 401 cũng tính là "đã lên" (Playwright chấp nhận 2xx–403).
      url: `${API_URL}/api/me/workspaces`,
      env: { ...E2E_ENV, NODE_ENV: "development" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      env: { API_PORT: E2E_ENV.API_PORT },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
