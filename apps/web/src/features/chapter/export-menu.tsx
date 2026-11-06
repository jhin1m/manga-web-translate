/**
 * Menu "Xuất chương" dưới nút Xuất của thanh trên (cũng mở từ mục Xuất trong menu ⋯ khi chương có trang lỗi): popover
 * không chặn thao tác, editor vẫn thấy phía sau. Đóng bằng Esc hoặc bấm ra ngoài, rồi trả focus về nút đã mở. Nội dung
 * dài thì cuộn trong menu. Cảnh báo tính từ dữ liệu đã có ở màn chương (tiến độ page + dòng bảng văn bản), không gọi
 * API thêm; có cảnh báo vẫn xuất được. Lượt xuất đang chạy vẫn theo dõi được ở chip và Hoạt động khi menu đóng.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ChapterDetail, ProgressPage } from "./api.ts";
import { ExportPanel } from "./export-panel.tsx";
import { exportWarnings } from "./export-warnings.ts";
import type { Row } from "./text-table/rows.ts";

/** Khoảng cách mép phải menu tới mép cửa sổ khi không có nút để căn theo. */
const EDGE = 16;

export function ExportMenu(props: {
  chapterId: string;
  detail: ChapterDetail | undefined;
  pages: ProgressPage[];
  rows: Row[];
  /** Nút đã mở menu: menu căn mép phải theo nút, bấm lại nút đó không đóng-rồi-mở, đóng thì trả focus về nút. */
  opener: HTMLElement | null;
  beforeStart(): Promise<unknown>;
  onShowWarnings(): void;
  onClose(): void;
}) {
  const { pages, rows, detail, opener } = props;
  const warnings = useMemo(() => exportWarnings(pages, rows), [pages, rows]);
  // Ảnh đã tải lên còn dùng (bỏ file người dùng/hệ thống loại) — số ảnh khi xuất "như lúc tải lên".
  const sources = useMemo(() => detail?.source_files.filter((f) => f.skip === null).length ?? 0, [detail]);
  // Trang đã ẩn không được xuất → không tính vào số trang đã cắt.
  const shownPages = useMemo(() => pages.filter((p) => !p.skipped).length, [pages]);
  // Khớp tên server đặt khi tải (apps/api/src/routes/export.ts): `{series}-ch{số}`.
  const fileBase = detail ? `${detail.series.title}-ch${detail.number}` : "chuong";

  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    ref.current?.focus();
    const closeAndReturn = () => {
      close.current();
      if (opener?.isConnected) opener.focus();
    };
    // Capture: Esc đóng menu trước mọi phím tắt khác của màn.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      closeAndReturn();
    };
    // Bấm lại nút mở menu → để chính nút đó đóng (không đóng rồi mở lại ngay).
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !opener?.contains(t)) close.current();
    };
    addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [opener]);

  const right = opener ? Math.max(8, innerWidth - opener.getBoundingClientRect().right) : EDGE;
  return (
    <div
      ref={ref}
      className="exp-menu"
      role="dialog"
      aria-label="Xuất chương"
      tabIndex={-1}
      style={{ right }}
      onKeyDown={(e) => {
        // Tab ra khỏi menu → đóng, focus đi tiếp từ nút đã mở.
        if (e.key === "Tab" && ref.current) {
          const items = [
            ...ref.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input, summary"),
          ];
          const first = items[0];
          const last = items.at(-1);
          const at = document.activeElement;
          if ((!e.shiftKey && at === last) || (e.shiftKey && (at === first || at === ref.current))) {
            e.preventDefault();
            close.current();
            if (opener?.isConnected) opener.focus();
          }
        }
      }}
    >
      <ExportPanel
        chapterId={props.chapterId}
        fileBase={fileBase}
        counts={{ sources, pages: shownPages }}
        warnings={warnings}
        onShowWarnings={props.onShowWarnings}
        beforeStart={props.beforeStart}
      />
    </div>
  );
}
