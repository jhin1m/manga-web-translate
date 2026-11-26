/**
 * Chữ bỏ qua của series (watermark, URL nhóm dịch): vùng OCR có chữ chứa một mục trong danh sách → không dịch, không
 * box, không hiện ở bảng văn bản. Thuần, dùng chung api (lọc lúc claim, áp ngược) + web (bảng văn bản).
 */

import { apiErrorMessageVi } from "./api-errors.ts";

export const IGNORE_TEXT_MIN = 3;
export const IGNORE_TEXT_MAX = 100;
export const IGNORE_TEXT_ITEMS = 50;

/** NFC + chữ thường + bỏ `http(s)://` + gộp khoảng trắng — OCR hay mất scheme, đổi hoa/thường, thừa dấu cách. */
export const normalizeIgnoreText = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Dạng so khớp mục thường: đã chuẩn hoá và bỏ hết khoảng trắng — OCR hay tách/dính chữ ("discord . gg"). */
const stripSpaces = (s: string) => s.replace(/\s+/g, "");

/** Mục dạng `/mẫu/` là regex (cờ cố định `iu`, chạy trên chữ đã chuẩn hoá). */
const REGEX_ENTRY = /^\/(.+)\/$/s;

/** Lượng từ không giới hạn (`*`, `+`, `{n,}`) hay lượng từ bất kỳ (kể cả `?`, `{n,m}`) ngay sau nhóm. */
const OPEN_QUANTIFIER = /^(?:[*+]|\{\d+,\})/;
const ANY_QUANTIFIER = /^(?:[*+]|\{\d+(?:,\d*)?\})/;

/**
 * Lượng từ lồng kiểu `(a+)+`, `(.*)*`, `((a+))*`: nhóm chứa lượng từ không giới hạn mà chính nhóm lại bị lặp →
 * backtracking luỹ thừa. Quét nhanh, bỏ qua ký tự thoát và lớp `[...]`; không chặn hết mọi mẫu xấu (vd `(a|a)+`),
 * chỉ loại các dạng phổ biến — đầu vào đến từ chính người dùng, độ dài đã bị giới hạn.
 */
function hasNestedQuantifier(src: string): boolean {
  const open: boolean[] = []; // mỗi nhóm đang mở: bên trong có lượng từ không giới hạn?
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (c === "\\") i++;
    else if (c === "[") {
      for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
    } else if (c === "(") open.push(false);
    else if (c === ")") {
      const inner = open.pop() ?? false;
      const rest = src.slice(i + 1);
      if (inner && ANY_QUANTIFIER.test(rest)) return true;
      if (inner && open.length) open[open.length - 1] = true;
      if (OPEN_QUANTIFIER.test(rest) && open.length) open[open.length - 1] = true;
    } else if (open.length && OPEN_QUANTIFIER.test(src.slice(i))) open[open.length - 1] = true;
  }
  return false;
}

/**
 * Cú pháp ngoài tập con RE2 (backreference `\1`..`\9`, `\k<tên>`, lookahead/lookbehind). API khớp bằng RE2 nên không
 * chạy được; web dùng RegExp gốc chỉ để hiển thị — chặn ở đây để hai bên cùng hiểu một mẫu là hợp lệ hay không.
 * Quét bỏ qua ký tự thoát `\\` và lớp `[...]`.
 */
const UNSUPPORTED_ESCAPE = /^\\(?:[1-9]|k<)/;
const LOOKAROUND = /^\(\?<?[=!]/;

function hasUnsupportedSyntax(src: string): boolean {
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (c === "\\") {
      if (UNSUPPORTED_ESCAPE.test(src.slice(i, i + 3))) return true;
      i++;
    } else if (c === "[") {
      for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
    } else if (c === "(" && LOOKAROUND.test(src.slice(i, i + 4))) return true;
  }
  return false;
}

/**
 * Số lượng từ không giới hạn (`*`, `+`, `{n,}`) tối đa mỗi mẫu. RE2 (API) chạy tuyến tính nên không cần cho an toàn
 * phía server; giới hạn để trình duyệt (RegExp gốc: form nhập + bảng văn bản) không treo vì `\w*\w*\w*…!` trên chữ OCR
 * — bậc đa thức bị chặn ở 5. Áp cho mọi bên để web và API cùng coi một mục là hợp lệ hay không.
 */
const MAX_OPEN_QUANTIFIERS = 5;

function countOpenQuantifiers(src: string): number {
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (c === "\\") i++;
    else if (c === "[") {
      for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
    } else if (OPEN_QUANTIFIER.test(src.slice(i))) n++;
  }
  return n;
}

/**
 * Mã lý do một mục chữ bỏ qua không hợp lệ — cũng là mã lỗi API (`api-errors.ts`): web dịch theo mã, API ghép câu
 * tiếng Việt (`ignoreEntryError`).
 */
export const IGNORE_ISSUE_CODES = [
  "text_length",
  "regex_too_long",
  "regex_too_short",
  "regex_nested_quantifier",
  "regex_unsupported_syntax",
  "regex_too_many_quantifiers",
  "regex_invalid",
  "regex_matches_empty",
] as const;
export type IgnoreIssueCode = (typeof IGNORE_ISSUE_CODES)[number];
/** Lý do kèm tham số số cho câu hiển thị (`min` / `max`); mã không cần tham số có `params` rỗng. */
export type IgnoreIssue = { code: IgnoreIssueCode; params: Readonly<Record<string, number>> };

const issue = (code: IgnoreIssueCode, params: Readonly<Record<string, number>> = {}): IgnoreIssue => ({ code, params });

/** Bộ lọc đã biên dịch từ danh sách chữ bỏ qua. */
export type IgnoreMatcher = (text: string) => boolean;

/** Thứ tối thiểu cần ở một regex đã biên dịch (RegExp gốc hay RE2 đều thoả). */
export type IgnoreRegex = { test(text: string): boolean };
/** Tạo regex từ mẫu + cờ; ném lỗi nếu mẫu không hợp lệ. Web dùng `RegExp`, API truyền bản RE2 (khớp tuyến tính). */
export type MakeIgnoreRegex = (pattern: string, flags: string) => IgnoreRegex;
export type IgnoreOptions = { makeRegex?: MakeIgnoreRegex };

const nativeRegex: MakeIgnoreRegex = (pattern, flags) => new RegExp(pattern, flags);

export type IgnoreEntry =
  | { kind: "text"; key: string }
  | { kind: "regex"; re: IgnoreRegex }
  | { kind: "invalid"; issue: IgnoreIssue };

/** Phân loại + biên dịch 1 mục: `/mẫu/` → regex (cờ `iu`), còn lại → chuỗi thường đã bỏ khoảng trắng. */
export function parseIgnoreEntry(raw: string, { makeRegex }: IgnoreOptions = {}): IgnoreEntry {
  const entry = raw.trim();
  const m = REGEX_ENTRY.exec(entry);
  if (!m) {
    const key = [...stripSpaces(normalizeIgnoreText(entry))];
    return key.length >= IGNORE_TEXT_MIN && key.length <= IGNORE_TEXT_MAX
      ? { kind: "text", key: key.join("") }
      : { kind: "invalid", issue: issue("text_length", { min: IGNORE_TEXT_MIN, max: IGNORE_TEXT_MAX }) };
  }
  const pattern = m[1] as string;
  if ([...entry].length > IGNORE_TEXT_MAX) {
    return { kind: "invalid", issue: issue("regex_too_long", { max: IGNORE_TEXT_MAX }) };
  }
  if ([...pattern].length < IGNORE_TEXT_MIN) {
    return { kind: "invalid", issue: issue("regex_too_short", { min: IGNORE_TEXT_MIN }) };
  }
  if (hasNestedQuantifier(pattern)) {
    return { kind: "invalid", issue: issue("regex_nested_quantifier") };
  }
  if (hasUnsupportedSyntax(pattern)) {
    return { kind: "invalid", issue: issue("regex_unsupported_syntax") };
  }
  if (countOpenQuantifiers(pattern) > MAX_OPEN_QUANTIFIERS) {
    return { kind: "invalid", issue: issue("regex_too_many_quantifiers", { max: MAX_OPEN_QUANTIFIERS }) };
  }
  let re: IgnoreRegex;
  try {
    re = (makeRegex ?? nativeRegex)(pattern.normalize("NFC"), "iu");
  } catch {
    return { kind: "invalid", issue: issue("regex_invalid") };
  }
  if (re.test("")) return { kind: "invalid", issue: issue("regex_matches_empty") };
  return { kind: "regex", re };
}

/** Lý do mục không hợp lệ (mã + tham số, web dịch theo mã), null = hợp lệ. */
export function ignoreEntryIssue(entry: string, opts?: IgnoreOptions): IgnoreIssue | null {
  const e = parseIgnoreEntry(entry, opts);
  return e.kind === "invalid" ? e.issue : null;
}

/** Lý do mục không hợp lệ bằng câu tiếng Việt (lời nhắn `issues` của API), null = hợp lệ. */
export function ignoreEntryError(entry: string, opts?: IgnoreOptions): string | null {
  const e = ignoreEntryIssue(entry, opts);
  return e && apiErrorMessageVi(e.code, e.params);
}

export const isValidIgnoreEntry = (entry: string, opts?: IgnoreOptions): boolean =>
  ignoreEntryIssue(entry, opts) === null;

/**
 * Biên dịch danh sách 1 lần → bộ lọc `(chữ) => có bị bỏ qua không`. Mục thường khớp khi chữ (chuẩn hoá, bỏ khoảng
 * trắng) chứa mục; mục regex chạy trên chữ chuẩn hoá (còn khoảng trắng đơn). Mục không hợp lệ bị bỏ qua. API truyền
 * `makeRegex` RE2 để mẫu do người dùng nhập không thể làm treo tiến trình.
 */
export function compileIgnoreList(list: readonly string[], opts?: IgnoreOptions): IgnoreMatcher {
  const entries = list.map((e) => parseIgnoreEntry(e, opts));
  const keys = entries.flatMap((e) => (e.kind === "text" ? [e.key] : []));
  const regexes = entries.flatMap((e) => (e.kind === "regex" ? [e.re] : []));
  if (!keys.length && !regexes.length) return () => false;
  return (text) => {
    const t = normalizeIgnoreText(text);
    const stripped = stripSpaces(t);
    return keys.some((k) => stripped.includes(k)) || regexes.some((re) => re.test(t));
  };
}

/** Chữ khớp khi (đã chuẩn hoá) chứa một mục. Dùng `compileIgnoreList` khi lọc nhiều chữ với cùng danh sách. */
export const isIgnoredText = (text: string, list: readonly string[]): boolean => compileIgnoreList(list)(text);

/** Trim + bỏ mục trùng (không phân biệt hoa/thường và dấu cách, giữ mục đầu). */
export function cleanIgnoreList(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    const k = stripSpaces(normalizeIgnoreText(v));
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
