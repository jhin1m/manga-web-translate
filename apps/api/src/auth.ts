import { user } from "@mtl/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { isSignupOpen } from "./lib/system-settings.ts";
import { isAdminEmail } from "./middleware/admin.ts";

const defaultIsSignupEnabled = () => isSignupOpen(db);

/**
 * `isSignupEnabled` đọc trạng thái đăng ký MỖI request (admin đổi trên UI có hiệu lực ngay, không restart); mặc định =
 * DB ?? env và phải đủ 2 hạn mức. Lỗi đọc DB → 500 (fail-closed). `rateLimitEnabled` tách ra vì test dùng chung bộ
 * đếm bộ nhớ cấp module: mặc định tắt khi NODE_ENV=test, ca cần kiểm rate limit tự bật + IP riêng.
 */
export const createAuth = ({
  isSignupEnabled = defaultIsSignupEnabled,
  rateLimitEnabled = env.NODE_ENV !== "test",
}: {
  isSignupEnabled?: () => Promise<boolean>;
  rateLimitEnabled?: boolean;
} = {}) =>
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
      // Đăng ký bật/tắt runtime ở hooks.before (không dùng `disableSignUp` — cờ tĩnh lúc dựng).
      // Email trùng trả phản hồi chung như đăng ký mới (không 422 riêng); web đăng nhập ngay sau khi đăng ký.
      autoSignIn: false,
    },
    // Rate limit bật ở dev/production (mặc định better-auth chỉ production), sign-up 5 lần/giờ/IP, `/sign-in*` theo luật
    // mặc định (3 lần/10s). Lưu bộ nhớ: API chạy 1 process. `/get-session` không giới hạn: chỉ đọc phiên từ cookie
    // (không đoán được mật khẩu hay token qua đây — không phải điểm brute-force), mỗi lần mở trang đều gọi; bộ đếm của
    // better-auth chỉ về 0 sau ≥ 10s không gọi nên người dùng thao tác liên tục sẽ chạm 100 lần rồi bị 429 dù không làm
    // gì sai.
    rateLimit: {
      enabled: rateLimitEnabled,
      storage: "memory",
      customRules: { "/sign-up/email": { window: 3600, max: 5 }, "/get-session": false },
    },
    hooks: {
      // Chặn đăng ký TRƯỚC handler (không tra email → không lộ email tồn tại; phản hồi y hệt cho mọi email):
      // - đăng ký đang tắt (DB ?? env, thiếu hạn mức cũng coi là tắt);
      // - email thuộc ADMIN_EMAILS, kể cả khi đăng ký đang bật: chưa có tài khoản thì ai đăng ký trước sẽ thành
      //   admin; admin tạo bằng `pnpm create-user` (không qua HTTP).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (isAdminEmail(email) || !(await isSignupEnabled())) {
          throw new APIError("BAD_REQUEST", {
            message: "Email and password sign up is not enabled",
            code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
          });
        }
      }),
    },
    // Cờ khoá tài khoản: `AuthSession["user"]` phải có field này để `requireUser` kiểm. `input: false` — client không tự đặt.
    user: { additionalFields: { disabledAt: { type: "date", required: false, input: false } } },
    databaseHooks: {
      session: {
        create: {
          // Fail-closed: tra DB trực tiếp (không dựa `ctx`) trước khi tạo phiên; lỗi DB → đăng nhập thất bại.
          // `pnpm create-user` chỉ tạo user + account, không tạo phiên nên không đi qua hook này.
          before: async (session) => {
            const [row] = await db
              .select({ disabledAt: user.disabledAt })
              .from(user)
              .where(eq(user.id, session.userId));
            if (row?.disabledAt) {
              throw new APIError("FORBIDDEN", { message: "Account disabled", code: "USER_DISABLED" });
            }
          },
        },
      },
    },
    // Phiên sống 7 ngày, tự gia hạn khi dùng (mỗi ngày tối đa 1 lần) — đúng mặc định better-auth, ghi tường minh.
    // KHÔNG bật `cookieCache`: bật thì tài khoản bị khoá còn dùng được tới hết `maxAge` của cache.
    session: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
    telemetry: { enabled: false },
  });

export const auth = createAuth();

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
