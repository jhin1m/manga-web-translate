/**
 * Thanh phụ trên canvas của công cụ Chữ (T) và Quét chữ (R): 1 dòng gợi ý cách dùng + tuỳ chọn của công cụ (Quét chữ
 * có lựa chọn xoá chữ gốc trong khung, nhớ theo trình duyệt; đang quét thì báo tiến độ + Huỷ). Tẩy chữ dùng
 * `MaskToolBar`, Chọn dùng panel khối (`SelectPanel`).
 */
import type { ReactNode } from "react";
import { useT } from "../../i18n/t.ts";

/** Khung chung của thanh phụ: nổi giữa mép trên canvas, không đẩy bố cục. */
export function CanvasToolBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cw-toolbar" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

export function TextToolBar() {
  const { t } = useT();
  return (
    <CanvasToolBar label={t("chapter.toolPanels.addText")}>
      <strong>{t("chapter.toolPanels.addText")}</strong>
      <span className="muted">{t("chapter.toolPanels.addTextHint")}</span>
    </CanvasToolBar>
  );
}

/** Dòng trạng thái OCR đang chờ: báo lần lỗi gần nhất (đang thử lại) + nút Huỷ để khỏi chờ vô hạn. */
export function OcrWait({ retry, onCancel, label }: { retry: string | null; onCancel(): void; label?: string }) {
  const { t } = useT();
  return (
    <div role="status">
      {retry && <p className="muted small">{retry}</p>}
      <button type="button" onClick={onCancel}>
        {label ?? t("chapter.toolPanels.cancelOcr")}
      </button>
    </div>
  );
}

export function OcrToolBar({
  pending,
  retry,
  onCancel,
  autoErase,
  onAutoErase,
  erasing,
}: {
  pending: number;
  retry: string | null;
  onCancel(): void;
  autoErase: boolean;
  onAutoErase(on: boolean): void;
  erasing: number;
}) {
  const { t, tp } = useT();
  return (
    <CanvasToolBar label={t("chapter.toolPanels.scan")}>
      <strong>{t("chapter.toolPanels.scan")}</strong>
      <span className="muted">{t("chapter.toolPanels.scanHint")}</span>
      <label className="cw-check" title={t("chapter.toolPanels.autoEraseTitle")}>
        <input type="checkbox" checked={autoErase} onChange={(e) => onAutoErase(e.target.checked)} />
        {t("chapter.toolPanels.autoErase")}
      </label>
      {pending > 0 && (
        <>
          <span className="status" data-tone="busy" role="status">
            {tp("chapter.toolPanels.scanning", pending)}
          </span>
          <OcrWait retry={retry} onCancel={onCancel} label={t("common.cancel")} />
        </>
      )}
      {erasing > 0 && (
        <span className="status" data-tone="busy" role="status">
          {t("chapter.toolPanels.erasing", { count: erasing })}
        </span>
      )}
    </CanvasToolBar>
  );
}
