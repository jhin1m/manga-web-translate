/**
 * Chặn chữ tiếng Việt viết thẳng trong mã web và `@mtl/shared`: mọi chữ giao diện phải đi qua `t()` và nằm trong
 * `messages/vi.json`; shared trả mã, web dịch. Quét `*.ts` / `*.tsx` / `*.css` dưới `apps/web/src` và
 * `packages/shared/src` (bỏ `*.test.*`, `__tests__/`, `i18n/messages/`), đã bỏ comment.
 *
 * `ALLOWLIST`: `path` là thư mục / file tính từ `apps/web/src`, hoặc `@mtl/shared/<file>` cho shared. Có `line` = chỉ
 * bỏ qua dòng chứa đoạn đó (chuỗi dữ liệu hợp lệ); không có `line` = bỏ qua cả file — chỉ dành cho file mà toàn bộ là
 * câu tiếng Việt cố ý không qua `t()` (vd câu API trả cho client cũ). Mọi mục phải có `reason`, và mục không còn khớp gì
 * thì test báo để xoá.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type AllowEntry = { path: string; line?: string; reason: string };

const FONT_PREVIEW =
  "Mẫu chữ xem trước vẽ bằng chính font đó để thấy font có đủ glyph tiếng Việt có dấu (dữ liệu, giống nhau ở mọi giao diện)";

const ALLOWLIST: readonly AllowEntry[] = [
  { path: "features/fonts/font-settings.tsx", line: '"Xin chào! Tiếng Việt"', reason: FONT_PREVIEW },
  { path: "features/fonts/local-font-picker.tsx", line: "Xin chào! Tiếng Việt", reason: FONT_PREVIEW },
  {
    path: "features/upload/parse-chapter-filename.ts",
    line: "|chương|chuong|",
    reason: "Tiền tố số chương trong tên file người dùng đặt (dữ liệu nhận dạng, không phải chữ giao diện)",
  },
  {
    path: "features/upload/parse-chapter-filename.ts",
    line: '.replace(/đ/gi, "d")',
    reason: "Bỏ dấu tên file trước khi so khớp series (dữ liệu nhận dạng, không phải chữ giao diện)",
  },
  {
    path: "i18n/locales.ts",
    line: '"Tiếng Việt"',
    reason: "Tên bản địa của ngôn ngữ, hiện nguyên văn ở mọi giao diện để người dùng nhận ra",
  },
  {
    path: "@mtl/shared/series-lang.ts",
    line: ': "Tiếng ',
    reason: "`LANG_NAMES`: tên ngôn ngữ chèn vào câu chỉ dẫn gửi LLM (prompt giữ tiếng Việt); giao diện dịch theo mã",
  },
  {
    path: "@mtl/shared/vietnamese-chars.ts",
    line: '"aăâeêioôơuưy"',
    reason: "Bảng chữ cái tiếng Việt để kiểm font đủ glyph (dữ liệu, khớp worker)",
  },
  {
    path: "@mtl/shared/vietnamese-chars.ts",
    line: "const tones = [",
    reason: "Dấu thanh tiếng Việt để kiểm font đủ glyph (dữ liệu, khớp worker)",
  },
  {
    path: "@mtl/shared/vietnamese-chars.ts",
    line: '["đ", "Đ"]',
    reason: "Chữ đ / Đ để kiểm font đủ glyph (dữ liệu, khớp worker)",
  },
  {
    path: "@mtl/shared/api-errors.ts",
    reason:
      "Câu fallback `message` của hợp đồng API (giữ nội dung cho client cũ); web dịch theo mã `errors.<mã>`, test giữ câu `vi.json` trùng file này",
  },
];

/** Nguyên âm có dấu + đ (cả dạng dựng sẵn lẫn dấu tổ hợp). */
const VIETNAMESE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]|[\u0300\u0301\u0303\u0306\u0309\u031b\u0323]/iu;

/** Gốc quét: nhãn đứng trước đường dẫn tương đối trong `Hit.file` / `AllowEntry.path`. */
const ROOTS: readonly { label: string; dir: string }[] = [
  { label: "", dir: fileURLToPath(new URL("..", import.meta.url)) },
  { label: "@mtl/shared/", dir: fileURLToPath(new URL("../../../../packages/shared/src", import.meta.url)) },
];

/** Ký tự / từ khoá đứng trước `/` mở regex (không phải phép chia). Không có `<` / `>` vì `</div>` và `/>` của JSX. */
const REGEX_PREV = new Set(["", ..."(,=:[!&|?{};+-*%~^"]);
const REGEX_PREV_WORD = /\b(return|typeof|case|do|else|in|of|void|yield|await|delete|new|throw)\s*$/;

/**
 * Thay comment bằng khoảng trắng (giữ xuống dòng để số dòng không đổi). Hiểu chuỗi `'` `"`, template lồng `${}`, regex
 * literal; CSS chỉ có `/* *\/`. Không phải parser đầy đủ: chữ JSX chứa `'` hoặc `//` có thể làm lệch tới hết dòng.
 */
function stripComments(src: string, css = false): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  /** Mỗi tầng `${` đang mở: số `{` lồng bên trong biểu thức. */
  const templates: number[] = [];
  let i = 0;
  let prev = "";
  let code = "";

  const skipString = (quote: string) => {
    i++;
    while (i < src.length && src[i] !== quote && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
    i++;
  };
  /** Đọc phần chữ của template tới backtick đóng (trả false) hoặc `${` (trả true). */
  const skipTemplate = (): boolean => {
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") i += 2;
      else if (c === "`") {
        i++;
        return false;
      } else if (c === "$" && src[i + 1] === "{") {
        i += 2;
        return true;
      } else i++;
    }
    return false;
  };

  while (i < src.length) {
    const c = src[i] ?? "";
    const next = src[i + 1];
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (css) {
      if (c === '"' || c === "'") skipString(c);
      else i++;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && (REGEX_PREV.has(prev) || REGEX_PREV_WORD.test(code))) {
      let inClass = false;
      i++;
      while (i < src.length && src[i] !== "\n") {
        const r = src[i];
        if (r === "\\") i++;
        else if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        i++;
      }
      i++;
      prev = ")";
      code = "";
      continue;
    }
    if (c === '"' || c === "'") {
      skipString(c);
      prev = ")";
      code = "";
      continue;
    }
    if (c === "`") {
      i++;
      if (skipTemplate()) templates.push(0);
      prev = ")";
      code = "";
      continue;
    }
    if (templates.length > 0 && (c === "{" || c === "}")) {
      const depth = templates.length - 1;
      if (c === "{") templates[depth] = (templates[depth] ?? 0) + 1;
      else if (templates[depth] === 0) {
        // `}` đóng `${…}` → quay lại phần chữ của template.
        templates.pop();
        i++;
        if (skipTemplate()) templates.push(0);
        prev = ")";
        code = "";
        continue;
      } else templates[depth] = (templates[depth] ?? 1) - 1;
    }
    // `code`: từ cuối cùng trước vị trí này (vd `return`), qua được khoảng trắng.
    if (/[\w$]/.test(c)) code = code.endsWith(" ") ? c : code + c;
    else if (/\s/.test(c)) code = code && !code.endsWith(" ") ? `${code} ` : code;
    else code = "";
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name);
    if (d.isDirectory()) return d.name === "__tests__" ? [] : sourceFiles(full);
    return /\.(tsx?|css)$/.test(d.name) && !/\.test\.[^.]+$/.test(d.name) ? [full] : [];
  });
}

type Hit = { file: string; line: number; text: string };

function findHits(): Hit[] {
  const hits: Hit[] = [];
  for (const root of ROOTS) {
    for (const full of sourceFiles(root.dir)) {
      const file = root.label + relative(root.dir, full).split(sep).join("/");
      if (file.startsWith("i18n/messages/")) continue;
      const raw = readFileSync(full, "utf8");
      const rawLines = raw.split("\n");
      stripComments(raw, file.endsWith(".css"))
        .split("\n")
        .forEach((text, idx) => {
          if (VIETNAMESE.test(text)) hits.push({ file, line: idx + 1, text: rawLines[idx]?.trim() ?? "" });
        });
    }
  }
  return hits;
}

const inScope = (file: string, path: string) => file === path || file.startsWith(`${path}/`);
const allows = (e: AllowEntry, h: Hit) => inScope(h.file, e.path) && (e.line === undefined || h.text.includes(e.line));

describe("no hard-coded Vietnamese in web and shared source", () => {
  const hits = findHits();

  it("every Vietnamese line outside messages is covered by the allowlist", () => {
    const leaks = hits.filter((h) => !ALLOWLIST.some((e) => allows(e, h))).map((h) => `${h.file}:${h.line}  ${h.text}`);
    expect(leaks, "Move these strings to i18n/messages/vi.json (+ en.json) and use t()").toEqual([]);
  });

  it("every allowlist entry has a reason and still matches something", () => {
    for (const e of ALLOWLIST) expect(e.reason.trim(), e.path).not.toBe("");
    const stale = ALLOWLIST.filter((e) => !hits.some((h) => allows(e, h))).map((e) => e.line ?? e.path);
    expect(stale, "Remove allowlist entries that no longer match").toEqual([]);
  });
});

describe("stripComments", () => {
  it("drops line, block and JSX comments but keeps strings, URLs and line numbers", () => {
    const src = [
      'const a = "http://x"; // bỏ',
      "/* khối",
      "   nhiều dòng */ const b = 'giữ';",
      "<p>{/* chú thích */}chữ</p>",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: mẫu mã nguồn có template lồng, không phải template thật
      "const re = /\\/\\/[\"']/; const c = `t ${x ? `//y` : 'z'} // còn`; // hết",
    ].join("\n");
    const out = stripComments(src).split("\n");
    expect(out).toHaveLength(5);
    expect(out[0]).toContain('"http://x"');
    expect(out[0]).not.toContain("bỏ");
    expect(out[1]?.trim()).toBe("");
    expect(out[2]).toContain("'giữ'");
    expect(out[2]).not.toContain("nhiều");
    expect(out[3]).toContain("chữ");
    expect(out[3]).not.toContain("chú thích");
    expect(out[4]).toContain("// còn`");
    expect(out[4]).not.toContain("hết");
  });

  it("keeps division and CSS strings that look like comments", () => {
    expect(stripComments("const r = a / b / c; // x")).toBe("const r = a / b / c;     ");
    expect(stripComments('a { content: "/* giữ */"; } /* bỏ */', true)).toBe('a { content: "/* giữ */"; }         ');
  });
});
