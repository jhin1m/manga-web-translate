import { Hono } from "hono";
import { auth } from "../auth.ts";

export type DevLogin = { email: string; password: string };

/**
 * Chỉ dev: SPA gọi khi chưa có phiên → đăng nhập bằng tài khoản cấu hình sẵn. Trả nguyên Response của
 * better-auth (Set-Cookie phiên). Chỉ mount khi `devAutoLoginEnabled(env)` (xem app.ts).
 */
export function devAuthRoutes(login: DevLogin) {
  console.warn(`[dev] auto-login enabled for ${login.email}`);
  return new Hono().post("/dev/auto-login", (c) =>
    auth.api.signInEmail({ body: login, headers: c.req.raw.headers, asResponse: true }),
  );
}
