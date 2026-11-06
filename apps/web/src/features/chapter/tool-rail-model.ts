/**
 * Rail công cụ màn chương (5 nút). Icon công cụ (V/T/B/R) đặt công cụ: Chọn mở/thu panel khối (bấm lại icon đang mở thì
 * thu, công cụ giữ nguyên); Chữ / Tẩy chữ / Quét chữ dùng thanh phụ trên canvas nên không mở panel (panel khối chỉ ở
 * lại khi còn nội dung phải xử lý). Tẩy nét (E) không có icon riêng — nó là chế độ của Tẩy chữ (đổi trong thanh phụ hoặc
 * phím E), nên trên rail đứng chung nút Tẩy chữ. "Văn bản" chỉ mở/thu panel 4 tab (Bản dịch, Tìm / Thay, Glossary,
 * Hiệu đính), không đổi công cụ.
 */
import type { Tool } from "../editor/store.ts";

/** `tool` = panel khối (đè canvas); `doc` = panel Văn bản (chiếm cột, nhiều tab). */
export type PanelId = "tool" | "doc";
export type RailTarget = Tool | "doc";
/** Tab của panel Văn bản. */
export type DocTab = "table" | "find" | "glossary" | "proofread";
export const DOC_TABS: readonly DocTab[] = ["table", "find", "glossary", "proofread"];
/** Icon chỉ mở/thu panel của nó (không phải công cụ vẽ). */
export const isPanelOnly = (t: RailTarget): t is "doc" => t === "doc";
export type RailState = { panel: PanelId | null; tool: Tool };

/** Nút rail của một công cụ: Tẩy nét mask dùng chung nút Mask. */
export const railTool = (t: Tool): Tool => (t === "eraser" ? "brush" : t);

/**
 * `content`: panel khối đang có nội dung phải xử lý (AI có bản mới, xung đột khi lưu) — không được giấu: thu Văn bản
 * thì quay về panel khối, đổi sang công cụ không có panel thì giữ panel khối. `selection`: đang chọn một khối.
 * Bấm Chọn là hành động mở rõ ràng: mở panel khi có khối đang chọn hoặc có nội dung, không có gì thì không mở. Phím V chặt hơn: chỉ mở lại panel vừa thu do đổi công cụ.
 */
export type RailHas = { content: boolean; selection: boolean };

export function railClick(
  cur: RailState,
  t: RailTarget,
  has: RailHas = { content: false, selection: false },
): RailState {
  if (isPanelOnly(t)) return { panel: cur.panel === t ? (has.content ? "tool" : null) : t, tool: cur.tool };
  // Bấm nút của công cụ đang dùng (Tẩy chữ khi đang Tẩy nét cũng vậy) → giữ nguyên công cụ.
  const tool = railTool(cur.tool) === t ? cur.tool : t;
  if (t === "select") {
    if (railTool(cur.tool) === t && cur.panel === "tool") return { panel: null, tool };
    return { panel: has.content || has.selection ? "tool" : cur.panel === "tool" ? null : cur.panel, tool };
  }
  return { panel: cur.panel === "tool" && has.content ? "tool" : null, tool };
}

/** Tên panel (cũng là tên truy cập của `<aside>`). */
export const PANEL_TITLE: Record<PanelId, string> = {
  tool: "Chọn & sửa",
  doc: "Văn bản",
};

/** Panel rộng: bảng nhiều cột (Văn bản: bảng dịch, xem trước Tìm/Thay, bảng Áp glossary). */
export const isWidePanel = (p: PanelId | null) => p === "doc";
