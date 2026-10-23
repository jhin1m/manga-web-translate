/**
 * Panel ngữ cảnh đang mở (hoặc thu) nhớ theo trình duyệt: localStorage `mtl.layout` = `{ panel }`. Khoá cũ của bảng
 * dưới (`bottomOpen`, `bottomH`) bị bỏ qua. Không đọc/ghi được (chế độ riêng tư) → mặc định mở panel công cụ.
 */
import type { PanelId } from "./tool-rail-model.ts";

const LAYOUT_KEY = "mtl.layout";
const PANELS: readonly (PanelId | null)[] = ["tool", "table", "find", "proofread", null];

export function readPanel(): PanelId | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const v = raw ? (JSON.parse(raw) as { panel?: unknown }) : null;
    return v && PANELS.includes(v.panel as PanelId | null) ? (v.panel as PanelId | null) : "tool";
  } catch {
    return "tool";
  }
}

export function writePanel(panel: PanelId | null) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ panel }));
  } catch {
    // Không lưu được → chỉ mất ghi nhớ bố cục.
  }
}
