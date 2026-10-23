/**
 * Rail công cụ màn chương: mỗi icon mở đúng 1 panel ngữ cảnh. Icon công cụ (V/T/B/E/R) đặt công cụ + mở panel công cụ;
 * bấm lại icon đang mở thì thu panel (công cụ giữ nguyên). "Bản dịch" / "Tìm" chỉ mở/thu panel của nó, không đổi công cụ.
 */
import type { Tool } from "../editor/store.ts";

export type PanelId = "tool" | "table" | "find" | "proofread";
export type RailTarget = Tool | "table" | "find" | "proofread";
/** Icon chỉ mở/thu panel của nó (không phải công cụ vẽ). */
const PANEL_ONLY: readonly RailTarget[] = ["table", "find", "proofread"];
export const isPanelOnly = (t: RailTarget): t is "table" | "find" | "proofread" => PANEL_ONLY.includes(t);
export type RailState = { panel: PanelId | null; tool: Tool };

export function railClick(cur: RailState, t: RailTarget): RailState {
  if (isPanelOnly(t)) return { panel: cur.panel === t ? null : t, tool: cur.tool };
  if (cur.panel === "tool" && cur.tool === t) return { panel: null, tool: t };
  return { panel: "tool", tool: t };
}

/** Tiêu đề panel (cũng là tên truy cập của `<aside>`). */
export const PANEL_TITLE: Record<RailTarget, string> = {
  select: "Chọn & sửa",
  text: "Thêm chữ",
  brush: "Mask xoá chữ",
  eraser: "Tẩy nét mask",
  ocr: "OCR vùng",
  table: "Bản dịch cả chương",
  find: "Tìm / Thay · Glossary",
  proofread: "AI hiệu đính",
};

/** Panel rộng: bảng nhiều cột (Bản dịch, xem trước Tìm/Thay, bảng Áp glossary). */
export const isWidePanel = (p: PanelId | null) => p === "table" || p === "find" || p === "proofread";
