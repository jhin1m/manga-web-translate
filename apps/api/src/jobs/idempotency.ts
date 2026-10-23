/**
 * input_rev + idempotency_key cho từng loại job. Cùng input → cùng key → enqueue trùng khi job còn active
 * trả lại job cũ; job cũ đã terminal thì tạo job mới (partial unique index, xem packages/db jobs).
 */

import { createHash } from "node:crypto";
import { idempotencyKey, type JobPayload, type PrepareOptions, prepareInputRev, translateInputRev } from "@mtl/shared";
import { env } from "../env.ts";

export type JobKey = { inputRev: string; idempotencyKey: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function ingestKey(chapterId: string, ingestRev: number, mode: string, sourceIds: string[]): JobKey {
  const inputRev = sha([ingestRev, [...sourceIds].sort().join(","), env.PIPELINE_VERSION].join("|"));
  return { inputRev, idempotencyKey: idempotencyKey("chapter.ingest", chapterId, inputRev, { mode }) };
}

/** `options` = cài đặt pipeline đã snapshot; khác mặc định mới đổi input_rev (page cũ không bị coi là lỗi thời). */
export function prepareKey(
  pageId: string,
  originalSha256: string,
  settingsRev: number,
  options?: PrepareOptions,
): JobKey {
  const inputRev = prepareInputRev(originalSha256, settingsRev, env.PIPELINE_VERSION, options);
  return { inputRev, idempotencyKey: idempotencyKey("page.prepare", pageId, inputRev) };
}

export function translateKey(
  chapterId: string,
  pages: ReadonlyArray<{ pageId: string; prepareInputRev: string }>,
  glossaryRev: number,
  settingsRev: number,
  context: "rolling" | "neighbors",
): JobKey {
  const inputRev = translateInputRev(pages, glossaryRev, settingsRev, env.PIPELINE_VERSION);
  return { inputRev, idempotencyKey: idempotencyKey("chapter.translate", chapterId, inputRev, { context }) };
}

/** page.reinpaint / page.ocr_region: input = payload (đã có base rev / bbox) + pipeline_version. */
export function pageOpKey(payload: Extract<JobPayload, { type: "page.reinpaint" | "page.ocr_region" }>): JobKey {
  const { type, page_id, ...opts } = payload;
  const inputRev = sha(JSON.stringify([opts, env.PIPELINE_VERSION]));
  return { inputRev, idempotencyKey: idempotencyKey(type, page_id, inputRev, opts) };
}

/**
 * chapter.proofread: input = version page_state từng page + glossary/settings rev + model → bấm lại khi chưa sửa gì
 * trả job đang chạy; sửa xong bấm lại là lượt mới.
 */
export function proofreadKey(
  chapterId: string,
  pages: ReadonlyArray<{ id: string; version: number }>,
  glossaryRev: number,
  settingsRev: number,
  tier: string,
): JobKey {
  const items = pages.map((p) => `${p.id}:${p.version}`).sort();
  const inputRev = sha([items.join(","), glossaryRev, settingsRev, env.PIPELINE_VERSION].join("|"));
  return { inputRev, idempotencyKey: idempotencyKey("chapter.proofread", chapterId, inputRev, { tier }) };
}

/**
 * chapter.export: input = trạng thái từng page lúc enqueue (version state + clean_rev + status) → bấm xuất lại khi
 * job cũ còn chạy và chương chưa đổi thì trả job cũ.
 */
export function exportKey(
  payload: Extract<JobPayload, { type: "chapter.export" }>,
  pages: ReadonlyArray<{ id: string; version: number; cleanRev: number | null; status: string }>,
): JobKey {
  const { type, chapter_id, ...opts } = payload;
  const items = pages.map((p) => `${p.id}:${p.version}:${p.cleanRev ?? "-"}:${p.status}`).sort();
  const inputRev = sha([items.join(","), env.PIPELINE_VERSION].join("|"));
  return { inputRev, idempotencyKey: idempotencyKey(type, chapter_id, inputRev, opts) };
}
