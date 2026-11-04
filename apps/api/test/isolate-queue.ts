/**
 * Worker chung toàn hệ thống: claim thấy job của mọi người dùng, và DB test dùng chung giữa các file (chạy tuần tự).
 * Trước mỗi file huỷ mọi job còn hoạt động của file trước → kết quả claim không phụ thuộc thứ tự file.
 */
import { aiProviders, jobs, systemFonts, systemSettings } from "@mtl/db";
import { ACTIVE_JOB_STATUSES } from "@mtl/shared";
import { inArray } from "drizzle-orm";
import { afterEach, beforeAll } from "vitest";
import { db } from "../src/db.ts";
import { env } from "../src/env.ts";

/** Huỷ mọi job còn hoạt động (test gọi thêm trong `beforeEach` khi các ca cùng file không được thấy job của nhau). */
export async function cancelActiveJobs() {
  await db
    .update(jobs)
    .set({ status: "cancelled", leaseOwner: null, leaseToken: null, leaseExpiresAt: null })
    .where(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]));
}

const initialAdminEmails = [...env.ADMIN_EMAILS];
const initialSecretsKey = env.SECRETS_KEY;

// Cài đặt hệ thống + provider AI + font hệ thống là dữ liệu dùng chung của DB test → mỗi file bắt đầu từ mặc định
// (xoá cài đặt trước: slot FK RESTRICT chặn xoá model đang gán).
beforeAll(async () => {
  await cancelActiveJobs();
  await db.delete(systemSettings);
  await db.delete(aiProviders);
  await db.delete(systemFonts);
});

// `env.ADMIN_EMAILS` / `env.SECRETS_KEY` là state cấp process: ca sau không được thấy giá trị ca trước đặt.
afterEach(() => {
  env.ADMIN_EMAILS.splice(0, env.ADMIN_EMAILS.length, ...initialAdminEmails);
  env.SECRETS_KEY = initialSecretsKey;
});
