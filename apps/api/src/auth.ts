import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db.ts";
import { env } from "./env.ts";

/** `signupEnabled` tách ra để test dựng được cả 2 cấu hình; app dùng `auth` theo env. */
export const createAuth = ({ signupEnabled = env.SIGNUP_ENABLED }: { signupEnabled?: boolean } = {}) =>
  betterAuth({
    appName: "mtl",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, { provider: "pg" }),
    advanced: {
      database: { generateId: "uuid" },
      // IP client cho rate limit: Caddy đặt X-Real-IP = {client_ip} (đã giải CF-Connecting-IP qua trusted_proxies
      // Cloudflare) — không đọc X-Forwarded-For do client tự gửi được.
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Tắt → better-auth chặn trước bước tra email (không lộ email đã tồn tại). `pnpm create-user` không qua HTTP.
      disableSignUp: !signupEnabled,
      // Email trùng trả phản hồi chung như đăng ký mới (không 422 riêng); web đăng nhập ngay sau khi đăng ký.
      autoSignIn: false,
    },
    // Mặc định better-auth chỉ bật rate limit ở production; mở đăng ký thì bật mọi nơi, sign-up 5 lần/giờ/IP.
    // Lưu bộ nhớ: API chạy 1 process. `/get-session` không giới hạn: chỉ đọc phiên từ cookie (không đoán được mật
    // khẩu hay token qua đây — không phải điểm brute-force), mỗi lần mở trang đều gọi; bộ đếm của better-auth chỉ về 0
    // sau ≥ 10s không gọi nên người dùng thao tác liên tục sẽ chạm 100 lần rồi bị 429 dù không làm gì sai.
    rateLimit: signupEnabled
      ? {
          enabled: true,
          storage: "memory",
          customRules: { "/sign-up/email": { window: 3600, max: 5 }, "/get-session": false },
        }
      : undefined,
    // Phiên sống 7 ngày, tự gia hạn khi dùng (mỗi ngày tối đa 1 lần) — đúng mặc định better-auth, ghi tường minh.
    session: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
    telemetry: { enabled: false },
  });

export const auth = createAuth();

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
