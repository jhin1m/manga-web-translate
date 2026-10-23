/**
 * Thanh trên màn chương: nút bật/tắt "Xem gốc" (thay `[Gốc | Dịch | Chia đôi]`) và menu "⋯" (Chia đôi gốc / dịch,
 * thao tác phụ theo trạng thái chương — Dịch lại cả chương, Chạy lại trang lỗi —, Phím tắt).
 */
import { useRef, useState } from "react";
import { chapterStore, effectiveMode, useChapterStore } from "../editor/chapter-store.ts";
import { ContextMenu, type MenuAt, type MenuItem } from "./context-menu.tsx";
import type { ChapterCommand } from "./primary-action.ts";
import { EyeIcon, MoreIcon } from "./tool-icons.tsx";

/**
 * Sáng khi đang hiện ảnh gốc (kể cả lúc giữ `O`). Bấm: Gốc ↔ Dịch; đang Chia đôi → sang Gốc. Phím `\` cùng tác dụng.
 */
export function OriginalToggle() {
  const mode = useChapterStore(effectiveMode);
  const on = mode === "original";
  return (
    <button
      type="button"
      className="cw-orig"
      aria-pressed={on}
      title="Xem ảnh gốc (giữ O · \ đổi Gốc/Dịch)"
      onClick={() => {
        const s = chapterStore.getState();
        s.setViewMode(s.viewMode === "original" ? "translated" : "original");
      }}
    >
      <EyeIcon size={16} />
      Xem gốc
    </button>
  );
}

export function MoreMenu(props: {
  /** Mục phụ của nút chính (primary-action.ts) đưa vào menu — đã bỏ "Huỷ xử lý" / "Xuất" (nút riêng trên thanh). */
  commands: { command: ChapterCommand; label: string }[];
  pending: boolean;
  onCommand(cmd: ChapterCommand): void;
  onHelp(): void;
}) {
  const split = useChapterStore((s) => s.viewMode === "split");
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<MenuAt | null>(null);
  const items: MenuItem[] = [
    {
      label: "Chia đôi gốc / dịch",
      checked: split,
      title: "Gốc bên trái, Dịch bên phải — cuộn/zoom cùng nhau, sửa ở cột Dịch",
      run: () => chapterStore.getState().setViewMode(split ? "translated" : "split"),
    },
    ...props.commands.map((m) => ({ label: m.label, disabled: props.pending, run: () => props.onCommand(m.command) })),
    { label: "Phím tắt (?)", run: props.onHelp },
  ];
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="icon-btn"
        aria-label="Thêm thao tác"
        title="Chia đôi · Dịch lại · Phím tắt"
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          if (at) return setAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.right, y: r.bottom + 4 });
        }}
      >
        <MoreIcon />
      </button>
      {at && (
        <ContextMenu
          at={at}
          alignRight
          anchor={btn.current}
          label="Thêm thao tác"
          items={items}
          onClose={() => setAt(null)}
        />
      )}
    </>
  );
}
