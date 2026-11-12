/**
 * Thanh trên màn chương: nút bật/tắt "Gốc" (xem ảnh gốc; thay `[Gốc | Dịch | Chia đôi]`) và menu "⋯" (Chia đôi gốc /
 * dịch, thao tác phụ theo trạng thái chương — Xuất, Dịch lại cả chương, Chạy lại trang lỗi —, Hoạt động, Phím tắt).
 */
import { useRef, useState } from "react";
import { chapterStore, effectiveMode, useChapterStore } from "../editor/chapter-store.ts";
import { useEditor } from "../editor/store.ts";
import { ContextMenu, type MenuAt, type MenuItem } from "./context-menu.tsx";
import type { ChapterCommand } from "./primary-action.ts";
import { EyeIcon, MoreIcon } from "./tool-icons.tsx";

/**
 * Sáng khi đang hiện ảnh gốc (kể cả lúc giữ `O`). Bấm: Gốc ↔ Dịch; đang Chia đôi → sang Gốc. Phím `\` cùng tác dụng.
 * Trang chưa có bản dịch thì Gốc và Dịch như nhau nên không hiện nút, trừ khi đang bật Gốc (vẫn phải có lối tắt ra).
 */
export function OriginalToggle() {
  const mode = useChapterStore(effectiveMode);
  const on = mode === "original";
  const translated = useEditor((s) => !!s.doc?.regions.some((r) => r.translation.trim()));
  const stuck = useChapterStore((s) => s.viewMode === "original");
  if (!translated && !stuck) return null;
  return (
    <button
      type="button"
      className="cw-orig"
      aria-pressed={on}
      aria-label="Xem gốc"
      title="Xem ảnh gốc (giữ O · \ đổi Gốc/Dịch)"
      onClick={() => {
        const s = chapterStore.getState();
        s.setViewMode(s.viewMode === "original" ? "translated" : "original");
      }}
    >
      <EyeIcon size={16} />
      Gốc
    </button>
  );
}

export function MoreMenu(props: {
  /** Mục phụ của nút chính (primary-action.ts) đưa vào menu. */
  commands: { command: ChapterCommand; label: string; title?: string }[];
  pending: boolean;
  onCommand(cmd: ChapterCommand, opener?: HTMLElement): void;
  /** Mở Hoạt động — lối vào cố định (nút riêng đã bỏ khỏi thanh trên). */
  onActivity(): void;
  /** Số việc đang chạy (upload, job chương, xuất) — ghi cạnh mục Hoạt động. */
  activityCount: number;
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
    ...props.commands.map((m) => ({
      label: m.label,
      title: m.title,
      disabled: props.pending,
      run: () => props.onCommand(m.command, btn.current ?? undefined),
    })),
    {
      label: props.activityCount > 0 ? `Hoạt động (${props.activityCount} đang chạy)` : "Hoạt động",
      run: props.onActivity,
    },
    { label: "Phím tắt (?)", run: props.onHelp },
  ];
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="icon-btn"
        aria-label="Thêm thao tác"
        title="Thêm thao tác"
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
