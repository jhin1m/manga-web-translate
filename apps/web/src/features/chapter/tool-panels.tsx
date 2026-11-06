/**
 * Thanh phụ trên canvas của công cụ Chữ (T) và Quét chữ (R): 1 dòng gợi ý cách dùng + tuỳ chọn của công cụ (Quét chữ
 * có lựa chọn xoá chữ gốc trong khung, nhớ theo trình duyệt; đang quét thì báo tiến độ + Huỷ). Tẩy chữ dùng
 * `MaskToolBar`, Chọn dùng panel khối (`SelectPanel`).
 */
import type { ReactNode } from "react";

/** Khung chung của thanh phụ: nổi giữa mép trên canvas, không đẩy bố cục. */
export function CanvasToolBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cw-toolbar" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

export function TextToolBar() {
  return (
    <CanvasToolBar label="Thêm chữ">
      <strong>Thêm chữ</strong>
      <span className="muted">Kéo khung trên ảnh</span>
    </CanvasToolBar>
  );
}

/** Dòng trạng thái OCR đang chờ: báo lần lỗi gần nhất (đang thử lại) + nút Huỷ để khỏi chờ vô hạn. */
export function OcrWait({
  retry,
  onCancel,
  label = "Huỷ quét chữ",
}: {
  retry: string | null;
  onCancel(): void;
  label?: string;
}) {
  return (
    <div role="status">
      {retry && <p className="muted small">{retry}</p>}
      <button type="button" onClick={onCancel}>
        {label}
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
  return (
    <CanvasToolBar label="Quét chữ">
      <strong>Quét chữ</strong>
      <span className="muted">Kéo khung quanh chữ</span>
      <label className="cw-check" title="Sau khi quét xong, xoá chữ gốc trong khung khỏi ảnh">
        <input type="checkbox" checked={autoErase} onChange={(e) => onAutoErase(e.target.checked)} />
        Xoá chữ gốc
      </label>
      {pending > 0 && (
        <>
          <span className="status" data-tone="busy" role="status">
            Đang quét {pending} vùng…
          </span>
          <OcrWait retry={retry} onCancel={onCancel} label="Huỷ" />
        </>
      )}
      {erasing > 0 && (
        <span className="status" data-tone="busy" role="status">
          Đang xoá chữ gốc… ({erasing})
        </span>
      )}
    </CanvasToolBar>
  );
}
