/**
 * Trí nhớ series: (1) carry cuối lượt dịch cả chương lưu ở `chapters.translate_memory` để lô đầu của chương khác
 * trong series mở đầu bằng nó; (2) thuật ngữ / cặp xưng hô AI học được lưu thành gợi ý chờ duyệt
 * (`series_suggestions`). Không import `jobs/*` (jobs/* import file này).
 */
import {
  chapters,
  type DbLike,
  glossaryEntries,
  type jobs,
  pages,
  type Scoped,
  type series,
  seriesSuggestions,
} from "@mtl/db";
import {
  type JobResult,
  type LearnedPronoun,
  type LearnedTerm,
  normKey,
  pronounKey,
  type SuggestionKind,
  type TranslateCarry,
  TranslateMemory,
  termKey,
} from "@mtl/shared";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { seriesGlossaryWhere } from "./glossary-scope.ts";

type Series = typeof series.$inferSelect;
type Chapter = typeof chapters.$inferSelect;
type Job = typeof jobs.$inferSelect;
type TranslateResult = Extract<JobResult, { type: "chapter.translate" }>;

/** Trần gợi ý chờ duyệt (chưa Bỏ) của mỗi loại trong một series. */
export const MAX_PENDING_PER_KIND = 200;

/**
 * Trí nhớ của chương khác trong series, cùng cặp ngôn ngữ: số chương ≤ chương hiện tại gần nhất; không có thì số lớn
 * hơn gần nhất. Không bao giờ lấy chính chương đang dịch. So số trong SQL (`number` là numeric, so chuỗi sẽ sai).
 * Chỉ trả `{ notes, characters }` để payload giữ đúng hợp đồng `TranslateCarry`.
 */
export async function memoryCarry(tx: DbLike, ch: Chapter, s: Series): Promise<TranslateCarry | undefined> {
  const cur = sql`${ch.number}::numeric`;
  const [row] = await tx
    .select({ memory: chapters.translateMemory })
    .from(chapters)
    .where(
      and(
        eq(chapters.seriesId, ch.seriesId),
        eq(chapters.userId, ch.userId),
        sql`${chapters.id} <> ${ch.id}`,
        sql`${chapters.translateMemory} is not null`,
        sql`${chapters.translateMemory}->>'source_lang' = ${s.sourceLang}`,
        sql`${chapters.translateMemory}->>'target_lang' = ${s.targetLang}`,
      ),
    )
    .orderBy(
      sql`(${chapters.number} <= ${cur}) desc`,
      sql`abs(${chapters.number} - ${cur})`,
      sql`${chapters.updatedAt} desc`,
    )
    .limit(1);
  if (!row) return undefined;
  const parsed = TranslateMemory.safeParse(row.memory);
  if (!parsed.success) return undefined;
  return { notes: parsed.data.notes, characters: parsed.data.characters };
}

type Covered = { terms: Set<string>; pronouns: Set<string> };

/** Khoá đã có sẵn: nguồn trong glossary hiệu lực (riêng series + chung đúng cặp) và cặp trong pronoun_rules. */
function coveredFrom(sourceTerms: string[], s: Series): Covered {
  const pronouns = new Set<string>();
  for (const r of s.pronounRules) {
    if (typeof r.speaker === "string" && typeof r.listener === "string") {
      pronouns.add(pronounKey(r.speaker, r.listener));
    }
  }
  return { terms: new Set(sourceTerms.map(termKey)), pronouns };
}

async function coveredKeys(tx: DbLike, s: Series): Promise<Covered> {
  const rows = await tx
    .select({ sourceTerm: glossaryEntries.sourceTerm })
    .from(glossaryEntries)
    .where(seriesGlossaryWhere(s));
  return coveredFrom(
    rows.map((r) => r.sourceTerm),
    s,
  );
}

/** Dấu hỏi (ASCII và full-width) = chưa rõ người nói. */
const UNKNOWN = /[?？]/;
const clean = (v: string) => v.normalize("NFC").trim();

/** Thuật ngữ hợp lệ để gợi ý (đã chuẩn hoá) hoặc null. */
function acceptTerm(t: LearnedTerm, covered: Covered): { key: string; data: LearnedTerm } | null {
  const data = { source: clean(t.source), target: clean(t.target), kind: t.kind };
  if (!data.source || !data.target) return null;
  if (normKey(data.source) === normKey(data.target)) return null;
  const key = termKey(data.source);
  return covered.terms.has(key) ? null : { key, data };
}

function acceptPronoun(p: LearnedPronoun, covered: Covered): { key: string; data: LearnedPronoun } | null {
  const data = { speaker: clean(p.speaker), listener: clean(p.listener), address: clean(p.address) };
  if (!data.speaker || !data.listener || !data.address) return null;
  if (UNKNOWN.test(data.speaker) || UNKNOWN.test(data.listener) || data.address === "?" || data.address === "？") {
    return null;
  }
  if (normKey(data.speaker) === normKey(data.listener)) return null;
  const key = pronounKey(data.speaker, data.listener);
  return covered.pronouns.has(key) ? null : { key, data };
}

/** Giữ mục đầu tiên của mỗi khoá. */
function uniqueByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => !seen.has(i.key) && !!seen.add(i.key));
}

/**
 * Khoá mới được lưu cho một loại: bỏ khoá đã có trong bảng (kể cả đã Bỏ) trước khi cắt theo trần, để khoá cũ không
 * chiếm chỗ của khoá mới. Trần chỉ tính gợi ý còn hiện: chưa Bỏ và chưa được phủ bởi glossary / pronoun_rules.
 */
async function admit<T extends { key: string }>(
  tx: DbLike,
  seriesId: string,
  kind: SuggestionKind,
  found: T[],
  covered: Set<string>,
): Promise<T[]> {
  const existing = await tx
    .select({ key: seriesSuggestions.key, dismissedAt: seriesSuggestions.dismissedAt })
    .from(seriesSuggestions)
    .where(and(eq(seriesSuggestions.seriesId, seriesId), eq(seriesSuggestions.kind, kind)));
  const known = new Set(existing.map((r) => r.key));
  const pending = existing.filter((r) => r.dismissedAt === null && !covered.has(r.key)).length;
  const room = Math.max(0, MAX_PENDING_PER_KIND - pending);
  return found.filter((a) => !known.has(a.key)).slice(0, room);
}

/** Số trang không ẩn đã qua bước 1 (có OCR) — đúng tập mà lượt dịch cả chương nhắm tới. */
async function translatableCount(tx: DbLike, chapterId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(pages)
    .where(
      and(
        eq(pages.chapterId, chapterId),
        eq(pages.skipped, false),
        isNotNull(pages.ocrResult),
        isNotNull(pages.prepareInputRev),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Ghi trí nhớ chương khi một lượt dịch cả chương đóng bình thường (hết trang chờ), từ `carry` của lô thành công gần
 * nhất trong lượt: lô cuối lỗi thì dùng lô thành công trước đó. Lượt một phần (`runTotal` < số trang dịch được),
 * lượt bị huỷ hoặc dừng do hạn mức không đi qua đây nên không đè trí nhớ đang có. Cặp ngôn ngữ lấy theo cài đặt
 * series hiện tại, đúng thứ `memoryCarry` dùng để so khi đọc. Caller đã khoá dòng chương; chỉ ghi `chapters`.
 */
export async function rememberRunMemory(
  tx: DbLike,
  ch: Chapter,
  s: Series,
  carry: TranslateCarry | undefined,
): Promise<void> {
  if (!carry || ch.runTarget !== "translated" || ch.runTotal < (await translatableCount(tx, ch.id))) return;
  await tx
    .update(chapters)
    .set({ translateMemory: { ...carry, source_lang: s.sourceLang, target_lang: s.targetLang } })
    .where(eq(chapters.id, ch.id));
}

/**
 * Sau khi lưu trang của một lô dịch: lưu thuật ngữ / xưng hô mới thành gợi ý chờ duyệt. Chạy dưới khoá dòng chương
 * của caller; chỉ INSERT `series_suggestions` (không khoá dòng series). Input đã qua zod nên không làm hỏng
 * transaction của complete.
 */
export async function rememberSuggestions(
  tx: DbLike,
  args: { job: Job; s: Series; result: TranslateResult },
): Promise<void> {
  const { job, s, result } = args;
  const p = job.payload;
  if (p.type !== "chapter.translate") throw new Error("payload mismatch");

  const hasTerms = !!result.new_terms?.length;
  const hasPronouns = !!result.pronoun_pairs?.length;
  if (!hasTerms && !hasPronouns) return;
  const covered = await coveredKeys(tx, s);
  const rows: (typeof seriesSuggestions.$inferInsert)[] = [];
  const base = { userId: s.userId, seriesId: s.id, chapterId: p.chapter_id };

  if (hasTerms) {
    const found = uniqueByKey(
      (result.new_terms ?? []).flatMap((t) => {
        const a = acceptTerm(t, covered);
        return a ? [a] : [];
      }),
    );
    for (const a of await admit(tx, s.id, "term", found, covered.terms)) {
      rows.push({ ...base, kind: "term", key: a.key, data: a.data });
    }
  }
  if (hasPronouns) {
    const found = uniqueByKey(
      (result.pronoun_pairs ?? []).flatMap((p) => {
        const a = acceptPronoun(p, covered);
        return a ? [a] : [];
      }),
    );
    for (const a of await admit(tx, s.id, "pronoun", found, covered.pronouns)) {
      rows.push({ ...base, kind: "pronoun", key: a.key, data: a.data });
    }
  }
  if (rows.length === 0) return;
  // Sắp theo (kind, key) để hai lần complete cùng series luôn khoá dòng theo cùng thứ tự (tránh deadlock).
  rows.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  await tx
    .insert(seriesSuggestions)
    .values(rows)
    .onConflictDoNothing({
      target: [seriesSuggestions.seriesId, seriesSuggestions.kind, seriesSuggestions.key],
    });
}

export type SuggestionList = {
  terms: {
    id: string;
    source: string;
    target: string;
    kind: LearnedTerm["kind"];
    chapter_number: string | null;
    created_at: Date;
  }[];
  pronouns: {
    id: string;
    speaker: string;
    listener: string;
    address: string;
    chapter_number: string | null;
    created_at: Date;
  }[];
};

/** Gợi ý chưa Bỏ và chưa có trong glossary hiệu lực / pronoun_rules; sắp theo (created_at, id). */
export async function listSuggestions(sdb: Scoped, s: Series): Promise<SuggestionList> {
  const rows = await sdb.select(
    seriesSuggestions,
    and(eq(seriesSuggestions.seriesId, s.id), isNull(seriesSuggestions.dismissedAt)),
  );
  const entries = await sdb.select(glossaryEntries, seriesGlossaryWhere(s));
  const covered = coveredFrom(
    entries.map((e) => e.sourceTerm),
    s,
  );
  const chapterIds = [...new Set(rows.flatMap((r) => (r.chapterId ? [r.chapterId] : [])))];
  const numbers = new Map(
    chapterIds.length
      ? (await sdb.select(chapters, inArray(chapters.id, chapterIds))).map((c) => [c.id, c.number] as const)
      : [],
  );
  const out: SuggestionList = { terms: [], pronouns: [] };
  const sorted = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const r of sorted) {
    const chapter_number = (r.chapterId && numbers.get(r.chapterId)) || null;
    if (r.kind === "term") {
      if (covered.terms.has(r.key)) continue;
      const d = r.data as LearnedTerm;
      out.terms.push({
        id: r.id,
        source: d.source,
        target: d.target,
        kind: d.kind,
        chapter_number,
        created_at: r.createdAt,
      });
    } else {
      if (covered.pronouns.has(r.key)) continue;
      const d = r.data as LearnedPronoun;
      out.pronouns.push({
        id: r.id,
        speaker: d.speaker,
        listener: d.listener,
        address: d.address,
        chapter_number,
        created_at: r.createdAt,
      });
    }
  }
  return out;
}
