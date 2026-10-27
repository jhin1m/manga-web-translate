/**
 * Drawer "Xuất chương": editor vẫn thấy phía sau. Cảnh báo tính từ dữ liệu đã có ở màn chương (tiến độ page + dòng
 * bảng văn bản), không gọi API thêm; có cảnh báo vẫn xuất được.
 */
import { useMemo } from "react";
import { Drawer } from "../../app/drawer.tsx";
import type { ChapterDetail, ProgressPage } from "./api.ts";
import { ExportPanel } from "./export-panel.tsx";
import { exportWarnings, warningLines } from "./export-warnings.ts";
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
  const { pages, rows } = props;
  const warnings = useMemo(() => warningLines(exportWarnings(pages, rows)), [pages, rows]);
  // Khớp tên server đặt khi tải (apps/api/src/routes/export.ts): `{series}-ch{số}`.
  const fileBase = props.detail ? `${props.detail.series.title}-ch${props.detail.number}` : "chuong";
  return (
    <Drawer title="Xuất chương" onClose={props.onClose}>
      <ExportPanel
        chapterId={props.chapterId}
        fileBase={fileBase}
        pageCount={pages.length}
        warnings={warnings}
        onShowWarnings={props.onShowWarnings}
        beforeStart={props.beforeStart}
        onCancel={props.onClose}
      />
    </Drawer>
  );
}
