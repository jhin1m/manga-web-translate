import { IGNORE_TEXT_ITEMS, type IgnoreIssue, type IgnoreIssueCode, ignoreEntryIssue } from "@mtl/shared";
import { type MessageKey, t, tp } from "../../i18n/t.ts";

/** Mã lý do cũng là mã lỗi API → dùng chung câu `errors.<mã>`. */
const ISSUE_KEY: Readonly<Record<IgnoreIssueCode, MessageKey>> = {
  text_length: "errors.text_length",
  regex_too_long: "errors.regex_too_long",
  regex_too_short: "errors.regex_too_short",
  regex_nested_quantifier: "errors.regex_nested_quantifier",
  regex_unsupported_syntax: "errors.regex_unsupported_syntax",
  regex_too_many_quantifiers: "errors.regex_too_many_quantifiers",
  regex_invalid: "errors.regex_invalid",
  regex_matches_empty: "errors.regex_matches_empty",
};

/** Lý do mục không hợp lệ theo ngôn ngữ giao diện. */
const issueText = (issue: IgnoreIssue) => t(ISSUE_KEY[issue.code], issue.params);

/** Ô "Chữ bỏ qua": mỗi dòng 1 mục (dòng trống bỏ qua); lỗi đầu tiên theo số dòng (mục thường hoặc regex `/mẫu/`), null = hợp lệ. */
export function parseIgnoreText(raw: string): { list: string[]; error: string | null } {
  const lines = raw.split("\n").map((l) => l.trim());
  const list = lines.filter(Boolean);
  for (const [i, l] of lines.entries()) {
    const issue = l ? ignoreEntryIssue(l) : null;
    if (issue) return { list, error: t("series.ignoreTextInput.lineError", { line: i + 1, reason: issueText(issue) }) };
  }
  if (list.length > IGNORE_TEXT_ITEMS) return { list, error: tp("series.ignoreTextInput.maxItems", IGNORE_TEXT_ITEMS) };
  return { list, error: null };
}
