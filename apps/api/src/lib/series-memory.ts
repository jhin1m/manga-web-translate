/**
 * Trí nhớ series: (1) carry cuối lượt dịch cả chương lưu ở `chapters.translate_memory` để lô đầu của chương khác
 * trong series mở đầu bằng nó; (2) thuật ngữ / cặp xưng hô / Giọng văn AI học được ghi thẳng vào series (nhãn AI),
 * với sổ khoá đã gặp (`series_suggestions`) để mục AI người dùng đã xoá không quay lại. Không import `jobs/*`
 * (jobs/* import file này).
 */
import { chapters, type DbLike, glossaryEntries, type jobs, pages, series, seriesSuggestions } from "@mtl/db";
import {
  type JobResult,
  type LearnedPronoun,
  type LearnedTerm,
  ledgerKey,
  MAX_STYLE_NOTE,
  normKey,
  pronounKey,
  type SuggestionKind,
  type TranslateCarry,
  TranslateMemory,
  termKey,
} from "@mtl/shared";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { seriesGlossaryWhere } from "./glossary-scope.ts";
import { MAX_PRONOUN_RULES, type StoredPronounRule } from "./pronoun-rules.ts";

type Series = typeof series.$inferSelect;
type Chapter = typeof chapters.$inferSelect;
type Job = typeof jobs.$inferSelect;
type TranslateResult = Extract<JobResult, { type: "chapter.translate" }>;

/** Trần entry glossary `origin='ai'` còn sống trong một series (xoá bớt thì AI học tiếp được). */
export const MAX_AI_TERMS = 200;
/** Trần mục AI ghi mỗi lô dịch (khớp số prompt worker xin). */
export const MAX_AI_TERMS_PER_BATCH = 5;
export const MAX_AI_PRONOUNS_PER_BATCH = 3;
/** Nguồn, bản dịch thuật ngữ, người nói, người nghe dài hơn thế này thì không phải tên riêng — không ghi. */
const MAX_AI_NAME = 80;
const short = (...vs: string[]) => vs.every((v) => v.length <= MAX_AI_NAME);

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
async function coveredKeys(tx: DbLike, s: Series): Promise<Covered> {
  const rows = await tx
    .select({ sourceTerm: glossaryEntries.sourceTerm })
    .from(glossaryEntries)
    .where(seriesGlossaryWhere(s));
  const pronouns = new Set<string>();
  for (const r of s.pronounRules) {
    if (typeof r.speaker === "string" && typeof r.listener === "string") {
      pronouns.add(pronounKey(r.speaker, r.listener));
    }
  }
  return { terms: new Set(rows.map((r) => termKey(r.sourceTerm))), pronouns };
}

/** Dấu hỏi (ASCII và full-width) = chưa rõ người nói. */
const UNKNOWN = /[?？]/;
/**
 * Ký tự điều khiển (gồm xuống dòng, tab), ngắt dòng/đoạn Unicode và ký tự đảo chiều bidi: chuỗi AI viết vào chỗ
 * prompt ưu tiên phải nằm trên một dòng, không chèn được chỉ thị nhiều dòng.
 */
const CONTROL = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;
const CONTROL_ALL = new RegExp(CONTROL.source, "gu");
const clean = (v: string) => v.normalize("NFC").trim();
const oneLine = (...vs: string[]) => vs.every((v) => !CONTROL.test(v));

type Accepted<T> = { key: string; data: T };

/** Thuật ngữ hợp lệ để ghi (đã chuẩn hoá) hoặc null. Khoá = termKey (chưa có cặp ngôn ngữ). */
function acceptTerm(t: LearnedTerm): Accepted<LearnedTerm> | null {
  const data = { source: clean(t.source), target: clean(t.target), kind: t.kind };
  if (!data.source || !data.target || !oneLine(data.source, data.target)) return null;
  if (!short(data.source, data.target)) return null;
  if (normKey(data.source) === normKey(data.target)) return null;
  return { key: termKey(data.source), data };
}

function acceptPronoun(p: LearnedPronoun): Accepted<LearnedPronoun> | null {
  const data = { speaker: clean(p.speaker), listener: clean(p.listener), address: clean(p.address) };
  if (!data.speaker || !data.listener || !data.address) return null;
  if (!oneLine(data.speaker, data.listener, data.address) || !short(data.speaker, data.listener)) return null;
  if (UNKNOWN.test(data.speaker) || UNKNOWN.test(data.listener) || data.address === "?" || data.address === "？") {
    return null;
  }
  if (normKey(data.speaker) === normKey(data.listener)) return null;
  return { key: pronounKey(data.speaker, data.listener), data };
}

/** Giữ mục đầu tiên của mỗi khoá. */
function uniqueByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => !seen.has(i.key) && !!seen.add(i.key));
}

/**
 * Giọng văn AI → một dòng, bỏ ký tự điều khiển, gộp khoảng trắng, cắt theo đơn vị UTF-16 về ≤ MAX_STYLE_NOTE (không
 * cắt đôi cặp surrogate). Rỗng = không ghi.
 */
export function cleanStyleNote(v: string): string {
  let s = v.normalize("NFC").replace(CONTROL_ALL, " ").replace(/\s+/g, " ").trim();
  if (s.length > MAX_STYLE_NOTE) {
    s = s.slice(0, MAX_STYLE_NOTE);
    if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s;
}

/**
 * Chia mục hợp lệ của một loại: khoá đã có trong sổ → bỏ hẳn; đã phủ (glossary / pronoun_rules) → chỉ vào sổ;
 * còn lại là ứng viên ghi.
 */
function triage<T>(
  found: Accepted<T>[],
  known: Set<string>,
  covered: Set<string>,
  ledger: (key: string) => string,
): { covered: Accepted<T>[]; fresh: Accepted<T>[] } {
  const out = { covered: [] as Accepted<T>[], fresh: [] as Accepted<T>[] };
  for (const a of found) {
    if (known.has(ledger(a.key))) continue;
    (covered.has(a.key) ? out.covered : out.fresh).push(a);
  }
  return out;
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
 * Sau khi lưu trang của một lô dịch: ghi thuật ngữ (entry glossary series, `origin='ai'`), cặp xưng hô mới
 * (`origin='ai'`) và Giọng văn (khi còn trống và người dùng chưa tự đặt) vào series; ghi gì thì `glossary_rev + 1`
 * (không đụng `settings_rev`: đổi nó buộc chạy lại Bước 1). Lô kế enqueue cùng transaction đọc lại series nên có ngay
 * các mục này.
 *
 * Thứ tự khoá: chương (caller đã khoá) → dòng series. Chỉ gọi ở nhánh complete `chapter.translate` (một chương mỗi
 * transaction); không gọi từ `terminal` / chuỗi dịch, vì reaper và claim đóng nhiều chương trong một transaction.
 *
 * Sổ khoá (`series_suggestions`, khoá = ledgerKey(cặp ngôn ngữ, termKey/pronounKey)): khoá đã có thì không ghi lại;
 * thêm vào sổ mọi khoá vừa ghi và khoá đã phủ sẵn. Khoá bị bỏ vì trần không vào sổ, để lần sau còn học được.
 */
export async function applyLearned(
  tx: DbLike,
  args: { job: Job; chapter: Chapter; result: TranslateResult },
): Promise<void> {
  const { job, chapter, result } = args;
  const p = job.payload;
  if (p.type !== "chapter.translate") throw new Error("payload mismatch");
  const styleNote = cleanStyleNote(result.style_note ?? "");
  if (!result.new_terms?.length && !result.pronoun_pairs?.length && !styleNote) return;

  const [s] = await tx
    .select()
    .from(series)
    .where(and(eq(series.userId, job.userId), eq(series.id, chapter.seriesId)))
    .for("update");
  if (!s) return;

  const terms = uniqueByKey((result.new_terms ?? []).flatMap((t) => acceptTerm(t) ?? []));
  const pairs = uniqueByKey((result.pronoun_pairs ?? []).flatMap((x) => acceptPronoun(x) ?? []));
  const ledger = (key: string) => ledgerKey(s.sourceLang, s.targetLang, key);
  const keys = [...terms, ...pairs].map((a) => ledger(a.key));
  const known = new Map<SuggestionKind, Set<string>>([
    ["term", new Set()],
    ["pronoun", new Set()],
  ]);
  if (keys.length) {
    const rows = await tx
      .select({ kind: seriesSuggestions.kind, key: seriesSuggestions.key })
      .from(seriesSuggestions)
      .where(and(eq(seriesSuggestions.seriesId, s.id), inArray(seriesSuggestions.key, keys)));
    for (const r of rows) known.get(r.kind)?.add(r.key);
  }
  const covered = await coveredKeys(tx, s);
  const t = triage(terms, known.get("term") ?? new Set(), covered.terms, ledger);
  const pr = triage(pairs, known.get("pronoun") ?? new Set(), covered.pronouns, ledger);

  // Thuật ngữ: trần trên entry AI còn sống của series.
  let writtenTerms: Accepted<LearnedTerm>[] = [];
  if (t.fresh.length) {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(glossaryEntries)
      .where(and(eq(glossaryEntries.seriesId, s.id), eq(glossaryEntries.origin, "ai")));
    const room = Math.min(MAX_AI_TERMS_PER_BATCH, Math.max(0, MAX_AI_TERMS - (row?.n ?? 0)));
    writtenTerms = t.fresh.slice(0, room);
    if (writtenTerms.length) {
      await tx
        .insert(glossaryEntries)
        .values(
          writtenTerms.map((a) => ({
            userId: s.userId,
            seriesId: s.id,
            sourceLang: null,
            targetLang: null,
            sourceTerm: a.data.source,
            targetTerm: a.data.target,
            note: "",
            origin: "ai" as const,
          })),
        )
        .onConflictDoNothing();
    }
  }

  // Xưng hô: trần trên tổng số cặp của series.
  const room = Math.min(MAX_AI_PRONOUNS_PER_BATCH, Math.max(0, MAX_PRONOUN_RULES - s.pronounRules.length));
  const writtenPairs = pr.fresh.slice(0, room);
  const newRules: StoredPronounRule[] = writtenPairs.map((a) => ({ ...a.data, note: "", origin: "ai" }));

  // Chỉ có khoảng trắng = trống, khớp worker (vẫn xin `style_note` khi Giọng văn chỉ có khoảng trắng).
  const writeStyle = !!styleNote && s.stylePrompt.trim() === "" && s.styleOrigin !== "user";

  const ledgerRows: (typeof seriesSuggestions.$inferInsert)[] = [
    ...[...writtenTerms, ...t.covered].map((a) => ({ kind: "term" as const, key: ledger(a.key), data: a.data })),
    ...[...writtenPairs, ...pr.covered].map((a) => ({ kind: "pronoun" as const, key: ledger(a.key), data: a.data })),
  ].map((r) => ({ ...r, userId: s.userId, seriesId: s.id, chapterId: p.chapter_id }));
  if (ledgerRows.length) {
    ledgerRows.sort((a, b) =>
      a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    await tx
      .insert(seriesSuggestions)
      .values(ledgerRows)
      .onConflictDoNothing({
        target: [seriesSuggestions.seriesId, seriesSuggestions.kind, seriesSuggestions.key],
      });
  }

  if (!writtenTerms.length && !newRules.length && !writeStyle) return;
  await tx
    .update(series)
    .set({
      ...(newRules.length ? { pronounRules: [...s.pronounRules, ...newRules] } : {}),
      ...(writeStyle ? { stylePrompt: styleNote, styleOrigin: "ai" as const } : {}),
      glossaryRev: sql`${series.glossaryRev} + 1`,
    })
    .where(eq(series.id, s.id));
}
