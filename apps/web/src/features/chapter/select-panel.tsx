/**
 * Panel khối (panel ngữ cảnh của công cụ Chọn). Đóng mặc định, tự mở khi chọn khối hoặc khi có nội dung phải xử lý:
 * - Đầu panel (`BlockActions`, đặt ở đầu ContextPanel): "Khối i/N" + 3 icon Dịch lại khối · Nhân đôi · Xoá.
 * - Có khối (chọn trên canvas hoặc bảng): Gốc (OCR, chỉ đọc), Dịch (cùng nguồn với bảng), cảnh báo ngắn "Tràn 12px"
 *   (hướng dẫn ở tooltip), Font + Cỡ, nhóm "Kiểu chữ" thu gọn: Loại chữ, tự khớp, giãn dòng, lề, căn lề, màu, viền, ẩn khi
 *   xuất, "Áp kiểu" cho khối cùng loại.
 * - Chưa chọn khối: chỉ có nội dung đang chờ (AI có bản mới) hoặc một dòng gợi ý khi mở tay từ rail.
 * AI có bản mới luôn ở đầu thân panel (khi có); xung đột khi lưu nằm trên mọi panel (chapter-workspace.tsx). Thao tác
 * theo trang (dịch lại, ẩn, bỏ chỉnh sửa tay) ở menu chuột phải của cột trang.
 */
import type { TextBox } from "@mtl/shared";
import { deleteBox, duplicateBox } from "../editor/actions.ts";
import { type FontKit, fontForStyle } from "../editor/fonts.ts";
import { boxOverflow, MIN_SIZE } from "../editor/measure.ts";
import { AiUpdatePanel } from "../editor/panels/AiUpdatePanel.tsx";
import { AdvancedStyle, BasicStyle, type TextStyleConfig } from "../editor/panels/Properties.tsx";
import { TextField } from "../editor/panels/TextField.tsx";
import { editorStore, useEditor } from "../editor/store.ts";
import type { Series } from "../series/api.ts";
import type { ProgressPage } from "./api.ts";
import { KIND_LABEL, type Row } from "./text-table/rows.ts";
import { setRowTranslation } from "./text-table/text-table.tsx";
import { CopyIcon, RetranslateIcon, TrashIcon } from "./tool-icons.tsx";
import { OcrWait } from "./tool-panels.tsx";

function textStyleConfig(kit: FontKit | null, fonts: SelectPanelProps["defaultFonts"]): TextStyleConfig | undefined {
  if (!kit || !fonts) return undefined;
  return {
    slots: { thought: fonts.thought, note: fonts.note },
    fontFor: (style, kind) => fontForStyle(kit.manifest, fonts, style, kind, kit.knows),
  };
}

export type SelectPanelProps = {
  page: ProgressPage | undefined;
  /** Khối đang chọn trên page active (null: chưa chọn). */
  row: Row | null;
  kit: FontKit | null;
  /** Ngôn ngữ đích của series — dropdown font chỉ gợi ý font vẽ đủ chữ ngôn ngữ này. */
  targetLang?: string;
  /** `default_fonts` của series — slot Suy nghĩ/Ghi chú bật select "Loại chữ". */
  defaultFonts?: Series["default_fonts"];
  busy: { ocr: boolean; applyKind: boolean };
  /** Lần OCR lỗi gần nhất đang chờ thử lại + huỷ chờ. */
  ocrRetry: string | null;
  onCancelOcr(): void;
  onApplyKind(row: Row): void;
};

/** Lý do "Dịch lại khối" bị tắt (undefined = bấm được). */
export function reocrDisabled(row: Pick<Row, "regionId">, readOnly: boolean, ocrBusy: boolean) {
  if (!row.regionId) return "Khối tự thêm không có vùng quét chữ để dịch lại";
  if (readOnly) return "Đang chỉ xem";
  if (ocrBusy) return "Đang quét chữ…";
  return undefined;
}

/** Cảnh báo tràn khung: `text` hiện trong panel, `hint` (cách xử lý) ở tooltip. */
export function overflowWarning(box: TextBox, kit: FontKit | null) {
  if (!kit || box.hidden) return null;
  const px = boxOverflow(box, kit.metrics(box.font_family), kit.measure);
  if (px <= 0) return null;
  const min = box.auto_fit && box.font_size <= MIN_SIZE ? " ở cỡ tối thiểu" : "";
  const n = Math.ceil(px);
  return { text: `Tràn ${n}px${min}`, hint: `Tràn khung ${n}px${min} — nới khung hoặc rút gọn câu.` };
}

/** 3 icon đầu panel: Dịch lại khối (nhận dạng + dịch lại vùng OCR) · Nhân đôi · Xoá. */
export function BlockActions(props: { row: Row; ocrBusy: boolean; onReocr(row: Row): void }) {
  const { row } = props;
  const readOnly = useEditor((s) => !!s.readOnly);
  const box = useEditor((s) => (row.boxId ? s.doc?.text_boxes.find((b) => b.id === row.boxId) : undefined));
  const reocrOff = reocrDisabled(row, readOnly, props.ocrBusy);
  const editOff = readOnly ? "Đang chỉ xem" : undefined;
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dịch lại khối"
        title={reocrOff ?? "Dịch lại khối (nhận dạng + dịch lại vùng này, thay chữ gốc và bản dịch)"}
        disabled={!!reocrOff}
        onClick={() => props.onReocr(row)}
      >
        <RetranslateIcon size={16} />
      </button>
      {box && (
        <>
          <button
            type="button"
            className="icon-btn"
            aria-label="Nhân đôi khối"
            title={editOff ?? "Nhân đôi khối"}
            disabled={!!editOff}
            onClick={() => {
              const id = `tb-${crypto.randomUUID().slice(0, 8)}`;
              const st = editorStore.getState();
              st.apply(duplicateBox(box, id));
              st.select(id);
            }}
          >
            <CopyIcon size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-danger
            aria-label="Xoá khối"
            title={editOff ?? "Xoá khối (Delete)"}
            disabled={!!editOff}
            onClick={() => editorStore.getState().apply(deleteBox(box.id))}
          >
            <TrashIcon size={16} />
          </button>
        </>
      )}
    </>
  );
}

export function SelectPanel(props: SelectPanelProps) {
  const { page, row } = props;
  if (!page) return <p className="muted small cw-pad">Chưa có trang để sửa.</p>;
  return (
    <>
      <AiUpdatePanel />
      {row ? (
        <BlockView {...props} row={row} />
      ) : (
        <p className="muted small cw-pad">Bấm một khối chữ trên ảnh để sửa.</p>
      )}
    </>
  );
}

function BlockView(props: SelectPanelProps & { row: Row }) {
  const { row } = props;
  const readOnly = useEditor((s) => !!s.readOnly);
  const box = useEditor((s) => (row.boxId ? s.doc?.text_boxes.find((b) => b.id === row.boxId) : undefined));
  const warn = box ? overflowWarning(box, props.kit) : null;
  const kind = KIND_LABEL[row.kind].toLowerCase();

  return (
    <section className="cw-block">
      <div className="cw-field">
        <span className="cw-field-head">Gốc</span>
        <div className="cw-src-box">{row.source || <span className="muted">—</span>}</div>
      </div>
      <div className="cw-field">
        <label className="cw-field-head" htmlFor="cw-translation">
          Dịch
        </label>
        <TextField
          id="cw-translation"
          key={row.key}
          rows={3}
          value={row.translation}
          disabled={readOnly}
          onValue={(text) => setRowTranslation(row, text)}
        />
        {warn && (
          <p className="cw-warn" role="status" title={warn.hint}>
            {warn.text}
          </p>
        )}
      </div>
      {props.busy.ocr && (
        <div className="cw-field">
          <span className="status" data-tone="busy">
            Đang quét chữ…
          </span>
          <OcrWait retry={props.ocrRetry} onCancel={props.onCancelOcr} />
        </div>
      )}
      {box ? (
        <>
          <BasicStyle
            fonts={props.kit?.idsFor(props.targetLang) ?? []}
            customFonts={props.kit?.custom ?? []}
            knows={props.kit?.knows}
          />
          <details className="cw-adv">
            <summary>Kiểu chữ</summary>
            <AdvancedStyle textStyle={textStyleConfig(props.kit, props.defaultFonts)}>
              <button
                type="button"
                className="cw-wide"
                disabled={readOnly || props.busy.applyKind}
                title={`Áp font, cỡ, căn lề, màu, viền của khối này cho mọi khối ${kind} trong chương (hoàn tác được)`}
                onClick={() => props.onApplyKind(row)}
              >
                {props.busy.applyKind ? "Đang áp kiểu…" : `Áp kiểu cho khối ${kind}`}
              </button>
            </AdvancedStyle>
          </details>
        </>
      ) : (
        <p className="muted small">Vùng này chưa có khung chữ — dùng công cụ Chữ (T) để thêm.</p>
      )}
    </section>
  );
}
