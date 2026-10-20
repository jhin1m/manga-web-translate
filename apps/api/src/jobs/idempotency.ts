/**
 * input_rev + idempotency_key cho từng loại job. Cùng input → cùng key → enqueue trùng khi job còn active
 * trả lại job cũ; job cũ đã terminal thì tạo job mới (partial unique index, xem packages/db jobs).
 */

import { createHash } from "node:crypto";
import { idempotencyKey, type JobPayload, prepareInputRev, translateInputRev } from "@mtl/shared";
import { env } from "../env.ts";

export type JobKey = { inputRev: string; idempotencyKey: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function ingestKey(chapterId: string, ingestRev: number, mode: string, sourceIds: string[]): JobKey {
  const inputRev = sha([ingestRev, [...sourceIds].sort().join(","), env.PIPELINE_VERSION].join("|"));
  return { inputRev, idempotencyKey: idempotencyKey("chapter.ingest", chapterId, inputRev, { mode }) };
}

export function prepareKey(pageId: string, originalSha256: string, settingsRev: number): JobKey {
  const inputRev = prepareInputRev(originalSha256, settingsRev, env.PIPELINE_VERSION);
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
