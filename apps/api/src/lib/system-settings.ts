import { type DbLike, systemSettings } from "@mtl/db";
import { type AiSlots, type PipelineSettings, resolvePipelineSettings } from "@mtl/shared";
import { eq, sql } from "drizzle-orm";
import { env } from "../env.ts";

const ID = 1;

/** Hàng cài đặt hệ thống; thiếu hàng (DB mới reset) = undefined → mặc định. */
export async function readSystemSettings(t: DbLike) {
  const [row] = await t.select().from(systemSettings).where(eq(systemSettings.id, ID));
  return row;
}

/** Pipeline hệ thống (thiếu hàng / key → mặc định = hành vi cũ). */
export async function systemPipeline(t: DbLike): Promise<PipelineSettings> {
  return resolvePipelineSettings((await readSystemSettings(t))?.pipeline);
}

/**
 * Lưu đủ bộ pipeline (upsert, an toàn khi 2 admin lưu cùng lúc). Gộp vào jsonb cũ (`||`) thay vì ghi đè: key không còn
 * trong schema (cấp model hiệu đính `proofread_tier` của bản trước 0.10.0) được giữ để job hiệu đính chưa gán slot
 * vẫn dùng đúng cấp cũ.
 */
export async function saveSystemPipeline(t: DbLike, pipeline: PipelineSettings): Promise<PipelineSettings> {
  const [saved] = await t
    .insert(systemSettings)
    .values({ id: ID, pipeline })
    .onConflictDoUpdate({
      target: systemSettings.id,
      set: { pipeline: sql`${systemSettings.pipeline} || ${JSON.stringify(pipeline)}::jsonb`, updatedAt: sql`now()` },
    })
    .returning();
  return resolvePipelineSettings(saved?.pipeline);
}

/** 3 slot model AI (null = mặc định, theo env worker). */
export async function systemSlots(t: DbLike): Promise<AiSlots> {
  const row = await readSystemSettings(t);
  return {
    ocr: row?.ocrModelId ?? null,
    translate: row?.translateModelId ?? null,
    proofread: row?.proofreadModelId ?? null,
  };
}

/**
 * Khoá hàng cài đặt (tạo nếu thiếu) trong transaction của caller: tuần tự hoá đổi slot / xoá provider / model với
 * nhau (và với enqueue đọc slot `FOR SHARE`).
 */
export async function lockSystemSettings(t: DbLike): Promise<void> {
  await t.insert(systemSettings).values({ id: ID }).onConflictDoNothing();
  await t.select({ id: systemSettings.id }).from(systemSettings).where(eq(systemSettings.id, ID)).for("update");
}

/** Ghi đủ 3 slot (caller đã kiểm model tồn tại + vision). */
export async function saveSlots(t: DbLike, slots: AiSlots): Promise<AiSlots> {
  await t
    .update(systemSettings)
    .set({
      ocrModelId: slots.ocr,
      translateModelId: slots.translate,
      proofreadModelId: slots.proofread,
      updatedAt: sql`now()`,
    })
    .where(eq(systemSettings.id, ID));
  return systemSlots(t);
}

export type StoredLimits = {
  user_daily_usd: number | null;
  global_daily_usd: number | null;
  signup_enabled: boolean | null;
};
export type EffectiveLimits = {
  userDailyUsd: number | null;
  globalDailyUsd: number | null;
  signupEnabled: boolean;
  /** Đăng ký công khai mở thật sự: bật + đủ 2 hạn mức hiệu lực (khớp `/healthz.signup`). */
  signupOpen: boolean;
};

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** Giá trị lưu ở DB (`null` = theo env). */
export async function storedLimits(t: DbLike): Promise<StoredLimits> {
  const row = await readSystemSettings(t);
  return {
    user_daily_usd: num(row?.userDailyUsd),
    global_daily_usd: num(row?.globalDailyUsd),
    signup_enabled: row?.signupEnabled ?? null,
  };
}

/** Hạn mức hiệu lực từ giá trị lưu: DB ?? env (đọc env lúc gọi). `null` = không giới hạn. Nguồn duy nhất của quy tắc rơi về env. */
export function resolveLimits(s: StoredLimits): EffectiveLimits {
  const userDailyUsd = s.user_daily_usd ?? env.USER_DAILY_USD ?? null;
  const globalDailyUsd = s.global_daily_usd ?? env.GLOBAL_DAILY_USD ?? null;
  const signupEnabled = s.signup_enabled ?? env.SIGNUP_ENABLED;
  return {
    userDailyUsd,
    globalDailyUsd,
    signupEnabled,
    signupOpen: signupEnabled && userDailyUsd !== null && globalDailyUsd !== null,
  };
}

/** Hạn mức hiệu lực = DB ?? env; 1 truy vấn PK. */
export async function effectiveLimits(t: DbLike): Promise<EffectiveLimits> {
  return resolveLimits(await storedLimits(t));
}

/** Đăng ký công khai đang mở thật sự: bật + đủ 2 hạn mức hiệu lực (fail-closed). */
export async function isSignupOpen(t: DbLike): Promise<boolean> {
  return (await effectiveLimits(t)).signupOpen;
}

/**
 * Biểu thức SQL hạn mức user hiệu lực (subquery PK `system_settings`, rơi về env). Dựng mỗi lần gọi để đổi env lúc
 * chạy (test) có hiệu lực.
 */
export const userDailyLimitSql = () =>
  sql`coalesce((select ${systemSettings.userDailyUsd} from ${systemSettings} where ${systemSettings.id} = ${ID}), ${env.USER_DAILY_USD ?? null}::numeric)`;

/** Ghi đủ bộ hạn mức + đăng ký (null = theo env); upsert để chạy được khi DB chưa có hàng. */
export async function saveLimits(t: DbLike, v: StoredLimits): Promise<StoredLimits> {
  const set = {
    userDailyUsd: v.user_daily_usd === null ? null : String(v.user_daily_usd),
    globalDailyUsd: v.global_daily_usd === null ? null : String(v.global_daily_usd),
    signupEnabled: v.signup_enabled,
  };
  await t
    .insert(systemSettings)
    .values({ id: ID, ...set })
    .onConflictDoUpdate({ target: systemSettings.id, set: { ...set, updatedAt: sql`now()` } });
  return storedLimits(t);
}
