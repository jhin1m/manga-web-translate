/**
 * Panel ngữ cảnh của công cụ Chữ (T) và OCR vùng (R): chỉ gợi ý cách dùng + thiết lập đang áp (đổi ở Cài đặt series).
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

export function OcrToolView({ lang, pending }: { lang: string | undefined; pending: number }) {
  return (
    <section className="cw-block">
      <p className="muted small">Kéo khung quanh chữ AI bỏ sót. Chữ đọc được thành khối mới và được dịch luôn.</p>
      <div className="cw-field">
        <span className="cw-field-head">Ngôn ngữ gốc</span>
        <div className="cw-src-box">{lang ? (LANG_NAMES[lang as SourceLang] ?? lang) : "—"}</div>
        <span className="muted small">Theo series — đổi ở Cài đặt series.</span>
      </div>
      {pending > 0 && (
        <p role="status">
          <span className="status" data-tone="busy">
            Đang OCR {pending} vùng…
          </span>
        </p>
      )}
    </section>
  );
}
