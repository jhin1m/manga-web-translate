/**
 * Rail công cụ trái màn chương (48px, chỉ icon): Chọn · Chữ · Tẩy chữ · Quét chữ · (Cắt mép, chỉ khi chương chưa có page) · ── · Văn bản. Tên + phím nằm ở
 * tooltip (rê chuột hoặc focus bằng phím) và `aria-label`. Nút đang mở panel của nó (Chọn: panel khối; Văn bản) hoặc
 * công cụ có thanh phụ đang dùng (Chữ, Tẩy chữ, Quét chữ) có nền nhấn (`aria-pressed`); Chọn đang chọn mà panel thu /
 * đang ở panel khác chỉ có icon màu nhấn (`aria-current`).
 * Hành vi bấm: tool-rail-model.ts `railClick`.
 */
import type { ReactNode } from "react";
import type { Tool } from "../editor/store.ts";
import { MaskIcon, OcrIcon, ScissorsIcon, SelectIcon, TableIcon, TextIcon } from "./tool-icons.tsx";
import { isPanelOnly, type PanelId, type RailTarget, railTool } from "./tool-rail-model.ts";

type Item = { id: RailTarget; name: string; key?: string; icon: ReactNode };

const TOOLS: Item[] = [
  { id: "select", name: "Chọn", key: "V", icon: <SelectIcon /> },
  { id: "text", name: "Chữ", key: "T", icon: <TextIcon /> },
  { id: "brush", name: "Tẩy chữ", key: "B", icon: <MaskIcon /> },
  { id: "ocr", name: "Quét chữ", key: "R", icon: <OcrIcon /> },
];
/** Chỉ ở chương chưa có page (nháp): cắt mép ảnh gốc, không có phím tắt. */
const TRIM: Item = { id: "trim", name: "Cắt mép", icon: <ScissorsIcon /> };
const PANELS: Item[] = [{ id: "doc", name: "Văn bản", key: "Ctrl+F tìm", icon: <TableIcon /> }];

/** Tên truy cập của nút: "Chọn (V)". */
export const railLabel = (it: Pick<Item, "name" | "key">) => (it.key ? `${it.name} (${it.key})` : it.name);

export function ToolRail(props: {
  panel: PanelId | null;
  tool: Tool;
  /** Nút bị tắt → lý do (tooltip + mô tả truy cập). */
  disabled: Partial<Record<RailTarget, string>>;
  /** Hiện nút Cắt mép (chương chưa có page); bị tắt thì có lý do ở `disabled.trim`. */
  showTrim?: boolean;
  onClick(t: RailTarget): void;
}) {
  const { panel } = props;
  const tool = railTool(props.tool);
  const button = (it: Item) => {
    const isTool = !isPanelOnly(it.id);
    // Công cụ có thanh phụ trên canvas (Chữ, Tẩy chữ, Quét chữ) không có panel: đang dùng = đang bật.
    const open = isTool
      ? it.id === "select"
        ? panel === "tool" && tool === "select"
        : tool === it.id
      : panel === it.id;
    const reason = props.disabled[it.id];
    const label = railLabel(it);
    return (
      <button
        key={it.id}
        type="button"
        className="cw-toolbtn"
        aria-label={label}
        aria-pressed={open}
        // Công cụ đang dùng (kể cả khi panel thu / đang ở Văn bản) — trình đọc màn hình biết công cụ nào đang bật.
        aria-current={isTool && tool === it.id ? "true" : undefined}
        data-current={isTool && tool === it.id && !open ? "" : undefined}
        aria-describedby={reason ? `cw-rail-why-${it.id}` : undefined}
        disabled={!!reason}
        onClick={() => props.onClick(it.id)}
      >
        {it.icon}
        <span className="cw-tip" aria-hidden="true">
          <strong>{it.name}</strong>
          {it.key && <kbd>{it.key}</kbd>}
          {reason && <em>{reason}</em>}
        </span>
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
      {props.showTrim && button(TRIM)}
      <span className="cw-toolrail-sep" />
      {PANELS.map(button)}
    </nav>
  );
}
