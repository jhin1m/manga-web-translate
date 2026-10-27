import { testDatabaseUrl } from "@mtl/db/testing";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cờ đăng ký / hạn mức user cố định cho test (không lấy từ `.env` dev); test cần thì tự đặt `env.*`.
    env: { NODE_ENV: "test", DATABASE_URL: testDatabaseUrl("api"), SIGNUP_ENABLED: "false", USER_DAILY_USD: "" },
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/isolate-queue.ts"],
    // Hàng đợi/breaker/reaper là trạng thái toàn cục của DB test → chạy tuần tự từng file.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
