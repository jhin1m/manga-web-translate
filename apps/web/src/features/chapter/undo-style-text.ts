/**
 * Thông báo sau hoàn tác áp kiểu: nêu số trang đã khôi phục + trang bị bỏ qua (đã sửa sau đó). Trang đang mở bị bỏ
 * qua thì nói rõ nó giữ nguyên — không thì người dùng thấy canvas không đổi và tưởng nút hỏng.
 */
import { t, tp } from "../../i18n/t.ts";

export const undoStyleText = (
  restored: number,
  skipped: string[],
  list: { id: string; ord: number }[],
  activeId: string | null = null,
  /** Tên lượt đã hoàn tác ("áp kiểu", "thay thế", "áp glossary"). */
  what = t("chapter.undoStyleText.whatStyle"),
) => {
  if (!skipped.length) return tp("chapter.undoStyleText.restored", restored, { what });
  const ordOf = (id: string) => list.find((p) => p.id === id)?.ord;
  const fmt = (ids: string[]) =>
    ids
      .map(ordOf)
      .filter((o): o is number => o !== undefined)
      .sort((a, b) => a - b)
      .map((o) => o + 1)
      .join(", ");
  const openOrd = activeId && skipped.includes(activeId) ? ordOf(activeId) : undefined;
  const others = fmt(skipped.filter((id) => id !== activeId || openOrd === undefined));
  const open = openOrd === undefined ? "" : t("chapter.undoStyleText.openKept", { page: openOrd + 1 });
  if (!restored) {
    const all = fmt(skipped);
    const none = t("chapter.undoStyleText.noneRestored", { pages: all, what });
    return open ? `${none} ${t("chapter.undoStyleText.openKeptShort")}` : none;
  }
  const parts = [others && t("chapter.undoStyleText.skippedPages", { pages: others }), open].filter(Boolean).join(", ");
  return tp("chapter.undoStyleText.partial", restored, { what, parts });
};
