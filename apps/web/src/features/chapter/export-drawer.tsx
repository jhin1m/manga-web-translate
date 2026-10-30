/**
 * Drawer "Xuất chương": editor vẫn thấy phía sau. Cảnh báo tính từ dữ liệu đã có ở màn chương (tiến độ page + dòng
 * bảng văn bản), không gọi API thêm; có cảnh báo vẫn xuất được.
 */
import { useMemo } from "react";
import { Drawer } from "../../app/drawer.tsx";
import type { ChapterDetail, ProgressPage } from "./api.ts";
import { ExportPanel } from "./export-panel.tsx";
import { exportWarnings } from "./export-warnings.ts";
import type { Row } from "./text-table/rows.ts";

export function ExportDrawer(props: {
  chapterId: string;
  detail: ChapterDetail | undefined;
  pages: ProgressPage[];
  rows: Row[];
  beforeStart(): Promise<unknown>;
  onShowWarnings(): void;
  onClose(): void;
}) {
  const { pages, rows, detail } = props;
  const warnings = useMemo(() => exportWarnings(pages, rows), [pages, rows]);
  // Ảnh đã tải lên còn dùng (bỏ file người dùng/hệ thống loại) — số ảnh khi xuất "như lúc tải lên".
  const sources = useMemo(() => detail?.source_files.filter((f) => f.skip === null).length ?? 0, [detail]);
  // Trang đã ẩn không được xuất → không tính vào số trang đã cắt.
  const shownPages = useMemo(() => pages.filter((p) => !p.skipped).length, [pages]);
  // Khớp tên server đặt khi tải (apps/api/src/routes/export.ts): `{series}-ch{số}`.
  const fileBase = detail ? `${detail.series.title}-ch${detail.number}` : "chuong";
  return (
    <Drawer title="Export chương" onClose={props.onClose}>
      <ExportPanel
        chapterId={props.chapterId}
        fileBase={fileBase}
        counts={{ sources, pages: shownPages }}
        warnings={warnings}
        onShowWarnings={props.onShowWarnings}
        beforeStart={props.beforeStart}
      />
    </Drawer>
  );
}
