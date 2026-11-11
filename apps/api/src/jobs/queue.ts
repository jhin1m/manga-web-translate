/**
 * Hàng đợi job trên bảng `jobs` (FOR UPDATE SKIP LOCKED) + giao thức worker có fencing (red team #2):
 * - lease_owner = worker_tokens.id lấy từ token (không từ body); claim cấp lease_token ngẫu nhiên + attempt;
 * - heartbeat/complete/fail/presign-outputs bắt buộc {lease_token, attempt} khớp, lease còn hạn → nếu không 409,
 *   không ghi gì;
 * - `attempt` trên dây = attempts + provider_retries (thứ tự claim, tăng đơn điệu) → ledger không trùng
 *   (job, attempt) giữa các lần claim kể cả khi lỗi provider hoàn lại lượt attempt.
 * Thứ tự claim: priority, rồi chương đang có ít job chạy nhất (N worker → N chương cùng lúc), rồi thứ tự tạo và thứ
 * tự trang — xem `pickClaimable`.
 * Muốn chuyển sang pg-boss: chỉ thay file này, giữ API worker.
 */
import { randomBytes } from "node:crypto";
import { chapters, type DbLike, jobs, pageStates, pages, proofreadSuggestions, sourceFiles } from "@mtl/db";
import type {
  ClaimRequest,
  CompleteRequest,
  FailRequest,
  HeartbeatRequest,
  LlmConfigs,
  WorkerUsage,
} from "@mtl/shared";
import {
  pageId as derivePageId,
  type ErrorClass,
  isLlmPayload,
  JOB_TYPES,
  type JobResult,
  LLM_JOB_TYPES,
  storageKeys,
} from "@mtl/shared";
import { and, eq, gt, inArray, lte, ne, not, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { LlmConfigError, resolveLlmConfigs } from "../ai/llm-config.ts";
import { budgetStatus, pauseQueuedPaidJobs } from "../billing/budget.ts";
import { recordServerUsage, recordUsage } from "../billing/ledger.ts";
import {
  claimableSql,
  lockQueuedOverQuotaLlmJobs,
  overQuotaUsersSql,
  quotaFailMessage,
  userQuotaStatus,
} from "../billing/user-quota.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import type { WorkerIdentity } from "../lib/worker-token.ts";
import { head } from "../storage.ts";
import { breakerBlockedSql, breakerKeysOf, pausedBreakerKeys, recordProviderError } from "./breaker.ts";
import { buildInputs, claimOutputNames, outputKey, type PresignedOutput, presignOutputs } from "./claim-inputs.ts";
import { markDispatchClaimed } from "./dispatcher.ts";
import { chapterHasUserEdits, createIngestedPages, lockChapter, refreshChapter } from "./enqueue.ts";
import { decideFailure, JobHttpError, leaseLost } from "./errors.ts";
import { llmJobSql } from "./llm-job-filter.ts";
import { writeAiState } from "./page-state-writer.ts";
import { advanceTranslateChain, stopTranslateChain } from "./translate-chain.ts";

type Job = typeof jobs.$inferSelect;

export const LEASE_S = 120;
export const HEARTBEAT_S = 20;
const MAX_INGEST_PAGES = 1000;

export const attemptNo = (j: Pick<Job, "attempts" | "providerRetries">) => j.attempts + j.providerRetries;
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

/** Job LLM đang chờ của người vượt hạn mức → failed `quota_exceeded` (claim + runner gọi). Trả số job. */
export async function failOverQuotaQueued(t: DbLike): Promise<number> {
  const rows = await lockQueuedOverQuotaLlmJobs(t);
  if (rows.length === 0) return 0;
  const message = await quotaFailMessage(t);
  for (const job of rows) await terminal(t, job, "failed", "internal", message);
  return rows.length;
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
  /** Cấu hình AI theo slot (key đã giải mã) — chỉ trong response claim, không ghi DB. */
  llm?: LlmConfigs;
};

/**
 * Số dòng đầu hàng đang bị transaction khác khoá mà một lượt claim còn vượt qua được. Mỗi nhánh ứng viên của
 * `pickClaimableSql` lấy `max + CLAIM_LOOKAHEAD` dòng trước khi khoá; nếu chừng đó dòng đầu của cả hai nhánh đều đang
 * bị khoá (cần hơn 4 lượt claim `max = 8` cùng lúc) thì lượt này trả rỗng dù phía sau còn job, worker nghỉ một nhịp
 * backoff rồi claim lại. Đổi lại câu chọn job chỉ đọc vài chục dòng đầu hàng thay vì xếp cả hàng đợi.
 *
 * Giữ 32: số nhỏ hơn không làm plan bền hơn đáng kể (điểm planner bỏ đường đi theo index đã ở dưới ~200 job chờ), còn
 * số dòng thật sự đọc do nhóm job cùng `created_at` ở đầu hàng quyết định (cả chương ~40 trang), không do số này.
 */
export const CLAIM_LOOKAHEAD = 32;

/**
 * Bọc một điều kiện để planner không ước lượng được nó: Postgres tính mọi biểu thức CASE là giữ lại một nửa số dòng,
 * bất kể bên trong có gì. Kết quả của điều kiện không đổi (NULL thành false, mà WHERE vốn cũng loại dòng NULL).
 *
 * Câu chọn job cần điều này vì nó chỉ nhanh khi Postgres đi theo `jobs_claim_idx` rồi dừng ở LIMIT. Planner chọn đường
 * đó khi nó tin còn nhiều dòng qua được bộ lọc. Để từng bộ lọc (hạn mức, breaker, tài khoản bị khoá, chương bận…) tự
 * ước lượng thì mỗi cái nhân ước lượng với ~0,5 hoặc tệ hơn, tích lại còn vài dòng, và planner chuyển sang đọc + xếp
 * cả hàng đợi. Bọc chung một lần thì ước lượng luôn là một nửa số job đang chờ, dù bật thêm bộ lọc nào.
 */
const opaque = (cond: SQL) => sql`(case when ${cond} then true else false end)`;

type PickOptions = {
  kind: WorkerIdentity["kind"];
  caps: Job["type"][];
  blockLlm: boolean;
  paused: string[];
  max: number;
};

/**
 * Câu chọn job cho một lượt claim (khoá dòng job, bỏ dòng worker khác đang giữ).
 *
 * Thứ tự: priority → số job đang chạy của chương → created_at → thứ tự trang → id. Khoá thứ hai chia worker giữa
 * các chương: worker rảnh nhận job của chương đang có ít job chạy nhất, nên N worker chạy N chương cùng lúc thay vì
 * dồn hết vào chương tạo trước. Nó chỉ xếp thứ tự, không loại job nào: chương duy nhất còn job chờ vẫn được mọi worker
 * cùng làm.
 *
 * Khoá thứ hai không nằm trong index nào, nên xếp thẳng theo nó buộc Postgres đọc và xếp mọi job đang chờ. Câu này
 * tách ứng viên thành hai nhánh, mỗi nhánh tự xếp và cắt `max + CLAIM_LOOKAHEAD` dòng:
 * - chương rảnh (số đếm 0, kể cả job không gắn chương): thứ tự của chúng chính là thứ tự của `jobs_claim_idx`, nên
 *   Postgres đi theo index và dừng sau vài chục dòng;
 * - chương bận: chỉ job của các chương đang có job chạy (số chương ≤ số job đang chạy).
 * Hai đầu danh sách gộp lại chắc chắn chứa các dòng đứng đầu thứ tự chung; tầng ngoài xếp lại và khoá.
 *
 * Các điểm phải giữ khi sửa câu này:
 * - `busy`: đếm job `running` còn lease của chương, mọi loại và mọi priority (lô dịch hay export đang chạy cũng chiếm
 *   một worker). Job hết lease (worker chết, reaper chưa quét) không tính, để chương đó không bị xếp sau oan.
 * - Nhánh chương rảnh phải có `chapter_id is null or`: `NULL not in (...)` cho NULL và làm rơi job không gắn chương.
 * - Khoá ở tầng ngoài, không khoá trong nhánh: dòng bị khoá trong nhánh mà bị LIMIT ngoài cắt sẽ nằm khoá tới hết
 *   transaction và làm worker khác nhảy cóc trang.
 * - Tầng ngoài phải kiểm lại `status = 'queued'`: dòng vừa bị worker khác claim và commit sau snapshot chỉ bị loại
 *   khi Postgres kiểm lại điều kiện của tầng khoá trên bản mới của dòng. Thiếu thì hai worker nhận cùng một job.
 * - `cand` phải là `materialized`: để Postgres nhúng nó vào tầng ngoài thì mỗi lần kiểm lại một dòng vừa bị transaction
 *   khác sửa, cả hai nhánh chạy lại từ đầu (kết quả vẫn đúng nhưng tốn vài ms mỗi lần hai worker đụng nhau).
 * - Nhánh chương rảnh cắt hai bước. Bước trong xếp đúng theo hai cột của `jobs_claim_idx` (priority, created_at) và
 *   lấy trọn nhóm hoà cuối (`with ties`), nên không cần bước xếp nào: Postgres chỉ việc đi theo index rồi dừng. Bước
 *   ngoài xếp tập vừa cắt theo trang + id rồi mới lấy `max + CLAIM_LOOKAHEAD` dòng. Gộp làm một bước (xếp theo trang
 *   ngay trên bảng jobs) thì planner phải chọn giữa xếp tăng dần (dừng sớm) và xếp toàn bộ (đọc hết hàng đợi), và nó
 *   chọn sai khi ước lượng số job chờ quá thấp. Bỏ bước ngoài thì cả nhóm hoà (một chương tới 1.000 trang cùng
 *   created_at) bị đẩy lên tầng khoá.
 * - Planner chỉ được thấy `status = 'queued'` ở đúng một chỗ: nhánh chương rảnh, nơi cần chứng minh điều kiện của
 *   partial index. Mọi bộ lọc khác, và cả `status = 'queued'` ở nhánh chương bận lẫn tầng ngoài, đi qua `opaque()`:
 *   - bộ lọc theo dòng để lộ thì ước lượng của nhánh chương rảnh tụt dưới LIMIT khi vài bộ lọc cùng bật (hoặc khi
 *     bảng `user` chưa có thống kê), và Postgres chuyển sang đọc + xếp cả hàng đợi;
 *   - `status = 'queued'` để lộ ở nhánh chương bận / tầng ngoài thì khi thống kê bảng jobs cũ (analyze lúc hàng đợi
 *     trống, rồi một lô job mới vào) planner tưởng chỉ có 1 job chờ và quét cả `jobs_claim_idx` cho từng ứng viên. Che
 *     đi thì hai chỗ đó chỉ còn đường qua `jobs_chapter_idx` và khoá chính.
 *   Với thống kê mới, đường đi theo index ở nhánh chương rảnh chỉ thua khi hàng đợi còn khoảng dưới 200 job, lúc đó
 *   đọc hết cũng chưa tới 0,5 ms.
 * - Trong hai nhánh bảng phải mang tên `jobs` (không alias): các bộ lọc dùng chung nhúng thẳng `"jobs"."cột"`.
 */
export function pickClaimableSql(o: PickOptions): SQL {
  const take = o.max + CLAIM_LOOKAHEAD;
  // Điều kiện của partial index `jobs_claim_idx`, viết bằng hằng (không qua tham số) để chứng minh được ở mọi kiểu
  // plan, kể cả generic plan của prepared statement. Đây là điều kiện duy nhất planner được nhìn thấy.
  const queued = sql`${jobs.status} = 'queued'`;
  // Các bộ lọc còn lại, xếp từ rẻ tới đắt (AND dừng ở điều kiện sai đầu tiên). Hạn mức người dùng đọc CTE
  // `over_quota`: ledger hôm nay được cộng một lần cho cả hai nhánh, và chỉ khi có hạn mức hiệu lực.
  const filters = and(
    lte(jobs.runAfter, sql`now()`),
    inArray(jobs.type, o.caps),
    o.blockLlm ? not(llmJobSql) : undefined,
    o.paused.length ? not(breakerBlockedSql(o.paused)) : undefined,
    // Worker chung toàn hệ thống: mọi token claim job mọi người dùng. Modal (tốn GPU) không nhận job nào của người
    // vượt hạn mức — job không-LLM của họ chỉ chạy trên Mac ($0) hoặc chờ sang ngày.
    claimableSql(o.kind, sql`select user_id from over_quota`),
  ) as SQL;
  const idleChapter = sql`(${jobs.chapterId} is null or ${jobs.chapterId} not in (select chapter_id from busy))`;
  // Job cùng created_at (ingest tạo cả loạt page.prepare trong một transaction) → page đầu chương claim trước.
  // Job không gắn page: ord NULL, xếp sau trong nhóm hoà.
  // Dùng trong nhánh chương bận; nhánh chương rảnh ghép pages sau khi đã cắt theo index.
  const joinPages = sql`left join ${pages} on ${pages.id} = ${jobs.pageId}`;
  return sql`
    with
    busy as materialized (
      select r.chapter_id, count(*)::int as busy_n
      from ${jobs} r
      where r.status = 'running' and r.lease_expires_at > now() and r.chapter_id is not null
      group by r.chapter_id
    ),
    over_quota as materialized (${overQuotaUsersSql()}),
    cand as materialized (
      (
        select head.id, head.priority, 0 as busy_n, head.created_at, ${pages.ord}
        from (
          select ${jobs.id}, ${jobs.priority}, ${jobs.createdAt}, ${jobs.pageId}
          from ${jobs}
          where ${queued} and ${opaque(sql`${idleChapter} and ${filters}`)}
          order by ${jobs.priority}, ${jobs.createdAt}
          fetch first ${sql.raw(String(take))} rows with ties
        ) head
        left join ${pages} on ${pages.id} = head.page_id
        order by head.priority, head.created_at, ${pages.ord} asc nulls last, head.id
        limit ${sql.raw(String(take))}
      )
      union all
      (
        select ${jobs.id}, ${jobs.priority}, busy.busy_n, ${jobs.createdAt}, ${pages.ord}
        from ${jobs} join busy on busy.chapter_id = ${jobs.chapterId} ${joinPages}
        where ${opaque(sql`${queued} and ${filters}`)}
        order by ${jobs.priority}, busy.busy_n, ${jobs.createdAt}, ${pages.ord} asc nulls last, ${jobs.id}
        limit ${take}
      )
    )
    select ${jobs.id} as id
    from cand
    join ${jobs} on ${jobs.id} = cand.id
    where ${opaque(sql`${queued} and ${jobs.runAfter} <= now()`)}
    order by cand.priority, cand.busy_n, cand.created_at, cand.ord asc nulls last, cand.id
    limit ${o.max}
    for update of ${jobs} skip locked`;
}

export async function pickClaimable(t: DbLike, o: PickOptions): Promise<{ id: string }[]> {
  return [...(await t.execute<{ id: string }>(pickClaimableSql(o)))];
}

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
    // Breaker LLM / kill-switch ngân sách chặn job gọi LLM (`llmJobSql`); job OCR local cùng loại vẫn claim được.
    const paused = await pausedBreakerKeys(t);
    let blockLlm = false;
    // Kill-switch ngân sách: kiểm tại claim cho mọi worker (Mac lẫn Modal) — job tốn tiền chuyển paused_budget.
    if (caps.some((c) => LLM_JOB_TYPES.includes(c)) && (await budgetStatus(t)).exceeded) {
      await pauseQueuedPaidJobs(t);
      blockLlm = true;
    }
    // Hạn mức từng người dùng: job LLM đang chờ của người vượt → failed trước khi chọn (không kẹt chương).
    await failOverQuotaQueued(t);
    // Claim kèm dispatch_id (container Modal) → dispatch active; id lạ / token không phải Modal → bỏ qua.
    const dispatchId = w.kind !== "modal" || !req.dispatch_id ? null : await markDispatchClaimed(t, req.dispatch_id);
    const picked = await pickClaimable(t, { kind: w.kind, caps, blockLlm, paused, max: req.max });

    const out: ClaimedJobOut[] = [];
    for (const { id } of picked) {
      const [cur] = await t.select().from(jobs).where(eq(jobs.id, id));
      if (!cur) continue;
      // Khoá chương trước khi đụng page (cấp rev, markClaimed): job dựng input lỗi gọi terminal() → cần khoá chương;
      // giữ đúng thứ tự job → chapter → pages như complete/fail/advance, không đảo thành pages → chapter (deadlock).
      if (cur.chapterId) await lockChapter(t, cur.userId, cur.chapterId);
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
          progressDone: null,
          progressTotal: null,
        })
        .where(eq(jobs.id, id))
        .returning();
      if (!job) continue;
      await markClaimed(t, job);
      let inputs: Record<string, unknown>;
      let outputs: Record<string, PresignedOutput>;
      let llm: LlmConfigs | undefined;
      try {
        inputs = await buildInputs(t, job);
        outputs = await presignOutputs(job, claimOutputNames(job.payload));
        llm = await resolveLlmConfigs(t, "llm" in job.payload ? job.payload.llm : undefined);
      } catch (err) {
        // Key không giải mã được / provider mất: lỗi cấu hình, không retry (admin sửa rồi chạy lại trang lỗi).
        if (err instanceof LlmConfigError) {
          console.warn(`[claim] job ${job.id} cấu hình AI lỗi`);
          await terminal(t, job, "failed", "auth", err.message);
          continue;
        }
        // Input không dựng được (page mất, key ngoài dữ liệu người dùng…) → fail job này thay vì 500 cả claim:
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
        ...(llm ? { llm } : {}),
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
  if (u) await recordUsage(t, job, attempt, u, w.kind);
}

export async function heartbeat(w: WorkerIdentity, jobId: string, req: z.infer<typeof HeartbeatRequest>) {
  return tx(async (t) => {
    const job = await fenced(t, w, jobId, req, ["running", "cancelled"]);
    await usage(t, w, job, req.attempt, req.usage);
    if (job.status === "cancelled")
      return { lease_expires_at: (job.leaseExpiresAt as Date).toISOString(), stop: "cancel" as const };
    if (isLlmPayload(job.payload) && (await budgetStatus(t)).exceeded) {
      await pauseForBudget(t, job);
      return { lease_expires_at: new Date().toISOString(), stop: "paused_budget" as const };
    }
    // Hạn mức người dùng (sau khi ghi usage của nhịp này): vượt → dừng job LLM + failed. Vượt tối đa ≈ chi phí tới
    // nhịp heartbeat kế của các job đang chạy của người đó.
    if (isLlmPayload(job.payload) && (await userQuotaStatus(t, job.userId)).exceeded) {
      await terminal(t, job, "failed", "internal", await quotaFailMessage(t));
      return { lease_expires_at: new Date().toISOString(), stop: "cancel" as const };
    }
    const [u] = await t
      .update(jobs)
      .set({
        leaseExpiresAt: sql`now() + make_interval(secs => ${LEASE_S})`,
        progress: req.progress,
        stage: req.stage,
        progressDone: req.done ?? null,
        progressTotal: req.total ?? null,
      })
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
      .set({
        status: "succeeded",
        result: req.result,
        progress: 1,
        stage: null,
        progressDone: null,
        progressTotal: null,
        errorClass: null,
        error: null,
      })
      .where(eq(jobs.id, job.id));
    const rejected = await applyResult(t, job, req.attempt, req.result);
    // Server tự kết thúc job (VD chương đã có chỉnh sửa tay, terminal() đã ghi đè status) — commit rồi trả 409.
    if (rejected) return { ok: false, duplicate: false, rejected };
    return { ok: true, duplicate: false };
  });
}

/** → mã lỗi khi server tự kết thúc job thay vì nhận kết quả (worker nhận 409). */
async function applyResult(t: DbLike, job: Job, attempt: number, result: JobResult): Promise<string | undefined> {
  const owner = job.userId;
  switch (result.type) {
    case "chapter.ingest":
      return applyIngest(t, job, result);
    case "page.prepare": {
      if (!job.pageId) throw new Error("page.prepare without page_id");
      requireRev(job, result.clean_rev, "clean");
      requireRev(job, result.mask_rev, "mask");
      await requireObjects([
        storageKeys.clean(owner, job.pageId, result.clean_rev),
        storageKeys.mask(owner, job.pageId, result.mask_rev),
      ]);
      // Khoá chương trước khi ghi page (thứ tự chapter → pages như chuỗi dịch) — không deadlock với advance. Sau khi
      // HEAD storage xong: không giữ khoá chương qua lời gọi mạng.
      if (job.chapterId) await lockChapter(t, owner, job.chapterId);
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
      if (job.chapterId) {
        await refreshChapter(t, owner, job.chapterId);
        await advanceTranslateChain(t, owner, job.chapterId);
      }
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
      await lockChapter(t, owner, p.chapter_id);
      const rows = await t.select().from(pages).where(inArray(pages.id, p.page_ids));
      const dims = new Map(rows.map((r) => [r.id, r]));
      for (const r of result.pages) {
        const pg = dims.get(r.page_id);
        if (!pg || r.ai_state.size.w !== pg.width || r.ai_state.size.h !== pg.height) {
          throw new JobHttpError(400, "state_size_mismatch", `ai_state.size ≠ kích thước page ${r.page_id}`);
        }
      }
      for (const r of result.pages) {
        await writeAiState(t, { userId: owner, pageId: r.page_id, aiState: r.ai_state, actor: `job:${job.id}` });
      }
      if (got.size)
        await t
          .update(pages)
          .set({ status: "ready" })
          .where(inArray(pages.id, [...got]));
      const missing = p.page_ids.filter((id) => !got.has(id));
      if (missing.length) {
        await t.update(pages).set({ status: "failed" }).where(inArray(pages.id, missing));
        // Worker chỉ bỏ page khi AI trả sai định dạng cả lúc dịch riêng page đó (các page khác vẫn lưu) → ghi lỗi
        // lên job để UI gom page lỗi đúng nguyên nhân.
        await t
          .update(jobs)
          .set({ errorClass: "schema", error: `AI trả sai định dạng ở ${missing.length} trang; các trang khác đã lưu` })
          .where(eq(jobs.id, job.id));
      }
      await t.update(pages).set({ translateQueued: false }).where(inArray(pages.id, p.page_ids));
      await refreshChapter(t, owner, p.chapter_id);
      await advanceTranslateChain(t, owner, p.chapter_id);
      return undefined;
    }
    case "page.reinpaint": {
      if (!job.pageId) throw new Error("page.reinpaint without page_id");
      requireRev(job, result.clean_rev, "clean");
      await requireObjects([storageKeys.clean(owner, job.pageId, result.clean_rev)]);
      const p = job.payload;
      if (p.type !== "page.reinpaint") throw new Error("payload mismatch");
      // Chỉ nhận khi ảnh sạch vẫn là ảnh job dựng lên: 2 lần xoá chạy cùng lúc (khung OCR + Mask) thì lần xong sau
      // không được ghi đè mất kết quả lần trước. Route chỉ kiểm rev lúc enqueue (job đang chạy chưa đổi rev).
      const moved = await t
        .update(pages)
        .set({ cleanRev: result.clean_rev })
        .where(and(eq(pages.id, job.pageId), eq(pages.cleanRev, p.base_clean_rev)))
        .returning({ id: pages.id });
      if (!moved.length) {
        await terminal(
          t,
          job,
          "failed",
          "invalid_input",
          "clean_rev_changed: ảnh đã được xoá chữ ở lần khác trong lúc chạy — làm lại thao tác này",
        );
        return "clean_rev_changed";
      }
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
    case "chapter.proofread":
      await applyProofread(t, job, result);
      return undefined;
  }
}

/**
 * So bản dịch bỏ qua khác biệt Unicode / khoảng trắng trong dòng (gợi ý "sửa" mà chỉ đổi dấu cách = không phải gợi
 * ý) nhưng giữ xuống dòng tay (`\n` = ngắt dòng cứng khi typeset). Khớp `norm_text` ở worker và web.
 */
const normText = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((ln) => ln.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
const sameText = (a: string, b: string) => normText(a) === normText(b);

/**
 * Gợi ý hiệu đính thay toàn bộ gợi ý cũ của chương. Chặn lại phía server (worker đã lọc): page ngoài job, vùng không
 * có trong state hiện tại, gợi ý trùng bản cũ, trùng vùng (giữ cái đầu). Không đụng page_state.
 */
async function applyProofread(t: DbLike, job: Job, result: Extract<JobResult, { type: "chapter.proofread" }>) {
  const p = job.payload;
  if (p.type !== "chapter.proofread") throw new Error("payload mismatch");
  // Khoá dòng chương: 2 lượt hiệu đính complete cùng lúc chạy tuần tự (không đụng unique (page, region)).
  await lockChapter(t, job.userId, p.chapter_id);
  // Lượt cũ xong sau lượt mới hơn đã nhận kết quả → bỏ (không đè gợi ý mới + lượt Bỏ của người dùng).
  const [newer] = await t
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.chapterId, p.chapter_id),
        eq(jobs.type, "chapter.proofread"),
        eq(jobs.status, "succeeded"),
        ne(jobs.id, job.id),
        // So trong SQL: Date của JS mất micro giây của timestamptz.
        gt(jobs.createdAt, sql`(select j.created_at from jobs j where j.id = ${job.id})`),
      ),
    )
    .limit(1);
  if (newer) return;
  const states = await t
    .select({ pageId: pageStates.pageId, state: pageStates.state })
    .from(pageStates)
    .where(inArray(pageStates.pageId, p.page_ids));
  const regionsOf = new Map(states.map((r) => [r.pageId, new Set((r.state?.regions ?? []).map((g) => g.id))]));
  const seen = new Set<string>();
  const rows = result.suggestions.filter((sg) => {
    const key = `${sg.page_id}:${sg.region_id}`;
    if (seen.has(key) || !regionsOf.get(sg.page_id)?.has(sg.region_id) || sameText(sg.old, sg.suggestion)) return false;
    seen.add(key);
    return true;
  });
  await t.delete(proofreadSuggestions).where(eq(proofreadSuggestions.chapterId, p.chapter_id));
  if (rows.length) {
    await t.insert(proofreadSuggestions).values(
      rows.map((sg) => ({
        userId: job.userId,
        chapterId: p.chapter_id,
        pageId: sg.page_id,
        jobId: job.id,
        regionId: sg.region_id,
        oldText: sg.old.normalize("NFC"),
        suggestion: sg.suggestion.normalize("NFC"),
        reason: sg.reason.normalize("NFC"),
      })),
    );
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
    .set({ status, errorClass, error: message.slice(0, 4000), stage: null, progressDone: null, progressTotal: null })
    .where(eq(jobs.id, job.id));
  const p = job.payload;
  const owner = job.userId;
  switch (p.type) {
    case "chapter.ingest":
      // Huỷ ingest = chưa commit → về draft (commit lại được); lỗi → partial_failed.
      // Lượt mở lúc commit đóng theo (commit lại mở lượt mới).
      await t
        .update(chapters)
        .set({ status: status === "failed" ? "partial_failed" : "draft", runTarget: null })
        .where(
          and(eq(chapters.id, p.chapter_id), eq(chapters.ingestRev, p.ingest_rev), eq(chapters.status, "ingesting")),
        );
      return;
    case "page.prepare": {
      if (job.chapterId) await lockChapter(t, owner, job.chapterId);
      // Quét lại trang đã có OCR (kết quả cũ chưa bị thay): giữ trang dùng được như trước — đã dịch → ready, chưa →
      // prepared. Chỉ trang chưa từng có OCR mới thành failed.
      const [prev] = await t
        .select({ ocr: pages.ocrResult, rev: pages.prepareInputRev, aiRev: pageStates.aiRev })
        .from(pages)
        .leftJoin(pageStates, eq(pageStates.pageId, pages.id))
        .where(eq(pages.id, p.page_id));
      const kept = prev?.ocr && prev.rev ? ((prev.aiRev ?? 0) > 0 ? "ready" : "prepared") : "failed";
      // OCR không đổi → bỏ trang khỏi lượt (dịch lại đúng input cũ chỉ tốn tiền).
      await t
        .update(pages)
        .set(kept === "failed" ? { status: kept } : { status: kept, translateQueued: false })
        .where(eq(pages.id, p.page_id));
      // Huỷ page cuối của giai đoạn 1: page còn lại đã prepare → chương `prepared` (chờ "Dịch"), không kẹt processing.
      if (job.chapterId) {
        await refreshChapter(t, owner, job.chapterId);
        // Trang lỗi không chặn phần còn lại của lượt dịch; người dùng huỷ thì dừng cả lượt.
        if (status === "failed") await advanceTranslateChain(t, owner, job.chapterId);
        else await stopTranslateChain(t, owner, job.chapterId);
      }
      return;
    }
    case "chapter.translate": {
      await lockChapter(t, owner, p.chapter_id);
      // Page đang chờ/đang dịch: đã có bản AI trước (dịch lại) → giữ `ready`; chưa có → `failed` chỉ khi lô đã
      // chạy mà lỗi hẳn. Lô bị huỷ hoặc chưa từng được claim (VD bỏ vì vượt hạn mức) → trang về `prepared`, dịch lại
      // bằng "Dịch" như trang chưa dịch.
      const affected = await t
        .select({ id: pages.id, aiRev: pageStates.aiRev })
        .from(pages)
        .innerJoin(pageStates, eq(pageStates.pageId, pages.id))
        .where(and(inArray(pages.id, p.page_ids), inArray(pages.status, ["translating", "prepared"])));
      const untranslated = status === "failed" && job.claimedAt ? "failed" : "prepared";
      for (const [to, ids] of [
        ["ready", affected.filter((r) => r.aiRev > 0).map((r) => r.id)],
        [untranslated, affected.filter((r) => r.aiRev === 0).map((r) => r.id)],
      ] as const) {
        if (ids.length) await t.update(pages).set({ status: to }).where(inArray(pages.id, ids));
      }
      await t.update(pages).set({ translateQueued: false }).where(inArray(pages.id, p.page_ids));
      await refreshChapter(t, owner, p.chapter_id);
      // Lô lỗi hẳn không chặn chuỗi: lô kế chạy tiếp; huỷ thì dừng cả lượt.
      if (status === "failed") await advanceTranslateChain(t, owner, p.chapter_id);
      else await stopTranslateChain(t, owner, p.chapter_id);
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
      progressDone: null,
      progressTotal: null,
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
      progressDone: null,
      progressTotal: null,
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
    if (req.error_class === "provider" || req.error_class === "rate_limited") {
      for (const key of breakerKeysOf(job.payload)) await recordProviderError(t, key);
    }
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
    storageKeys.clean(job.userId, job.pageId, partial.clean_rev),
    storageKeys.mask(job.userId, job.pageId, partial.mask_rev),
  ]);
  await t
    .update(pages)
    .set({ preparePartial: { ...partial, input_rev: job.inputRev } })
    .where(eq(pages.id, job.pageId));
}

/** Huỷ job từ phía người dùng (chỉ job của chính họ). Job đang chạy: worker nhận `stop: "cancel"` ở heartbeat kế. */
export async function cancelJob(userId: string, jobId: string): Promise<Job | null> {
  return tx(async (t) => {
    const [job] = await t
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
      .for("update");
    if (!job) return null;
    if (!["queued", "running", "paused_budget"].includes(job.status)) return job;
    await terminal(t, job, "cancelled", "internal", "cancelled by user");
    const [after] = await t.select().from(jobs).where(eq(jobs.id, job.id));
    return after ?? null;
  });
}
