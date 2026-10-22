import { loadRootEnv } from "@mtl/db";
import { z } from "zod";

loadRootEnv();

/** Biến để trống trong .env (`KEY=`) = không đặt (không coerce "" thành 0). */
const blank = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);
const optionalUsd = blank(z.coerce.number().nonnegative().optional());
const flag = blank(z.enum(["true", "false"]).default("false")).transform((v) => v === "true");

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  API_PORT: z.coerce.number().int().default(8787),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  /** Domain file riêng trình duyệt thấy (dev: localhost:9100, prod: files.<domain>). */
  FILES_DOMAIN: z.string().min(1),
  FILES_SCHEME: z.enum(["http", "https"]).default("https"),
  /**
   * Muối input_rev lúc enqueue: chỉ tăng khi cùng input mà worker cho kết quả khác (tăng = chạy lại mọi job, tốn AI).
   * Có thể thấp hơn worker PIPELINE_VERSION khi worker chỉ tăng để chặn bản cũ qua MIN_PIPELINE_VERSION.
   */
  PIPELINE_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default("0.4.0"),
  /**
   * Worker có pipeline_version thấp hơn → claim trả 426. 0.4.1: worker hiểu settings.narration_font.
   * 0.4.2: export pages[].skipped.
   */
  MIN_PIPELINE_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default("0.4.2"),
  /**
   * Kill-switch ngân sách toàn cục (USD, cộng usage_ledger.cost_usd mọi workspace + chi phí nền tảng, ngày/tháng
   * theo UTC). Bắt buộc ở production; 0 = chặn mọi job tốn tiền. Không đặt (dev/test) = không giới hạn.
   */
  GLOBAL_DAILY_USD: optionalUsd,
  GLOBAL_MONTHLY_USD: optionalUsd,
  /** Dispatcher Modal trong `mtl-jobs`; false → chỉ worker Mac (rollback). */
  DISPATCHER_ENABLED: flag,
  /** Web endpoint `drain` của worker/modal_app.py; body ký HMAC-SHA256 bằng MODAL_DRAIN_SECRET. */
  MODAL_DRAIN_URL: blank(z.string().url().optional()),
  MODAL_DRAIN_SECRET: blank(z.string().min(32).optional()),
  /** Khớp `max_containers` / `scaledown_window` / `timeout` của function Modal (ước lượng GPU rỗi khi bị kill). */
  MODAL_MAX_CONTAINERS: blank(z.coerce.number().int().positive().default(2)),
  MODAL_SCALEDOWN_S: blank(z.coerce.number().int().positive().default(60)),
  MODAL_MAX_LIFETIME_S: blank(z.coerce.number().int().positive().default(3600)),
  /** Kênh cảnh báo duy nhất: topic ntfy (VD https://ntfy.sh/<topic-bí-mật>). Không đặt → chỉ log. */
  ALERT_NTFY_URL: blank(z.string().url().optional()),
  /** Chỉ dev: tài khoản SPA tự đăng nhập (POST /api/dev/auto-login). Đặt ở production → API không khởi động. */
  DEV_AUTO_LOGIN_EMAIL: blank(z.string().email().optional()),
  DEV_AUTO_LOGIN_PASSWORD: blank(z.string().min(10).optional()),
});
export type Env = z.infer<typeof Env>;

/** Parse + kiểm chéo biến môi trường (thuần, test gọi trực tiếp). */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  return Env.superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && (e.GLOBAL_DAILY_USD === undefined || e.GLOBAL_MONTHLY_USD === undefined)) {
      ctx.addIssue({ code: "custom", message: "production cần GLOBAL_DAILY_USD và GLOBAL_MONTHLY_USD" });
    }
    if (e.DISPATCHER_ENABLED && (!e.MODAL_DRAIN_URL || !e.MODAL_DRAIN_SECRET)) {
      ctx.addIssue({ code: "custom", message: "DISPATCHER_ENABLED cần MODAL_DRAIN_URL và MODAL_DRAIN_SECRET" });
    }
    if (e.NODE_ENV === "production" && (e.DEV_AUTO_LOGIN_EMAIL || e.DEV_AUTO_LOGIN_PASSWORD)) {
      ctx.addIssue({ code: "custom", message: "DEV_AUTO_LOGIN_* chỉ dùng ở dev — bỏ khỏi môi trường production" });
    }
  }).parse(raw);
}

export const env: Env = parseEnv(process.env);

/**
 * Dev auto-login bật khi và chỉ khi: NODE_ENV=development (mặc định khi không đặt, nên thêm guard host) + đủ
 * email/mật khẩu + BETTER_AUTH_URL trỏ localhost.
 */
export const devAutoLoginEnabled = (e: Env): boolean =>
  e.NODE_ENV === "development" &&
  !!e.DEV_AUTO_LOGIN_EMAIL &&
  !!e.DEV_AUTO_LOGIN_PASSWORD &&
  ["localhost", "127.0.0.1"].includes(new URL(e.BETTER_AUTH_URL).hostname);
