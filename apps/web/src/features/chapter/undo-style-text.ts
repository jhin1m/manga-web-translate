/**
 * Thông báo sau hoàn tác áp kiểu: nêu số trang đã khôi phục + trang bị bỏ qua (đã sửa sau đó). Trang đang mở bị bỏ
 * qua thì nói rõ nó giữ nguyên — không thì người dùng thấy canvas không đổi và tưởng nút hỏng.
 */
export const undoStyleText = (
  restored: number,
  skipped: string[],
  list: { id: string; ord: number }[],
  activeId: string | null = null,
) => {
  if (!skipped.length) return `Đã hoàn tác áp kiểu trên ${restored} trang.`;
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
  const open = openOrd === undefined ? "" : `trang đang mở (trang ${openOrd + 1}) giữ nguyên`;
  if (!restored) {
    const all = fmt(skipped);
    return `Không hoàn tác được: trang ${all} đã sửa sau khi áp kiểu.${open ? ` Trang đang mở giữ nguyên.` : ""}`;
  }
  const parts = [others && `bỏ qua trang ${others}`, open].filter(Boolean).join(", ");
  return `Đã hoàn tác áp kiểu trên ${restored} trang · ${parts} vì đã sửa sau đó.`;
};
