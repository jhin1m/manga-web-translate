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
  /** Phiên bản pipeline dùng tính input_rev lúc enqueue (khớp worker/mtl_worker PIPELINE_VERSION). */
  PIPELINE_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default("0.3.0"),
  /** Worker có pipeline_version thấp hơn → claim trả 426. */
  MIN_PIPELINE_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default("0.3.0"),
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
});
export type Env = z.infer<typeof Env>;

export const env: Env = Env.superRefine((e, ctx) => {
  if (e.NODE_ENV === "production" && (e.GLOBAL_DAILY_USD === undefined || e.GLOBAL_MONTHLY_USD === undefined)) {
    ctx.addIssue({ code: "custom", message: "production cần GLOBAL_DAILY_USD và GLOBAL_MONTHLY_USD" });
  }
  if (e.DISPATCHER_ENABLED && (!e.MODAL_DRAIN_URL || !e.MODAL_DRAIN_SECRET)) {
    ctx.addIssue({ code: "custom", message: "DISPATCHER_ENABLED cần MODAL_DRAIN_URL và MODAL_DRAIN_SECRET" });
  }
}).parse(process.env);
