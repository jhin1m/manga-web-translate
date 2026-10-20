/**
 * Dựng `inputs` (presigned GET) và `outputs` (presigned PUT, TTL ≤ lease còn lại) cho job vừa claim.
 * Hình dạng theo packages/shared/src/worker-protocol.ts (*Inputs).
 */
import { type DbLike, type jobs, pageStates, pages, sourceFiles } from "@mtl/db";
import { type JobPayload, keyBelongsToWorkspace, type OcrResult, type PageState, storageKeys } from "@mtl/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { MAX_PUT_TTL_S, presignGet, presignPut } from "../storage.ts";

type Job = typeof jobs.$inferSelect;
type Page = typeof pages.$inferSelect;

/** Input tải ngay sau claim; 10' đủ cho strip lớn qua mạng nhà. */
const INPUT_GET_TTL_S = 10 * 60;
const MAX_CONTEXT_LINES = 24;
export const PNG = "image/png";

export type PresignedOutput = { key: string; rev: number | null; put: string; expires_at: string };

export function putTtl(leaseExpiresAt: Date): number {
  return Math.max(1, Math.min(MAX_PUT_TTL_S, Math.floor((leaseExpiresAt.getTime() - Date.now()) / 1000)));
}

/** Key output theo tên (clean/mask dùng rev cấp lúc claim; page:<ord> cho ingest). null = tên không hợp lệ với job. */
export function outputKey(job: Job, name: string): { key: string; rev: number | null } | null {
  const p = job.payload;
  if ((name === "clean" || name === "mask") && job.outputRev !== null && job.pageId) {
    if (name === "mask" && p.type !== "page.prepare") return null;
    return { key: storageKeys[name](job.workspaceId, job.pageId, job.outputRev), rev: job.outputRev };
  }
  const m = /^page:(\d+)$/.exec(name);
  if (m && p.type === "chapter.ingest") {
    return { key: storageKeys.ingestPage(job.workspaceId, p.chapter_id, p.ingest_rev, Number(m[1])), rev: null };
  }
  return null;
}

export async function presignOutputs(job: Job, names: string[]): Promise<Record<string, PresignedOutput>> {
  if (!job.leaseExpiresAt) throw new Error("job has no lease");
  const ttl = putTtl(job.leaseExpiresAt);
  const expires = new Date(Date.now() + ttl * 1000).toISOString();
  const out: Record<string, PresignedOutput> = {};
  for (const name of names) {
    const k = outputKey(job, name);
    if (!k) throw new HTTPException(400, { message: `output "${name}" not valid for ${job.type}` });
    out[name] = { ...k, put: await presignPut(k.key, PNG, ttl), expires_at: expires };
  }
  return out;
}

/** Output cấp sẵn lúc claim (ingest xin URL sau qua presign-outputs vì chưa biết số page). */
export function claimOutputNames(payload: JobPayload): string[] {
  if (payload.type === "page.prepare") return ["clean", "mask"];
  if (payload.type === "page.reinpaint") return ["clean"];
  return [];
}

const get = (key: string) => presignGet(key, INPUT_GET_TTL_S);

async function pageById(tx: DbLike, id: string): Promise<Page> {
  const [p] = await tx.select().from(pages).where(eq(pages.id, id));
  if (!p) throw new Error(`page ${id} missing`);
  return p;
}

/** Dòng ngữ cảnh của 1 page: nguồn OCR (+ bản dịch từ state hiện tại nếu `withTranslation`). */
function pageLines(ocr: OcrResult | null, state: PageState | null, withTranslation: boolean) {
  if (!ocr) return [];
  const tr = new Map((state?.regions ?? []).map((r) => [r.id, r.translation]));
  return ocr.items
    .filter((it) => !it.empty && !it.is_sfx && it.source.trim())
    .map((it) => ({ source: it.source, translation: withTranslation ? (tr.get(it.id) ?? "") : "" }));
}

/** context=neighbors: với mỗi đoạn page liên tiếp được dịch lại, lấy trang ngay trước (nguồn + dịch) và ngay sau (nguồn). */
async function neighborLines(tx: DbLike, chapterId: string, targetIds: string[]) {
  const all = await tx
    .select({ id: pages.id, ord: pages.ord, ocr: pages.ocrResult, state: pageStates.state })
    .from(pages)
    .leftJoin(pageStates, eq(pageStates.pageId, pages.id))
    .where(eq(pages.chapterId, chapterId))
    .orderBy(asc(pages.ord));
  const target = new Set(targetIds);
  const lines: { source: string; translation: string }[] = [];
  all.forEach((p, i) => {
    if (target.has(p.id)) return;
    const prevIsTarget = i > 0 && target.has(all[i - 1]?.id ?? "");
    const nextIsTarget = i + 1 < all.length && target.has(all[i + 1]?.id ?? "");
    if (nextIsTarget) lines.push(...pageLines(p.ocr, p.state, true).slice(-MAX_CONTEXT_LINES / 2));
    else if (prevIsTarget) lines.push(...pageLines(p.ocr, p.state, false).slice(0, MAX_CONTEXT_LINES / 2));
  });
  return lines.slice(0, MAX_CONTEXT_LINES);
}

export async function buildInputs(tx: DbLike, job: Job): Promise<Record<string, unknown>> {
  const p = job.payload;
  switch (p.type) {
    case "chapter.ingest": {
      const rows = await tx
        .select()
        .from(sourceFiles)
        .where(and(eq(sourceFiles.chapterId, p.chapter_id), eq(sourceFiles.workspaceId, job.workspaceId)))
        .orderBy(asc(sourceFiles.ord));
      return {
        sources: await Promise.all(
          rows.map(async (s) => ({
            source_file_id: s.id,
            url: await get(s.storageKey),
            width: s.width,
            height: s.height,
          })),
        ),
      };
    }
    case "page.prepare": {
      const page = await pageById(tx, p.page_id);
      const partial = page.preparePartial?.input_rev === job.inputRev ? page.preparePartial : null;
      return {
        original: await get(page.originalKey),
        partial: partial && {
          clean: await get(storageKeys.clean(job.workspaceId, page.id, partial.clean_rev)),
          mask: await get(storageKeys.mask(job.workspaceId, page.id, partial.mask_rev)),
          regions: partial.regions,
        },
      };
    }
    case "chapter.translate": {
      const rows = await tx
        .select()
        .from(pages)
        .where(and(eq(pages.chapterId, p.chapter_id), inArray(pages.id, p.page_ids)))
        .orderBy(asc(pages.ord));
      return {
        pages: await Promise.all(
          rows.map(async (pg) => {
            if (!pg.ocrResult || pg.cleanRev === null) throw new Error(`page ${pg.id} not prepared`);
            return {
              page_id: pg.id,
              ord: pg.ord,
              width: pg.width,
              height: pg.height,
              ocr_result: pg.ocrResult,
              clean: await get(storageKeys.clean(job.workspaceId, pg.id, pg.cleanRev)),
            };
          }),
        ),
        context_lines: p.context === "neighbors" ? await neighborLines(tx, p.chapter_id, p.page_ids) : [],
      };
    }
    case "page.reinpaint": {
      if (!keyBelongsToWorkspace(p.user_mask_key, job.workspaceId)) throw new Error("user mask key outside workspace");
      return {
        base_clean: await get(storageKeys.clean(job.workspaceId, p.page_id, p.base_clean_rev)),
        user_mask: await get(p.user_mask_key),
      };
    }
    case "page.ocr_region": {
      const page = await pageById(tx, p.page_id);
      const [st] = await tx.select().from(pageStates).where(eq(pageStates.pageId, page.id));
      return {
        original: await get(page.originalKey),
        context_lines: pageLines(page.ocrResult, st?.state ?? null, true).slice(0, MAX_CONTEXT_LINES),
      };
    }
    case "chapter.export":
      return {};
  }
}
