import { fileURLToPath } from "node:url";

/**
 * Cổng riêng cho e2e, không đụng `pnpm dev` (5180/8787) → chạy song song được. SPA e2e phải là origin MinIO dev cho
 * phép CORS (infra/docker-compose.dev.yml: 5180 + 5181). Đổi qua E2E_WEB_PORT / E2E_API_PORT.
 */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8797);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5181);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

/** DB riêng cho e2e (tên phải chứa "test" — resetTestDatabase từ chối DB khác). */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://mtl:mtl@localhost:5442/mtl_test_e2e";

/** Owner seed (seed.ts) — cũng là tài khoản dev auto-login của API e2e. */
export const E2E_OWNER = { email: "owner-e2e@example.com", password: "e2e-password-123" };

export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  API_PORT: String(API_PORT),
  BETTER_AUTH_URL: WEB_URL,
  WEB_ORIGIN: WEB_URL,
  // Dev auto-login = owner seed (ghi đè DEV_AUTO_LOGIN_* của .env dev; loadRootEnv chỉ nạp biến chưa đặt).
  DEV_AUTO_LOGIN_EMAIL: E2E_OWNER.email,
  DEV_AUTO_LOGIN_PASSWORD: E2E_OWNER.password,
};

export const STATE_FILE = fileURLToPath(new URL("./.state.json", import.meta.url));

export type E2EState = { workspaceId: string; seriesId: string; email: string; password: string; token: string };
