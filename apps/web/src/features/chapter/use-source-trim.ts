/**
 * Trạng thái cắt mép của ảnh gốc đang xem (panel Cắt mép + canvas dùng chung): kích thước ảnh thật đo khi ảnh tải xong,
 * bản nháp 2 mép (kéo thanh hoặc gõ số cùng ghi vào đây). Bản nháp gắn với id ảnh nên đổi ảnh không dùng nhầm số cũ,
 * và mất khi hết chế độ cắt. Ghi (`save`) chỉ khi nháp khác số đã lưu; lưu lạc quan nên số mới hiện ngay.
 */
import { useCallback, useEffect, useState } from "react";
import type { SourceItem } from "./source-rail-model.ts";
import { editTrim, savedEdges, type TrimEdges, trimDirty, trimPayload } from "./source-trim-model.ts";

export type NaturalSize = { width: number; height: number };

export function useSourceTrim(args: {
  item: SourceItem | undefined;
  /** Đang ở chế độ cắt ảnh `item` (panel mở, còn sửa được, ảnh không bị xoá). */
  active: boolean;
  /** Ghi số px cắt của ảnh (null = bỏ cắt); `height` = chiều cao ảnh thật. */
  save(item: SourceItem, trim: TrimEdges | null, height: number): void;
}) {
  const { item, active } = args;
  const [measured, setMeasured] = useState<(NaturalSize & { url: string }) | null>(null);
  const [draft, setDraft] = useState<{ id: string; edges: TrimEdges } | null>(null);
  const natural: NaturalSize | null = item && measured?.url === item.url ? measured : null;
  const mine = draft && item && draft.id === item.id ? draft.edges : null;
  const edges = mine ?? savedEdges(item?.trim);
  const dirty = active && natural !== null && trimDirty(mine, item?.trim);

  // Hết chế độ cắt (đóng panel, đổi sang công cụ khác, ảnh bị xoá, hết sửa được) → bỏ nháp chưa lưu.
  useEffect(() => {
    if (!active) setDraft(null);
  }, [active]);

  const measure = useCallback((url: string, size: NaturalSize) => setMeasured({ url, ...size }), []);

  const change = (edge: "top" | "bottom", value: number) => {
    if (!item || !natural) return;
    setDraft({ id: item.id, edges: editTrim(edges, edge, value, natural.height) });
  };

  /** Ghi bản nháp nếu khác số đã lưu rồi bỏ nháp; trả true nếu có ghi. */
  const commit = () => {
    if (!item || !natural || !dirty || !mine) return false;
    args.save(item, trimPayload(mine), natural.height);
    setDraft(null);
    return true;
  };
  const discard = () => setDraft(null);

  return { natural, edges, dirty, measure, change, commit, discard };
}
