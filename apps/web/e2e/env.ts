import { fileURLToPath } from "node:url";

/** API e2e chạy cổng riêng; SPA dùng cổng dev 5180 (khớp WEB_ORIGIN mà MinIO dev cho phép CORS). */
export const API_PORT = 8797;
export const WEB_PORT = 5180;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

/** DB riêng cho e2e (tên phải chứa "test" — resetTestDatabase từ chối DB khác). */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://mtl:mtl@localhost:5442/mtl_test_e2e";

export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  API_PORT: String(API_PORT),
  BETTER_AUTH_URL: WEB_URL,
  WEB_ORIGIN: WEB_URL,
  // Không để DEV_AUTO_LOGIN_* của .env dev lọt vào API e2e (loadRootEnv chỉ nạp biến chưa đặt).
  DEV_AUTO_LOGIN_EMAIL: "",
  DEV_AUTO_LOGIN_PASSWORD: "",
};

export const STATE_FILE = fileURLToPath(new URL("./.state.json", import.meta.url));

export type E2EState = { workspaceId: string; seriesId: string; email: string; password: string; token: string };
