import { join } from "node:path";
import { loadRootEnv } from "@mtl/db";
import { z } from "zod";
import { applyLocalEnvDefaults, DEFAULT_DATA_DIR, localModeRequested } from "./local/local-secrets.ts";

loadRootEnv();

/** Biến để trống trong .env (`KEY=`) = không đặt (không coerce "" thành 0). */
const blank = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);
const optionalUsd = blank(z.coerce.number().nonnegative().optional());
const flag = blank(z.enum(["true", "false"]).default("false")).transform((v) => v === "true");
/** Cờ chế độ local: nhận cả `1|0` (compose/docker quen dùng). */
const flag01 = blank(z.enum(["1", "true", "0", "false"]).default("false")).transform((v) => v === "1" || v === "true");
/** Như `flag01` nhưng mặc định bật. */
const flag01On = blank(z.enum(["1", "true", "0", "false"]).default("true")).transform((v) => v === "1" || v === "true");

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    API_PORT: z.coerce.number().int().default(8787),
    /**
     * Thư mục lưu file (ảnh, font, export) trên đĩa; link `/files/…` ký HMAC do chính API phục vụ.
     * Không đặt = `${MTL_DATA_DIR}/files`. Production (bản VPS) bắt buộc đặt FILES_DIR hoặc MTL_DATA_DIR.
     */
    FILES_DIR: blank(z.string().min(1).optional()),
    /**
     * Self-host 1 người dùng: không đăng nhập (user local cố định là admin), secret tự sinh ở `${MTL_DATA_DIR}/secrets`,
     * app tự backup + migrate DB lúc khởi động. Tắt đăng ký / dispatcher / ntfy / dev login.
     * KHÔNG mở ra mạng: mọi request đi qua local-guard (Host + Origin).
     */
    MTL_LOCAL_MODE: flag01,
    /**
     * Thư mục dữ liệu (files; chế độ local thêm secrets, backups, worker token). Không đặt = `<gốc repo>/.data`
     * (dev chạy `pnpm dev`); image Docker đặt sẵn `/data`.
     */
    MTL_DATA_DIR: blank(z.string().min(1).default(DEFAULT_DATA_DIR)),
    /** Thoát hiểm: bỏ bước pg_dump trước migrate lúc khởi động (khi pg_dump hỏng mà vẫn cần chạy app). */
    MTL_SKIP_BOOT_BACKUP: flag01,
    /** Hostname thêm (csv, không cổng) được phép gọi API ở chế độ local — ngoài localhost/127.0.0.1/[::1]/app. */
    MTL_ALLOWED_HOSTS: blank(z.string().optional()).transform((v) =>
      (v ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
    /** Phiên bản app, image đặt sẵn (release). Không phải semver (kể cả "dev") = bản dev: không kiểm bản mới. */
    MTL_VERSION: blank(z.string().default("dev")),
    /** Tắt = không bao giờ hỏi GitHub về bản mới (riêng tư mạng). Mặc định bật. */
    MTL_UPDATE_CHECK: flag01On,
    /** Chỉ cho người phát hành: thay kết quả GitHub bằng phiên bản này (cho phép đích prerelease). Không phải semver thì bỏ qua. */
    MTL_UPDATE_TARGET: blank(z.string().optional()),
    /** Tag image mà compose truyền vào; khác `latest` nghĩa là người dùng đang ghim phiên bản. */
    MTL_TAG: blank(z.string().optional()),
    /** `0` = bản cài không có service `updater`: app không gọi nó (mặc định bật, compose truyền xuống). */
    MTL_UPDATER: flag01On,
    /** Thư mục build SPA (apps/web/dist) — đặt thì API phục vụ luôn web (cùng origin). */
    SPA_DIR: blank(z.string().min(1).optional()),
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
     * 0.4.2: export pages[].skipped. 0.5.1: translate/export inputs.fonts (font tuỳ chỉnh của người dùng).
     * 0.6.0: payload có cài đặt pipeline (page.prepare.pipeline, page.reinpaint.inpaint, page.ocr_region.ocr_engine).
     * 0.7.0: chapter.translate theo lô — payload/result `carry` (ngữ cảnh chuyền giữa các job lô).
     * 0.7.1: TextBox.valign — schema input export của worker cũ (additionalProperties: false) từ chối state có valign → job export fail.
     * 0.8.0: Region.style + settings.thought_font/note_font — schema input/output của worker cũ (additionalProperties: false) từ chối.
     * 0.9.0: page.reinpaint.auto_text_bbox (OCR vùng tự xoá chữ gốc) — worker cũ đòi user_mask_key/user_mask → fail.
     * 0.10.0: payload `llm` + claim `llm` (key AI theo job), `model_tier` optional — schema worker cũ từ chối cả hai.
     * 0.12.0: chapter.ingest inputs sources[].trim (cắt mép ảnh gốc) — schema worker cũ từ chối trường lạ → job ingest fail.
     */
    MIN_PIPELINE_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .default("0.12.0"),
    /**
     * Kill-switch ngân sách toàn cục (USD, cộng usage_ledger.cost_usd mọi người dùng + chi phí nền tảng, ngày/tháng
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
    /**
     * Mở đăng ký email/mật khẩu (POST /api/auth/sign-up/email). Mặc định tắt mọi môi trường; bật thì bắt buộc
     * GLOBAL_DAILY_USD + USER_DAILY_USD (bất kể NODE_ENV). Tắt → chỉ `pnpm create-user` tạo được tài khoản.
     */
    SIGNUP_ENABLED: flag,
    /**
     * Hạn mức chi phí mỗi người dùng mỗi ngày UTC (USD, mọi chi phí của user: LLM + GPU). Vượt → endpoint LLM 402,
     * job LLM fail `quota_exceeded`. 0 = chặn mọi job LLM; không đặt = không giới hạn.
     */
    USER_DAILY_USD: optionalUsd,
    /**
     * Email quản trị (phân tách bằng dấu phẩy, không phân biệt hoa thường). Chỉ những tài khoản này vào được
     * /api/admin/*; đăng ký qua web bằng các email này luôn bị từ chối — admin chỉ tạo bằng `pnpm create-user`.
     */
    ADMIN_EMAILS: blank(z.string().optional()).transform((v) =>
      (v ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
    /**
     * Khoá chính (32 byte base64, `openssl rand -base64 32`) mã hoá key provider AI trong DB (AES-256-GCM). Không đặt =
     * không lưu / đổi được key provider. Mất hoặc đổi khoá = nhập lại key từng provider trên UI.
     */
    SECRETS_KEY: blank(
      z
        .string()
        .regex(/^[A-Za-z0-9+/]{43}=$/)
        .refine((v) => Buffer.from(v, "base64").length === 32, "SECRETS_KEY phải giải mã ra đúng 32 byte")
        .optional(),
    ),
    /** Chỉ dev: tài khoản SPA tự đăng nhập (POST /api/dev/auto-login). Đặt ở production → API không khởi động. */
    DEV_AUTO_LOGIN_EMAIL: blank(z.string().email().optional()),
    DEV_AUTO_LOGIN_PASSWORD: blank(z.string().min(10).optional()),
  })
  .transform((e) => {
    const base = {
      ...e,
      FILES_DIR: e.FILES_DIR ?? join(e.MTL_DATA_DIR, "files"),
    };
    return e.MTL_LOCAL_MODE ? forceLocalOff(base) : base;
  });
export type Env = z.infer<typeof Env>;

/** Biến bị chế độ local ép tắt — cảnh báo 1 lần/process nếu người dùng có đặt (tránh "đặt mà không ăn"). */
let warnedLocalOverrides = false;

function forceLocalOff<
  T extends {
    SIGNUP_ENABLED: boolean;
    DISPATCHER_ENABLED: boolean;
    ALERT_NTFY_URL?: string;
    ADMIN_EMAILS: string[];
    DEV_AUTO_LOGIN_EMAIL?: string;
    DEV_AUTO_LOGIN_PASSWORD?: string;
  },
>(e: T): T {
  const ignored = [
    e.SIGNUP_ENABLED && "SIGNUP_ENABLED",
    e.DISPATCHER_ENABLED && "DISPATCHER_ENABLED",
    e.ALERT_NTFY_URL && "ALERT_NTFY_URL",
    e.ADMIN_EMAILS.length > 0 && "ADMIN_EMAILS",
    (e.DEV_AUTO_LOGIN_EMAIL || e.DEV_AUTO_LOGIN_PASSWORD) && "DEV_AUTO_LOGIN_*",
  ].filter(Boolean);
  if (ignored.length > 0 && !warnedLocalOverrides) {
    warnedLocalOverrides = true;
    console.warn(`[env] MTL_LOCAL_MODE bỏ qua: ${ignored.join(", ")}`);
  }
  return {
    ...e,
    SIGNUP_ENABLED: false,
    DISPATCHER_ENABLED: false,
    ALERT_NTFY_URL: undefined,
    ADMIN_EMAILS: [],
    DEV_AUTO_LOGIN_EMAIL: undefined,
    DEV_AUTO_LOGIN_PASSWORD: undefined,
  };
}

/** Parse + kiểm chéo biến môi trường (thuần, test gọi trực tiếp). */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  return Env.superRefine((e, ctx) => {
    // Mặc định `<gốc repo>/.data` nằm trong thư mục release của bản VPS (bị xoá khi dọn release) → bắt đặt rõ.
    if (e.NODE_ENV === "production" && !e.MTL_LOCAL_MODE && !raw.FILES_DIR && !raw.MTL_DATA_DIR) {
      ctx.addIssue({ code: "custom", message: "production cần FILES_DIR (thư mục file bền, ngoài thư mục release)" });
    }
    // Local: 1 người dùng tự trả tiền AI bằng key của mình → không bắt kill-switch ngân sách toàn cục.
    if (
      e.NODE_ENV === "production" &&
      !e.MTL_LOCAL_MODE &&
      (e.GLOBAL_DAILY_USD === undefined || e.GLOBAL_MONTHLY_USD === undefined)
    ) {
      ctx.addIssue({ code: "custom", message: "production cần GLOBAL_DAILY_USD và GLOBAL_MONTHLY_USD" });
    }
    if (e.DISPATCHER_ENABLED && (!e.MODAL_DRAIN_URL || !e.MODAL_DRAIN_SECRET)) {
      ctx.addIssue({ code: "custom", message: "DISPATCHER_ENABLED cần MODAL_DRAIN_URL và MODAL_DRAIN_SECRET" });
    }
    if (e.SIGNUP_ENABLED && (e.GLOBAL_DAILY_USD === undefined || e.USER_DAILY_USD === undefined)) {
      ctx.addIssue({ code: "custom", message: "SIGNUP_ENABLED=true cần GLOBAL_DAILY_USD và USER_DAILY_USD" });
    }
    if (e.NODE_ENV === "production" && (e.DEV_AUTO_LOGIN_EMAIL || e.DEV_AUTO_LOGIN_PASSWORD)) {
      ctx.addIssue({ code: "custom", message: "DEV_AUTO_LOGIN_* chỉ dùng ở dev — bỏ khỏi môi trường production" });
    }
  }).parse(raw);
}

// Chế độ local: sinh/đọc secret + mặc định URL trước khi parse (biến bắt buộc phải có sẵn lúc parse).
if (localModeRequested(process.env)) applyLocalEnvDefaults(process.env);

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
