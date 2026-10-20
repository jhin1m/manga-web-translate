/**
 * Hàng đợi job trên bảng `jobs` (FOR UPDATE SKIP LOCKED) + giao thức worker có fencing (red team #2):
 * - lease_owner = worker_tokens.id lấy từ token (không từ body); claim cấp lease_token ngẫu nhiên + attempt;
 * - heartbeat/complete/fail/presign-outputs bắt buộc {lease_token, attempt} khớp, lease còn hạn → nếu không 409,
 *   không ghi gì;
 * - `attempt` trên dây = attempts + provider_retries (thứ tự claim, tăng đơn điệu) → ledger không trùng
 *   (job, attempt) giữa các lần claim kể cả khi lỗi provider hoàn lại lượt attempt.
 * Muốn chuyển sang pg-boss: chỉ thay file này, giữ API worker.
 */
import { randomBytes } from "node:crypto";
import { chapters, type DbLike, jobs, pageStates, pages, sourceFiles, workspaceSettings } from "@mtl/db";
import type { ClaimRequest, CompleteRequest, FailRequest, HeartbeatRequest, WorkerUsage } from "@mtl/shared";
import {
  pageId as derivePageId,
  type ErrorClass,
  JOB_TYPES,
  type JobResult,
  LLM_JOB_TYPES,
  PAID_JOB_TYPES,
  storageKeys,
} from "@mtl/shared";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { budgetStatus, pauseQueuedPaidJobs } from "../billing/budget.ts";
import { recordServerUsage, recordUsage, type WorkerKind } from "../billing/ledger.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { isChapterLocked } from "../lib/chapter-lock.ts";
import type { WorkerIdentity } from "../lib/worker-token.ts";
import { head } from "../storage.ts";
import { isLlmPaused, recordProviderError } from "./breaker.ts";
import { buildInputs, claimOutputNames, outputKey, type PresignedOutput, presignOutputs } from "./claim-inputs.ts";
import { markDispatchClaimed } from "./dispatcher.ts";
import { chapterHasUserEdits, createIngestedPages, refreshChapter } from "./enqueue.ts";
import { decideFailure, JobHttpError, leaseLost } from "./errors.ts";
import { writeAiState } from "./page-state-writer.ts";

type Job = typeof jobs.$inferSelect;

export const LEASE_S = 120;
export const HEARTBEAT_S = 20;
const MAX_INGEST_PAGES = 1000;

export const attemptNo = (j: Pick<Job, "attempts" | "providerRetries">) => j.attempts + j.providerRetries;
export const workerKind = (w: WorkerIdentity): WorkerKind => (w.workspaceId ? "mac" : "modal");
const tx = <R>(fn: (t: DbLike) => Promise<R>) => db.transaction((t) => fn(t as unknown as DbLike));

/** So sánh major.minor.patch. */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export type ClaimedJobOut = {
  id: string;
  type: Job["type"];
  attempt: number;
  lease_token: string;
  lease_expires_at: string;
  payload: Job["payload"];
  inputs: Record<string, unknown>;
  outputs: Record<string, PresignedOutput>;
};

export async function claim(w: WorkerIdentity, req: z.infer<typeof ClaimRequest>): Promise<ClaimedJobOut[]> {
  if (compareVersion(req.pipeline_version, env.MIN_PIPELINE_VERSION) < 0) {
    throw new JobHttpError(426, "pipeline_too_old", `pipeline_version < ${env.MIN_PIPELINE_VERSION}`);
  }
  const caps = [...new Set(req.capabilities)];
  if (caps.some((c) => !JOB_TYPES.includes(c))) throw new JobHttpError(400, "unknown_capability");
  if (w.capabilities.length && caps.some((c) => !w.capabilities.includes(c))) {
    throw new JobHttpError(400, "capability_not_allowed");
  }
  return tx(async (t) => {
    const paused = await isLlmPaused(t);
    let types = paused ? caps.filter((c) => !LLM_JOB_TYPES.includes(c)) : caps;
    // Kill-switch ngân sách: kiểm tại claim cho mọi worker (Mac lẫn Modal) — job tốn tiền chuyển paused_budget.
    if (types.some((c) => PAID_JOB_TYPES.includes(c)) && (await budgetStatus(t)).exceeded) {
      await pauseQueuedPaidJobs(t);
      types = types.filter((c) => !PAID_JOB_TYPES.includes(c));
    }
    // Claim kèm dispatch_id (container Modal) → dispatch active; id lạ/không phải token nền tảng → bỏ qua.
    const dispatchId = w.workspaceId || !req.dispatch_id ? null : await markDispatchClaimed(t, req.dispatch_id);
    if (types.length === 0) return [];
    // Token workspace → worker Mac của đúng workspace đó; token nền tảng → mọi workspace chế độ modal (red team #9).
    const picked = await t
      .select({ id: jobs.id })
      .from(jobs)
      .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, jobs.workspaceId))
      .where(
        and(
          eq(jobs.status, "queued"),
          lte(jobs.runAfter, sql`now()`),
          inArray(jobs.type, types),
          w.workspaceId ? eq(jobs.workspaceId, w.workspaceId) : undefined,
          sql`coalesce(${workspaceSettings.workerMode}, 'mac') = ${workerKind(w)}`,
        ),
      )
      .orderBy(asc(jobs.priority), asc(jobs.createdAt))
      .limit(req.max)
      .for("update", { of: jobs, skipLocked: true });

    const out: ClaimedJobOut[] = [];
    for (const { id } of picked) {
      const [cur] = await t.select().from(jobs).where(eq(jobs.id, id));
      if (!cur) continue;
      let outputRev: number | null = null;
      if (claimOutputNames(cur.payload).length && cur.pageId) {
        const [r] = await t
          .update(pages)
          .set({ nextRev: sql`${pages.nextRev} + 1` })
          .where(eq(pages.id, cur.pageId))
          .returning({ rev: sql<number>`${pages.nextRev} - 1` });
        outputRev = r?.rev ?? null;
      }
      const [job] = await t
        .update(jobs)
        .set({
          status: "running",
          leaseOwner: w.tokenId,
          leaseToken: randomBytes(24).toString("hex"),
          leaseExpiresAt: sql`now() + make_interval(secs => ${LEASE_S})`,
          claimedAt: sql`now()`,
          attempts: sql`${jobs.attempts} + 1`,
          workerId: req.worker_id,
          outputRev,
          pipelineVersion: req.pipeline_version,
          dispatchId,
          progress: 0,
          stage: null,
        })
        .where(eq(jobs.id, id))
        .returning();
      if (!job) continue;
      await markClaimed(t, job);
      let inputs: Record<string, unknown>;
      let outputs: Record<string, PresignedOutput>;
      try {
        inputs = await buildInputs(t, job);
        outputs = await presignOutputs(job, claimOutputNames(job.payload));
      } catch (err) {
        // Input không dựng được (page mất, key ngoài workspace…) → fail job này thay vì 500 cả claim:
        // để nguyên thì job kẹt đầu hàng đợi và chặn mọi lần claim sau.
        console.warn(`[claim] job ${job.id} input không hợp lệ: ${(err as Error).message}`);
        await terminal(t, job, "failed", "invalid_input", `inputs: ${(err as Error).message}`);
        continue;
      }
      out.push({
        id: job.id,
        type: job.type,
        attempt: attemptNo(job),
        lease_token: job.leaseToken as string,
        lease_expires_at: (job.leaseExpiresAt as Date).toISOString(),
        payload: job.payload,
        inputs,
        outputs,
      });
    }
    return out;
  });
}

/** Trạng thái page/chapter khi job bắt đầu chạy (tiến độ cho UI polling). */
async function markClaimed(t: DbLike, job: Job) {
  const p = job.payload;
  if (p.type === "page.prepare") await t.update(pages).set({ status: "preparing" }).where(eq(pages.id, p.page_id));
  if (p.type === "chapter.translate") {
    await t
      .update(pages)
      .set({ status: "translating" })
      .where(and(eq(pages.chapterId, p.chapter_id), inArray(pages.id, p.page_ids)));
  }
}

type Fence = { lease_token: string; attempt: number };

/** Khoá dòng job + kiểm fencing. Không khớp → 409 (chưa ghi gì). */
async function fenced(t: DbLike, w: WorkerIdentity, jobId: string, f: Fence, allow: Job["status"][]): Promise<Job> {
  const [job] = await t.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
  if (!job) throw leaseLost();
  const ok =
    job.leaseOwner === w.tokenId &&
    job.leaseToken === f.lease_token &&
    attemptNo(job) === f.attempt &&
    allow.includes(job.status) &&
    (job.status !== "running" || (job.leaseExpiresAt !== null && job.leaseExpiresAt.getTime() > Date.now()));
  if (!ok) throw leaseLost();
  return job;
}

async function usage(t: DbLike, w: WorkerIdentity, job: Job, attempt: number, u: WorkerUsage | null) {
  if (u) await recordUsage(t, job, attempt, u, workerKind(w));
}

export async function heartbeat(w: WorkerIdentity, jobId: string, req: z.infer<typeof HeartbeatRequest>) {
  return tx(async (t) => {
    const job = await fenced(t, w, jobId, req, ["running", "cancelled"]);
    await usage(t, w, job, req.attempt, req.usage);
    if (job.status === "cancelled")
      return { lease_expires_at: (job.leaseExpiresAt as Date).toISOString(), stop: "cancel" as const };
    if (PAID_JOB_TYPES.includes(job.type) && (await budgetStatus(t)).exceeded) {
      await pauseForBudget(t, job);
      return { lease_expires_at: new Date().toISOString(), stop: "paused_budget" as const };
    }
    const [u] = await t
      .update(jobs)
      .set({ leaseExpiresAt: sql`now() + make_interval(secs => ${LEASE_S})`, progress: req.progress, stage: req.stage })
      .where(eq(jobs.id, job.id))
      .returning({ until: jobs.leaseExpiresAt });
    if (!u?.until) throw leaseLost();
    return { lease_expires_at: u.until.toISOString(), stop: null };
  });
}

export async function presignJobOutputs(w: WorkerIdentity, jobId: string, req: Fence & { names: string[] }) {
  return tx(async (t) => {
    const job = await fenced(t, w, jobId, req, ["running"]);
    return { outputs: await presignOutputs(job, req.names) };
  });
}

async function requireObjects(keys: string[]) {
  for (const key of keys) {
    if (!(await head(key))) throw new JobHttpError(400, "output_missing", `output chưa upload: ${key}`);
  }
}

function requireRev(job: Job, rev: number, what: string) {
  if (job.outputRev === null || rev !== job.outputRev) {
    throw new JobHttpError(400, "wrong_output_rev", `${what} rev ${rev} ≠ rev cấp lúc claim ${job.outputRev}`);
  }
}

export async function complete(w: WorkerIdentity, jobId: string, req: z.infer<typeof CompleteRequest>) {
  return tx(async (t) => {
    const job = await fenced(t, w, jobId, req, ["running", "succeeded"]);
    // complete lặp với cùng lease → no-op (không ghi page/ledger lần 2).
    if (job.status === "succeeded") return { ok: true, duplicate: true };
    if (req.result.type !== job.type) throw new JobHttpError(400, "result_type_mismatch");
    await usage(t, w, job, req.attempt, req.usage);
    // Đánh dấu succeeded trước: tính lại trạng thái chương bên dưới không còn thấy job này "đang chạy".
    await t
      .update(jobs)
      .set({ status: "succeeded", result: req.result, progress: 1, stage: null, errorClass: null, error: null })
      .where(eq(jobs.id, job.id));
    const rejected = await applyResult(t, job, req.attempt, req.result);
    // Server tự kết thúc job (VD chương đã có chỉnh sửa tay, terminal() đã ghi đè status) — commit rồi trả 409.
    if (rejected) return { ok: false, duplicate: false, rejected };
    return { ok: true, duplicate: false };
  });
}

/** → mã lỗi khi server tự kết thúc job thay vì nhận kết quả (worker nhận 409). */
async function applyResult(t: DbLike, job: Job, attempt: number, result: JobResult): Promise<string | undefined> {
  const ws = job.workspaceId;
  switch (result.type) {
    case "chapter.ingest":
      return applyIngest(t, job, result);
    case "page.prepare": {
      if (!job.pageId) throw new Error("page.prepare without page_id");
      requireRev(job, result.clean_rev, "clean");
      requireRev(job, result.mask_rev, "mask");
      await requireObjects([
        storageKeys.clean(ws, job.pageId, result.clean_rev),
        storageKeys.mask(ws, job.pageId, result.mask_rev),
      ]);
      await t
        .update(pages)
        .set({
          cleanRev: result.clean_rev,
          maskRev: result.mask_rev,
          ocrResult: result.ocr_result,
          prepareInputRev: job.inputRev,
          preparePartial: null,
          status: "prepared",
        })
        .where(eq(pages.id, job.pageId));
      await recordServerUsage(t, job, attempt, "pages", 1);
      if (job.chapterId) await refreshChapter(t, ws, job.chapterId, true);
      return undefined;
    }
    case "chapter.translate": {
      const p = job.payload;
      if (p.type !== "chapter.translate") throw new Error("payload mismatch");
      const want = new Set(p.page_ids);
      const got = new Set(result.pages.map((r) => r.page_id));
      if ([...got].some((id) => !want.has(id)) || got.size !== result.pages.length) {
        throw new JobHttpError(400, "unexpected_page", "result có page ngoài page_ids hoặc trùng");
      }
      const [ch] = await t.select().from(chapters).where(eq(chapters.id, p.chapter_id));
      if (!ch) throw new Error("chapter missing");
      const rows = await t.select().from(pages).where(inArray(pages.id, p.page_ids));
      const dims = new Map(rows.map((r) => [r.id, r]));
      for (const r of result.pages) {
        const pg = dims.get(r.page_id);
        if (!pg || r.ai_state.size.w !== pg.width || r.ai_state.size.h !== pg.height) {
          throw new JobHttpError(400, "state_size_mismatch", `ai_state.size ≠ kích thước page ${r.page_id}`);
        }
      }
      const locked = isChapterLocked(ch);
      for (const r of result.pages) {
        await writeAiState(t, {
          workspaceId: ws,
          pageId: r.page_id,
          aiState: r.ai_state,
          actor: `job:${job.id}`,
          chapterLocked: locked,
        });
      }
      if (got.size)
        await t
          .update(pages)
          .set({ status: "ready" })
          .where(inArray(pages.id, [...got]));
      const missing = p.page_ids.filter((id) => !got.has(id));
      if (missing.length) await t.update(pages).set({ status: "failed" }).where(inArray(pages.id, missing));
      await refreshChapter(t, ws, p.chapter_id, false);
      return undefined;
    }
    case "page.reinpaint": {
      if (!job.pageId) throw new Error("page.reinpaint without page_id");
      requireRev(job, result.clean_rev, "clean");
      await requireObjects([storageKeys.clean(ws, job.pageId, result.clean_rev)]);
      await t.update(pages).set({ cleanRev: result.clean_rev }).where(eq(pages.id, job.pageId));
      return undefined;
    }
    case "chapter.export": {
      // Chỉ nhận đúng key cấp lúc claim; kích thước lấy từ object thật (không tin số worker gửi).
      const key = outputKey(job, "export")?.key;
      if (!key || result.key !== key)
        throw new JobHttpError(400, "wrong_output_key", "key export khác key cấp lúc claim");
      const h = await head(key);
      if (!h) throw new JobHttpError(400, "output_missing", `output chưa upload: ${key}`);
      await t
        .update(jobs)
        .set({ result: { ...result, bytes: h.bytes } })
        .where(eq(jobs.id, job.id));
      return undefined;
    }
    case "page.ocr_region":
      return undefined; // kết quả nằm ở jobs.result
  }
}

async function applyIngest(
  t: DbLike,
  job: Job,
  result: Extract<JobResult, { type: "chapter.ingest" }>,
): Promise<string | undefined> {
  const p = job.payload;
  if (p.type !== "chapter.ingest") throw new Error("payload mismatch");
  const [ch] = await t.select().from(chapters).where(eq(chapters.id, p.chapter_id)).for("update");
  if (!ch) throw new Error("chapter missing");
  if (ch.ingestRev !== p.ingest_rev) {
    await terminal(t, job, "cancelled", "internal", "ingest_rev cũ — đã có lần ingest mới hơn");
    return "stale_ingest";
  }
  if (await chapterHasUserEdits(t, ch.id)) {
    await terminal(t, job, "failed", "invalid_input", "chapter_has_user_edits: tạo chương mới để ingest lại");
    return "chapter_has_user_edits";
  }
  const ords = result.pages.map((r) => r.ord);
  if (!ords.length || ords.length > MAX_INGEST_PAGES || ords.some((o, i) => o !== i)) {
    throw new JobHttpError(400, "bad_page_ords", "ord phải liên tục từ 0");
  }
  const srcIds = new Set(
    (await t.select({ id: sourceFiles.id }).from(sourceFiles).where(eq(sourceFiles.chapterId, ch.id))).map((s) => s.id),
  );
  if (result.pages.some((r) => r.source_map.some((m) => !srcIds.has(m.source_file_id)))) {
    throw new JobHttpError(400, "bad_source_map");
  }
  const keyOf = (ord: number) => (outputKey(job, `page:${ord}`) as { key: string }).key;
  await requireObjects(result.pages.map((r) => keyOf(r.ord)));
  await createIngestedPages(
    t,
    ch,
    result.pages.map((r) => ({
      id: derivePageId(ch.id, p.ingest_rev, r.ord),
      ord: r.ord,
      width: r.width,
      height: r.height,
      originalKey: keyOf(r.ord),
      originalSha256: r.original_sha256,
      sourceMap: r.source_map,
      cutFlag: r.cut_flag,
    })),
  );
  return undefined;
}

/** Kết thúc job (failed/cancelled) + hệ quả lên page/chapter. Dùng chung cho fail, reaper, cancel. */
export async function terminal(
  t: DbLike,
  job: Job,
  status: "failed" | "cancelled",
  errorClass: ErrorClass,
  message: string,
): Promise<void> {
  await t
    .update(jobs)
    .set({ status, errorClass, error: message.slice(0, 4000), stage: null })
    .where(eq(jobs.id, job.id));
  const p = job.payload;
  const ws = job.workspaceId;
  switch (p.type) {
    case "chapter.ingest":
      // Huỷ ingest = chưa commit → về draft (commit lại được); lỗi → partial_failed.
      await t
        .update(chapters)
        .set({ status: status === "failed" ? "partial_failed" : "draft" })
        .where(
          and(eq(chapters.id, p.chapter_id), eq(chapters.ingestRev, p.ingest_rev), eq(chapters.status, "ingesting")),
        );
      return;
    case "page.prepare":
      await t.update(pages).set({ status: "failed" }).where(eq(pages.id, p.page_id));
      // Page còn lại đã prepare vẫn được nối sang giai đoạn 2 (kể cả khi huỷ page cuối) — chương không kẹt.
      if (job.chapterId) await refreshChapter(t, ws, job.chapterId, true);
      return;
    case "chapter.translate": {
      // Page đang chờ/đang dịch: đã có bản AI trước (dịch lại) → giữ `ready`; chưa có → `failed`.
      const affected = await t
        .select({ id: pages.id, aiRev: pageStates.aiRev })
        .from(pages)
        .innerJoin(pageStates, eq(pageStates.pageId, pages.id))
        .where(and(inArray(pages.id, p.page_ids), inArray(pages.status, ["translating", "prepared"])));
      const ready = affected.filter((r) => r.aiRev > 0).map((r) => r.id);
      const failed = affected.filter((r) => r.aiRev === 0).map((r) => r.id);
      if (ready.length) await t.update(pages).set({ status: "ready" }).where(inArray(pages.id, ready));
      if (failed.length) await t.update(pages).set({ status: "failed" }).where(inArray(pages.id, failed));
      await refreshChapter(t, ws, p.chapter_id, false);
      return;
    }
    default:
      return;
  }
}

/** Đưa job về hàng đợi (lỗi tạm thời hoặc lease hết hạn). */
export async function requeue(
  t: DbLike,
  job: Job,
  opts: {
    delayS: number;
    refundAttempt: boolean;
    providerRetry: boolean;
    errorClass: ErrorClass | null;
    message: string | null;
  },
) {
  await t
    .update(jobs)
    .set({
      status: "queued",
      runAfter: sql`now() + make_interval(secs => ${opts.delayS})`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      attempts: opts.refundAttempt ? sql`greatest(${jobs.attempts} - 1, 0)` : jobs.attempts,
      providerRetries: opts.providerRetry ? sql`${jobs.providerRetries} + 1` : jobs.providerRetries,
      errorClass: opts.errorClass,
      error: opts.message?.slice(0, 4000) ?? null,
      progress: 0,
      stage: null,
    })
    .where(eq(jobs.id, job.id));
}

/**
 * Job đang chạy dừng vì hết ngân sách: về `paused_budget`, lease xoá (worker cũ gửi tiếp → 409), hoàn lượt
 * attempt; page về trạng thái trước claim. Artifact đã ghi DB của attempt trước giữ nguyên.
 */
async function pauseForBudget(t: DbLike, job: Job) {
  await t
    .update(jobs)
    .set({
      status: "paused_budget",
      runAfter: sql`now()`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      // Như refund của lỗi provider: số attempt trên dây (attempts + provider_retries) vẫn tăng → lần chạy lại
      // không trùng khoá ledger (job, attempt, seq, kind) với lần bị dừng.
      providerRetries: sql`${jobs.providerRetries} + 1`,
      progress: 0,
      stage: null,
    })
    .where(eq(jobs.id, job.id));
  const p = job.payload;
  if (p.type === "page.prepare") {
    await t
      .update(pages)
      .set({ status: "pending" })
      .where(and(eq(pages.id, p.page_id), eq(pages.status, "preparing")));
  }
  if (p.type === "chapter.translate") {
    // Như lúc chờ claim: đã có bản AI (dịch lại) → ready, chưa có → prepared.
    const affected = await t
      .select({ id: pages.id, aiRev: pageStates.aiRev })
      .from(pages)
      .innerJoin(pageStates, eq(pageStates.pageId, pages.id))
      .where(and(inArray(pages.id, p.page_ids), eq(pages.status, "translating")));
    for (const [status, ids] of [
      ["ready", affected.filter((r) => r.aiRev > 0).map((r) => r.id)],
      ["prepared", affected.filter((r) => r.aiRev === 0).map((r) => r.id)],
    ] as const) {
      if (ids.length) await t.update(pages).set({ status }).where(inArray(pages.id, ids));
    }
  }
}

export async function fail(w: WorkerIdentity, jobId: string, req: z.infer<typeof FailRequest>) {
  return tx(async (t) => {
    const job = await fenced(t, w, jobId, req, ["running", "cancelled"]);
    await usage(t, w, job, req.attempt, req.usage);
    if (job.status === "cancelled") return { ok: true, status: "cancelled" as const };
    if (req.partial) await savePartial(t, job, req.partial);
    if (req.error_class === "provider" || req.error_class === "rate_limited") await recordProviderError(t);
    const d = decideFailure(req.error_class, job, req.retry_after_s);
    if (d.kind === "failed") {
      await terminal(t, job, "failed", req.error_class, req.message);
      return { ok: true, status: "failed" as const };
    }
    await requeue(t, job, { ...d, errorClass: req.error_class, message: req.message });
    return { ok: true, status: "queued" as const, retry_in_s: d.delayS };
  });
}

/** Artifact trước LLM (fenced, đúng rev của attempt) → lần prepare sau bỏ qua detect/inpaint. */
async function savePartial(t: DbLike, job: Job, partial: NonNullable<z.infer<typeof FailRequest>["partial"]>) {
  if (job.type !== "page.prepare" || !job.pageId) throw new JobHttpError(400, "partial_not_supported");
  requireRev(job, partial.clean_rev, "partial clean");
  requireRev(job, partial.mask_rev, "partial mask");
  await requireObjects([
    storageKeys.clean(job.workspaceId, job.pageId, partial.clean_rev),
    storageKeys.mask(job.workspaceId, job.pageId, partial.mask_rev),
  ]);
  await t
    .update(pages)
    .set({ preparePartial: { ...partial, input_rev: job.inputRev } })
    .where(eq(pages.id, job.pageId));
}

/** Huỷ job từ phía người dùng (workspace-scoped). Job đang chạy: worker nhận `stop: "cancel"` ở heartbeat kế. */
export async function cancelJob(ws: string, jobId: string): Promise<Job | null> {
  return tx(async (t) => {
    const [job] = await t
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, ws)))
      .for("update");
    if (!job) return null;
    if (!["queued", "running", "paused_budget"].includes(job.status)) return job;
    await terminal(t, job, "cancelled", "internal", "cancelled by user");
    const [after] = await t.select().from(jobs).where(eq(jobs.id, job.id));
    return after ?? null;
  });
}
