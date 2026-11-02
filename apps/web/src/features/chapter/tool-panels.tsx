/**
 * Panel ngữ cảnh của công cụ Chữ (T) và OCR vùng (R): gợi ý cách dùng + thiết lập đang áp (đổi ở Cài đặt series);
 * OCR vùng có thêm lựa chọn xoá chữ gốc trong khung (nhớ theo trình duyệt).
 * Mask / Tẩy dùng `MaskPanel`, Chọn dùng `SelectPanel`.
 */
import { LANG_NAMES, type SourceLang } from "../series/lang-labels.ts";

export function TextToolView({ font }: { font: string }) {
  return (
    <section className="cw-block">
      <p className="muted small">Kéo một khung trên ảnh để tạo khối chữ mới.</p>
      <div className="cw-field">
        <span className="cw-field-head">Font khối mới</span>
        <div className="cw-src-box">{font}</div>
        <span className="muted small">Font thoại của series — đổi ở Cài đặt series.</span>
      </div>
    </section>
  );
}

/** Dòng trạng thái OCR đang chờ: báo lần lỗi gần nhất (đang thử lại) + nút Huỷ để khỏi chờ vô hạn. */
export function OcrWait({ retry, onCancel }: { retry: string | null; onCancel(): void }) {
  return (
    <div role="status">
      {retry && <p className="muted small">{retry}</p>}
      <button type="button" onClick={onCancel}>
        Huỷ OCR
      </button>
    </div>
  );
}

export function OcrToolView({
  lang,
  pending,
  retry,
  onCancel,
  autoErase,
  onAutoErase,
  erasing,
}: {
  lang: string | undefined;
  pending: number;
  retry: string | null;
  onCancel(): void;
  autoErase: boolean;
  onAutoErase(on: boolean): void;
  erasing: number;
}) {
  return (
    <section className="cw-block">
      <ol className="muted small ed-steps">
        <li>Kéo khung quanh chữ AI bỏ sót.</li>
        <li>Bấm "Nhận dạng vùng này" cạnh khung (hoặc Enter). Esc hoặc kéo lại để bỏ khung.</li>
        <li>
          Chữ đọc được thành khối mới và được dịch luôn
          {autoErase ? "; chữ gốc trong khung được xoá khỏi ảnh." : "."}
        </li>
      </ol>
      <label className="cw-check">
        <input type="checkbox" checked={autoErase} onChange={(e) => onAutoErase(e.target.checked)} />
        Xoá chữ gốc trong khung
      </label>
      <div className="cw-field">
        <span className="cw-field-head">Ngôn ngữ gốc</span>
        <div className="cw-src-box">{lang ? (LANG_NAMES[lang as SourceLang] ?? lang) : "—"}</div>
        <span className="muted small">Theo series — đổi ở chip ngôn ngữ trên thanh trên.</span>
      </div>
      {pending > 0 && (
        <p role="status">
          <span className="status" data-tone="busy">
            Đang OCR {pending} vùng…
          </span>
        </p>
      )}
      {pending > 0 && <OcrWait retry={retry} onCancel={onCancel} />}
      {erasing > 0 && (
        <p role="status">
          <span className="status" data-tone="busy">
            Đang xoá chữ gốc… ({erasing})
          </span>
        </p>
      )}
    </section>
  );
}
