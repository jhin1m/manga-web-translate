/**
 * Ghi usage_ledger từ số đếm thô của worker (heartbeat = delta, complete/fail = phần còn lại).
 * Clamp ở server: tổng token ra của attempt ≤ MAX_OUTPUT_TOKENS_PER_CALL · số call tối đa của job, token ra
 * mỗi báo cáo ≤ MAX_OUTPUT_TOKENS_PER_CALL · calls, tổng gpu_s ≤ thời gian thực từ claim.
 * Unique (job_id, attempt, seq, kind) + ON CONFLICT DO NOTHING → gửi lại cùng seq không đếm đôi.
 */
import { type DbLike, type jobs, usageLedger } from "@mtl/db";
import type { JobPayload, WorkerUsage } from "@mtl/shared";
import { and, eq, sql } from "drizzle-orm";
import { GPU_USD_PER_S, llmPrice, MAX_INPUT_TOKENS_PER_CALL, MAX_OUTPUT_TOKENS_PER_CALL } from "./prices.ts";

type Job = typeof jobs.$inferSelect;
type Kind = "llm_tokens_in" | "llm_tokens_out" | "gpu_seconds" | "pages" | "gpu_idle_seconds";
export type WorkerKind = keyof typeof GPU_USD_PER_S;

/** seq 0 dành cho dòng server tự ghi (VD số page khi ingest); worker dùng seq ≥ 1. */
export const SERVER_SEQ = 0;
/** Bù trễ đồng hồ/mạng khi so gpu_s với thời gian từ claim. */
const GPU_SLACK_S = 5;

/** Số call LLM tối đa một attempt có thể dùng (mỗi call được retry 1 lần khi JSON sai). */
export function maxLlmCalls(payload: JobPayload): number {
  switch (payload.type) {
    case "page.prepare":
      return 2;
    case "chapter.translate":
      return 2 * payload.page_ids.length + 2;
    case "page.ocr_region":
      return 4;
    default:
      return 0;
  }
}

async function attemptTotals(tx: DbLike, jobId: string, attempt: number) {
  const rows = await tx
    .select({ kind: usageLedger.kind, q: sql<string>`coalesce(sum(${usageLedger.quantity}), 0)` })
    .from(usageLedger)
    .where(and(eq(usageLedger.jobId, jobId), eq(usageLedger.attempt, attempt)))
    .groupBy(usageLedger.kind);
  const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.q)]));
  return { in: by.llm_tokens_in ?? 0, out: by.llm_tokens_out ?? 0, gpu: by.gpu_seconds ?? 0 };
}

/** Clamp + tính tiền + ghi. Trả số dòng mới (0 khi seq đã ghi). */
export async function recordUsage(
  tx: DbLike,
  job: Job,
  attempt: number,
  usage: WorkerUsage,
  worker: WorkerKind,
): Promise<number> {
  const maxCalls = maxLlmCalls(job.payload);
  const calls = Math.min(usage.calls, maxCalls);
  const prev = await attemptTotals(tx, job.id, attempt);
  const llmIn = Math.max(
    0,
    Math.min(usage.llm_in, MAX_INPUT_TOKENS_PER_CALL * calls, MAX_INPUT_TOKENS_PER_CALL * maxCalls - prev.in),
  );
  const llmOut = Math.max(
    0,
    Math.min(usage.llm_out, MAX_OUTPUT_TOKENS_PER_CALL * calls, MAX_OUTPUT_TOKENS_PER_CALL * maxCalls - prev.out),
  );
  const elapsedS = job.claimedAt ? (Date.now() - job.claimedAt.getTime()) / 1000 + GPU_SLACK_S : 0;
  const gpuS = Math.max(0, Math.min(usage.gpu_s, elapsedS - prev.gpu));

  const { price, known } = llmPrice(usage.model);
  if ((llmIn > 0 || llmOut > 0) && !known) {
    console.warn(`[ledger] model chưa có giá "${usage.model}" — tính theo giá cao nhất`);
  }
  const rows: { kind: Kind; quantity: number; unit: number }[] = [
    { kind: "llm_tokens_in", quantity: llmIn, unit: price.in / 1e6 },
    { kind: "llm_tokens_out", quantity: llmOut, unit: price.out / 1e6 },
    { kind: "gpu_seconds", quantity: Math.round(gpuS * 1000) / 1000, unit: GPU_USD_PER_S[worker] },
  ];
  return insertRows(tx, job, attempt, usage.seq, rows);
}

/** Dòng server tự ghi (không từ worker), VD `pages` khi ingest xong. */
export function recordServerUsage(tx: DbLike, job: Job, attempt: number, kind: Kind, quantity: number) {
  return insertRows(tx, job, attempt, SERVER_SEQ, [{ kind, quantity, unit: 0 }]);
}

/**
 * Chi phí nền tảng theo dispatch Modal (workspace_id + job_id null), VD GPU rỗi của container. Unique
 * (dispatch_id, kind) → ghi tối đa 1 lần mỗi dispatch (báo lại / reaper ước lượng sau → bỏ qua). Trả true nếu ghi.
 */
export async function recordDispatchUsage(
  tx: DbLike,
  dispatchId: string,
  kind: Kind,
  quantity: number,
  unit: number,
): Promise<boolean> {
  const q = Math.round(Math.max(0, quantity) * 1000) / 1000;
  const inserted = await tx
    .insert(usageLedger)
    .values({ workspaceId: null, jobId: null, dispatchId, kind, quantity: q, unitCostUsd: unit, costUsd: q * unit })
    .onConflictDoNothing()
    .returning({ id: usageLedger.id });
  return inserted.length > 0;
}

async function insertRows(
  tx: DbLike,
  job: Job,
  attempt: number,
  seq: number,
  rows: { kind: Kind; quantity: number; unit: number }[],
): Promise<number> {
  const values = rows
    .filter((r) => r.quantity > 0)
    .map((r) => ({
      workspaceId: job.workspaceId,
      jobId: job.id,
      attempt,
      seq,
      kind: r.kind,
      quantity: r.quantity,
      unitCostUsd: r.unit,
      costUsd: r.quantity * r.unit,
    }));
  if (values.length === 0) return 0;
  const inserted = await tx
    .insert(usageLedger)
    .values(values)
    .onConflictDoNothing({ target: [usageLedger.jobId, usageLedger.attempt, usageLedger.seq, usageLedger.kind] })
    .returning({ id: usageLedger.id });
  return inserted.length;
}
