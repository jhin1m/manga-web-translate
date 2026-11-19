/**
 * Chương bận đang chạy hay đang xếp hàng chờ worker — để UI không vẽ chương chờ giống chương đang chạy (người dùng
 * tưởng treo). Chỉ đọc, không ảnh hưởng claim.
 *
 * - `waiting`: chương `ingesting` / `processing` có job `queued` mà worker nhận được ngay, không job nào `running`
 *   còn lease, và không job nào vừa kết thúc trong `SETTLE_MS`. "Nhận được ngay" bám theo bộ lọc của claim:
 *   `run_after <= now` (job đang backoff chờ AI thử lại không tính — UI đã có "Chờ AI") và không bị breaker provider
 *   chặn (provider đang tạm dừng vì lỗi dồn dập → worker rảnh vẫn không nhận, không phải "chờ worker rảnh"). Job
 *   `running` hết lease (worker chết) không tính là đang chạy — reaper sẽ trả nó về hàng đợi. `SETTLE_MS`: worker
 *   claim job kế ngay sau khi xong job trước, khoảng hở đó không được hiện thành "Đang chờ lượt".
 * - `no_worker`: như `waiting` nhưng bản self-host không thấy worker nào gọi API gần đây (vd worker còn tải model lần
 *   đầu hoặc đã dừng). Bản nhiều người dùng không trả trạng thái này: worker Modal bật theo nhu cầu nên vắng mặt là bình
 *   thường.
 */
import { jobs, workerTokens } from "@mtl/db";
import { and, gt, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { breakerBlockedSql, pausedBreakerKeys } from "./breaker.ts";

export type QueueState = "waiting" | "no_worker";

/** Chương ở trạng thái này mới có thể đang chờ worker. */
export const BUSY_CHAPTER_STATUSES: readonly string[] = ["ingesting", "processing"];

/**
 * Worker idle claim tối đa mỗi 30s, worker bận heartbeat 20s, `last_seen_at` ghi tối đa 1 lần/phút (worker-token.ts)
 * → 180s không thấy là không có worker nào chạy.
 */
const WORKER_SEEN_WINDOW_MS = 180_000;
/** Job của chương vừa kết thúc trong khoảng này → worker có thể đang claim job kế, chưa coi là chờ. */
const SETTLE_MS = 5_000;

type BusyChapter = { id: string; userId: string; status: string };

/** Self-host: có worker nào gọi API trong cửa sổ gần đây không. Bản nhiều người dùng luôn coi là có. */
async function workerSeen(now: Date): Promise<boolean> {
  if (!env.MTL_LOCAL_MODE) return true;
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(workerTokens)
    .where(
      and(isNull(workerTokens.revokedAt), gt(workerTokens.lastSeenAt, new Date(now.getTime() - WORKER_SEEN_WINDOW_MS))),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Trạng thái chờ của các chương (chỉ xét chương bận; chương khác bỏ qua). Chương không chờ thì không có trong Map.
 * Một truy vấn gom theo chương (theo `jobs_chapter_idx`, lọc thêm `user_id` của chính chương) + đọc breaker; thêm một
 * truy vấn worker khi có chương chờ ở bản self-host.
 */
export async function chapterQueueStates(chs: readonly BusyChapter[], now = new Date()) {
  const out = new Map<string, QueueState>();
  const busy = chs.filter((c) => BUSY_CHAPTER_STATUSES.includes(c.status));
  if (!busy.length) return out;
  const at = now.toISOString();
  const settledSince = new Date(now.getTime() - SETTLE_MS).toISOString();
  const paused = await pausedBreakerKeys(db, now);
  const blocked: SQL = paused.length ? breakerBlockedSql(paused) : sql`false`;
  const rows = await db
    .select({
      chapterId: jobs.chapterId,
      running: sql<boolean>`bool_or(${jobs.status} = 'running' and ${jobs.leaseExpiresAt} > ${at})`,
      ready: sql<boolean>`bool_or(${jobs.status} = 'queued' and ${jobs.runAfter} <= ${at} and not ${blocked})`,
      settling: sql<boolean>`bool_or(${jobs.status} not in ('queued', 'running'))`,
    })
    .from(jobs)
    .where(
      and(
        inArray(
          jobs.chapterId,
          busy.map((c) => c.id),
        ),
        inArray(jobs.userId, [...new Set(busy.map((c) => c.userId))]),
        sql`(${jobs.status} in ('queued', 'running') or ${jobs.updatedAt} > ${settledSince})`,
      ),
    )
    .groupBy(jobs.chapterId);
  const waiting = rows.filter((r) => r.ready && !r.running && !r.settling).flatMap((r) => r.chapterId ?? []);
  if (!waiting.length) return out;
  const state: QueueState = (await workerSeen(now)) ? "waiting" : "no_worker";
  for (const id of waiting) out.set(id, state);
  return out;
}

/**
 * Trạng thái chờ của một chương (route progress) + số chương khác đang có job chạy (mọi người dùng, chỉ con số) để
 * UI nói "N chương đang chạy". null = chương không chờ.
 */
export async function chapterQueueView(
  ch: BusyChapter,
  now = new Date(),
): Promise<{ state: QueueState; running_chapters: number } | null> {
  const state = (await chapterQueueStates([ch], now)).get(ch.id);
  if (!state) return null;
  const running = await db
    .selectDistinct({ chapterId: jobs.chapterId })
    .from(jobs)
    .where(and(sql`${jobs.status} = 'running'`, gt(jobs.leaseExpiresAt, now)));
  return { state, running_chapters: running.filter((r) => r.chapterId && r.chapterId !== ch.id).length };
}
