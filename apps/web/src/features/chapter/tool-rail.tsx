/**
 * Rail công cụ trái màn chương (64px): Chọn · Chữ · Mask · Tẩy · OCR · ── · Bản dịch · Tìm. Icon + nhãn 11px; nút đang mở
 * panel của nó có nền nhấn (`aria-pressed`), công cụ đang chọn mà panel thu / đang ở panel khác chỉ chữ màu nhấn.
 * Hành vi bấm: tool-rail-model.ts `railClick`.
 */
import type { ReactNode } from "react";
import type { Tool } from "../editor/store.ts";
import { EraserIcon, FindIcon, MaskIcon, OcrIcon, SelectIcon, TableIcon, TextIcon } from "./tool-icons.tsx";
import type { PanelId, RailTarget } from "./tool-rail-model.ts";

type Item = { id: RailTarget; label: string; title: string; icon: ReactNode };

const TOOLS: Item[] = [
  { id: "select", label: "Chọn", title: "Chọn (V)", icon: <SelectIcon /> },
  { id: "text", label: "Chữ", title: "Chữ (T)", icon: <TextIcon /> },
  { id: "brush", label: "Mask", title: "Mask xoá chữ (B)", icon: <MaskIcon /> },
  { id: "eraser", label: "Tẩy", title: "Tẩy nét mask (E)", icon: <EraserIcon /> },
  { id: "ocr", label: "OCR", title: "OCR vùng (R)", icon: <OcrIcon /> },
];
const PANELS: Item[] = [
  { id: "table", label: "Bản dịch", title: "Bản dịch cả chương", icon: <TableIcon /> },
  { id: "find", label: "Tìm", title: "Tìm / Thay · Glossary (Ctrl+F)", icon: <FindIcon /> },
];

export function ToolRail(props: {
  panel: PanelId | null;
  tool: Tool;
  /** Nút bị tắt → lý do (title). */
  disabled: Partial<Record<RailTarget, string>>;
  onClick(t: RailTarget): void;
}) {
  const { panel, tool } = props;
  const button = (it: Item) => {
    const isTool = it.id !== "table" && it.id !== "find";
    const open = isTool ? panel === "tool" && tool === it.id : panel === it.id;
    const reason = props.disabled[it.id];
    return (
      <button
        key={it.id}
        type="button"
        className="cw-toolbtn"
        aria-label={it.title}
        title={reason ?? it.title}
        aria-pressed={open}
        // Công cụ đang dùng (kể cả khi panel thu / đang ở Bản dịch, Tìm) — trình đọc màn hình biết công cụ nào đang bật.
        aria-current={isTool && tool === it.id ? "true" : undefined}
        data-current={isTool && tool === it.id && !open ? "" : undefined}
        aria-describedby={reason ? `cw-rail-why-${it.id}` : undefined}
        disabled={!!reason}
        onClick={() => props.onClick(it.id)}
      >
        {it.icon}
        <span aria-hidden="true">{it.label}</span>
        {reason && (
          <span id={`cw-rail-why-${it.id}`} className="sr-only">
            {reason}
          </span>
        )}
      </button>
    );
  };
  return (
    <nav className="cw-toolrail" aria-label="Công cụ">
      {TOOLS.map(button)}
      <span className="cw-toolrail-sep" />
      {PANELS.map(button)}
    </nav>
  );
}
