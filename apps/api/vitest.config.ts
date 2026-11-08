import { testDatabaseUrl } from "@mtl/db/testing";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cờ đăng ký / hạn mức user cố định cho test (không lấy từ `.env` dev); test cần thì tự đặt `env.*`.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl("api"),
      SIGNUP_ENABLED: "false",
      USER_DAILY_USD: "",
      // Ngân sách toàn hệ thống cũng cố định rỗng: usage dồn qua các file test trong cùng DB sẽ vượt ngưỡng
      // của `.env` (CI chép `.env.example` → GLOBAL_DAILY_USD=10) → kill-switch chặn mọi lượt claim.
      GLOBAL_DAILY_USD: "",
      GLOBAL_MONTHLY_USD: "",
      ADMIN_EMAILS: "",
      // Khoá cố định cho test mã hoá key provider (không lấy từ `.env` dev).
      SECRETS_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    },
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/isolate-queue.ts"],
    // Hàng đợi/breaker/reaper là trạng thái toàn cục của DB test → chạy tuần tự từng file.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
