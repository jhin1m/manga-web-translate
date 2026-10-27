/**
 * Worker chung toàn hệ thống: claim thấy job của mọi người dùng, và DB test dùng chung giữa các file (chạy tuần tự).
 * Trước mỗi file huỷ mọi job còn hoạt động của file trước → kết quả claim không phụ thuộc thứ tự file.
 */
import { jobs } from "@mtl/db";
import { ACTIVE_JOB_STATUSES } from "@mtl/shared";
import { inArray } from "drizzle-orm";
import { beforeAll } from "vitest";
import { db } from "../src/db.ts";

/** Huỷ mọi job còn hoạt động (test gọi thêm trong `beforeEach` khi các ca cùng file không được thấy job của nhau). */
export async function cancelActiveJobs() {
  await db
    .update(jobs)
    .set({ status: "cancelled", leaseOwner: null, leaseToken: null, leaseExpiresAt: null })
    .where(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]));
}

beforeAll(cancelActiveJobs);
