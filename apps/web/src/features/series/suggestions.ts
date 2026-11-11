/** Thuần: lọc gợi ý xưng hô theo bảng quy tắc đang sửa, và nhãn loại thuật ngữ. */
import { pronounKey, type TermKind } from "@mtl/shared";
import type { PronounRule, PronounSuggestion } from "./api.ts";

export const TERM_KIND_LABEL: Record<TermKind, string> = {
  person: "Tên người",
  place: "Địa danh",
  term: "Thuật ngữ",
};

/** Bỏ gợi ý có cặp (người nói → người nghe) đã nằm trong bảng của form, kể cả hàng chưa Lưu. */
export function pendingPronouns(
  list: readonly PronounSuggestion[],
  rules: readonly PronounRule[],
): PronounSuggestion[] {
  const have = new Set(rules.map((r) => pronounKey(r.speaker, r.listener)));
  return list.filter((s) => !have.has(pronounKey(s.speaker, s.listener)));
}

/** Gợi ý → hàng quy tắc mới (ghi chú để trống). */
export const ruleFromSuggestion = (s: Pick<PronounSuggestion, "speaker" | "listener" | "address">): PronounRule => ({
  speaker: s.speaker,
  listener: s.listener,
  address: s.address,
  note: "",
});

/** Có hàng nào trong bảng quy tắc đang sửa là hàng vừa Nhận từ gợi ý (theo cặp người nói → người nghe) không. */
export function hasAcceptedRule(accepted: ReadonlySet<string>, rules: readonly PronounRule[]): boolean {
  return rules.some((r) => accepted.has(pronounKey(r.speaker, r.listener)));
}

/**
 * Sau khi gỡ một hàng gợi ý: tìm hàng kế (hoặc hàng trước) còn lại để đặt focus vào cùng loại nút. `null` = hết hàng.
 */
export function neighborId(ids: readonly string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

/**
 * Trả focus sau khi một hàng gợi ý biến mất: nút `act` của hàng kế (`nextId`), hết hàng thì `fallback` (phần tử còn lại
 * trên trang). Chờ khung hình sau để danh sách đã vẽ lại; chỉ chuyển focus nếu nó đang bị mất (về body) hoặc còn trong
 * mục gợi ý.
 */
export function focusAfterRemoval(
  section: HTMLElement | null,
  nextId: string | null,
  act: "accept" | "dismiss",
  fallback: HTMLElement | null,
) {
  requestAnimationFrame(() => {
    // Người dùng đã chuyển sang chỗ khác (focus không còn ở body / trong mục gợi ý) thì không giành focus.
    const active = document.activeElement;
    if (active && active !== document.body && !section?.contains(active)) return;
    const row = nextId
      ? section?.querySelector<HTMLElement>(`[data-suggestion="${CSS.escape(nextId)}"] [data-act="${act}"]`)
      : null;
    (row ?? fallback)?.focus();
  });
}
