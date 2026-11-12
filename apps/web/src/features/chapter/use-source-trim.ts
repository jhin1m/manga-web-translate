/**
 * Trạng thái cắt mép của ảnh gốc đang xem (panel Cắt mép + canvas dùng chung): kích thước ảnh thật đo khi ảnh tải xong,
 * bản nháp 2 mép (kéo thanh hoặc gõ số cùng ghi vào đây). Bản nháp gắn với id ảnh nên đổi ảnh không dùng nhầm số cũ,
 * và mất khi hết chế độ cắt. Ghi (`save`) chỉ khi nháp khác số đã lưu; nháp vẫn hiện tới khi ghi xong nên không chớp lại số cũ.
 */
import { useCallback, useEffect, useState } from "react";
import type { SourceItem } from "./source-rail-model.ts";
import { editTrim, savedEdges, type TrimEdges, trimDirty, trimPayload } from "./source-trim-model.ts";

export type NaturalSize = { width: number; height: number };

/** `saving`: đã gửi ghi, vẫn hiện số nháp cho tới khi ghi xong để không chớp lại số cũ giữa lúc chờ. */
type Draft = { id: string; edges: TrimEdges; saving: boolean };

export function useSourceTrim(args: {
  item: SourceItem | undefined;
  /** Đang ở chế độ cắt ảnh `item` (panel mở, còn sửa được, ảnh không bị xoá). */
  active: boolean;
  /** Ghi số px cắt của ảnh (null = bỏ cắt); `height` = chiều cao ảnh thật. Trả true khi ghi xong, false khi lỗi. */
  save(item: SourceItem, trim: TrimEdges | null, height: number): Promise<boolean>;
}) {
  const { item, active } = args;
  const [measured, setMeasured] = useState<(NaturalSize & { url: string }) | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const natural: NaturalSize | null = item && measured?.url === item.url ? measured : null;
  const mine = draft && item && draft.id === item.id ? draft.edges : null;
  const edges = mine ?? savedEdges(item?.trim);
  const dirty = active && natural !== null && !draft?.saving && trimDirty(mine, item?.trim);

  // Hết chế độ cắt (đóng panel, đổi sang công cụ khác, ảnh bị xoá, hết sửa được) → bỏ nháp chưa lưu.
  useEffect(() => {
    if (!active) setDraft((d) => (d?.saving ? d : null));
  }, [active]);

  const measure = useCallback((url: string, size: NaturalSize) => setMeasured({ url, ...size }), []);

  const change = (edge: "top" | "bottom", value: number) => {
    if (!item || !natural) return;
    setDraft({ id: item.id, edges: editTrim(edges, edge, value, natural.height), saving: false });
  };

  /** Ghi bản nháp nếu khác số đã lưu; nháp được giữ hiện tới khi ghi xong (thành công hay lỗi). Trả true nếu có ghi. */
  const commit = () => {
    if (!item || !natural || !dirty || !mine || !draft) return false;
    const sent: Draft = { ...draft, saving: true };
    setDraft(sent);
    void args.save(item, trimPayload(mine), natural.height).then(() => setDraft((d) => (d === sent ? null : d)));
    return true;
  };
  const discard = () => setDraft(null);

  return { natural, edges, dirty, measure, change, commit, discard };
}
