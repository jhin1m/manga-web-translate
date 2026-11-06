/**
 * Rail công cụ màn chương. Icon công cụ (V/T/B/R) đặt công cụ: Chọn mở/thu panel khối (bấm lại icon đang mở thì thu,
 * công cụ giữ nguyên); Chữ / Tẩy chữ / Quét chữ dùng thanh phụ trên canvas nên không mở panel (panel khối chỉ ở lại
 * khi còn nội dung phải xử lý). Tẩy nét (E) không có icon riêng — nó là chế độ của Tẩy chữ (đổi trong thanh phụ hoặc
 * phím E), nên trên rail đứng chung nút Tẩy chữ. "Bản dịch" / "Tìm" / "Hiệu đính" chỉ mở/thu panel của nó, không đổi công cụ.
 */
import type { Tool } from "../editor/store.ts";

export type PanelId = "tool" | "table" | "find" | "proofread";
export type RailTarget = Tool | "table" | "find" | "proofread";
/** Icon chỉ mở/thu panel của nó (không phải công cụ vẽ). */
const PANEL_ONLY: readonly RailTarget[] = ["table", "find", "proofread"];
export const isPanelOnly = (t: RailTarget): t is "table" | "find" | "proofread" => PANEL_ONLY.includes(t);
export type RailState = { panel: PanelId | null; tool: Tool };

/** Nút rail của một công cụ: Tẩy nét mask dùng chung nút Mask. */
export const railTool = (t: Tool): Tool => (t === "eraser" ? "brush" : t);

/**
 * `keepToolPanel`: panel khối đang có nội dung phải xử lý (AI có bản mới, xung đột khi lưu) — đổi sang công cụ không có
 * panel thì giữ panel mở để không giấu nội dung đó.
 */
export function railClick(cur: RailState, t: RailTarget, keepToolPanel = false): RailState {
  if (isPanelOnly(t)) return { panel: cur.panel === t ? null : t, tool: cur.tool };
  // Bấm nút của công cụ đang dùng (Tẩy chữ khi đang Tẩy nét cũng vậy) → giữ nguyên công cụ.
  const tool = railTool(cur.tool) === t ? cur.tool : t;
  if (t === "select") return { panel: railTool(cur.tool) === t && cur.panel === "tool" ? null : "tool", tool };
  return { panel: cur.panel === "tool" && keepToolPanel ? "tool" : null, tool };
}

/** Tiêu đề panel (cũng là tên truy cập của `<aside>`). */
export const PANEL_TITLE: Record<RailTarget, string> = {
  select: "Chọn & sửa",
  text: "Thêm chữ",
  brush: "Tẩy chữ",
  eraser: "Tẩy chữ",
  ocr: "Quét chữ",
  table: "Bản dịch cả chương",
  find: "Tìm / Thay · Glossary",
  proofread: "AI hiệu đính",
};

/** Panel rộng: bảng nhiều cột (Bản dịch, xem trước Tìm/Thay, bảng Áp glossary). */
export const isWidePanel = (p: PanelId | null) => p === "table" || p === "find" || p === "proofread";
