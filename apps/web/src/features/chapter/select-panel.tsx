/**
 * Panel Chọn (panel ngữ cảnh của công cụ Chọn), 3 trạng thái:
 * - Có khối (chọn trên canvas hoặc bảng): Gốc (OCR, chỉ đọc), Bản dịch (cùng nguồn với bảng), cảnh báo tràn khung,
 *   font / cỡ / tự khớp, "Kiểu chữ nâng cao" (thu gọn: giãn dòng, lề, căn lề, màu, viền, ẩn khi xuất, áp kiểu cho khối
 *   cùng loại), Dịch lại khối (nhận dạng + dịch lại vùng OCR), Xoá khối, Dịch lại trang này.
 * - Chưa có khối: trang đang xem (trạng thái, cờ, lỗi job) + Dịch lại trang này · Ẩn trang này + "Bỏ chỉnh sửa tay"
 *   khi trang khác bản AI.
 * - Chương chưa có page: ảnh gốc đang xem + Xoá / Khôi phục ảnh (trước Bước 1).
 * AI có bản mới luôn ở đầu panel (khi có); xung đột khi lưu nằm trên mọi panel (chapter-workspace.tsx).
 */
import type { TextBox } from "@mtl/shared";
import { useMemo, useState } from "react";
import { deleteBox, resetToAI } from "../editor/actions.ts";
import type { FontKit } from "../editor/fonts.ts";
import { boxOverflow, MIN_SIZE } from "../editor/measure.ts";
import { AiUpdatePanel } from "../editor/panels/AiUpdatePanel.tsx";
import { AdvancedStyle, BasicStyle } from "../editor/panels/Properties.tsx";
import { TextField } from "../editor/panels/TextField.tsx";
import { editorStore, useEditor } from "../editor/store.ts";
import type { ProgressPage } from "./api.ts";
import { describeJobError } from "./job-error.ts";
import { PAGE_LEVEL, pageLevelOf, thumbFlags } from "./page-status.ts";
import { type SourceItem, sourceLabel } from "./source-rail-model.ts";
import { KIND_LABEL, type Row } from "./text-table/rows.ts";
import { setRowTranslation } from "./text-table/text-table.tsx";

export type SelectPanelProps = {
  ws: string;
  page: ProgressPage | undefined;
  /** Khối đang chọn trên page active (null: chưa chọn). */
  row: Row | null;
  /** Số khối (dòng bảng) trên page active — "Khối i / tổng". */
  blockTotal: number;
  /** Số khối tràn khung trên page active. */
  overflowCount: number;
  kit: FontKit | null;
  busy: { retranslate: boolean; ocr: boolean; applyKind: boolean };
  onRetranslatePage(): void;
  /** "Dịch lại khối": nhận dạng + dịch lại vùng OCR của khối. */
  onReocr(row: Row): void;
  onApplyKind(row: Row): void;
  /** Ẩn trang đang xem (không dịch, không xuất). */
  onHidePage(): void;
  /** Lý do không ẩn được (không giữ khoá, trang cuối…); undefined = ẩn được. */
  hideDisabled?: string;
  /** Chương chưa có page: ảnh gốc đang xem + xoá / khôi phục trước Bước 1. */
  source?: SourceView;
};

export type SourceView = {
  item: SourceItem | undefined;
  total: number;
  skipped: number;
  editable: boolean;
  onSkip(it: SourceItem, skip: "user" | null): void;
};

/** Lý do "Dịch lại khối" bị tắt (undefined = bấm được). */
export function reocrDisabled(row: Pick<Row, "regionId">, readOnly: boolean, ocrBusy: boolean) {
  if (!row.regionId) return "Khối tự thêm không có vùng OCR để dịch lại";
  if (readOnly) return "Đang chỉ xem";
  if (ocrBusy) return "Đang OCR…";
  return undefined;
}

function overflowText(box: TextBox, kit: FontKit | null) {
  if (!kit || box.hidden) return null;
  const px = boxOverflow(box, kit.metrics(box.font_family), kit.measure);
  if (px <= 0) return null;
  const min = box.auto_fit && box.font_size <= MIN_SIZE ? " ở cỡ tối thiểu" : "";
  return `Tràn khung ${Math.ceil(px)}px${min} — nới khung hoặc rút gọn câu.`;
}

export function SelectPanel(props: SelectPanelProps) {
  const { page, row } = props;
  if (props.source) return <SourcePanel {...props.source} />;
  if (!page) return <p className="muted small cw-pad">Chưa có trang để sửa.</p>;
  return (
    <>
      <AiUpdatePanel ws={props.ws} />
      {row ? <BlockView {...props} page={page} row={row} /> : <PageView {...props} page={page} />}
    </>
  );
}

function RetranslatePage(props: SelectPanelProps & { link?: boolean }) {
  const readOnly = useEditor((s) => !!s.readOnly);
  return (
    <button
      type="button"
      className={props.link ? "btn-link" : undefined}
      disabled={readOnly || props.busy.retranslate}
      title="Dịch lại riêng trang này bằng AI (chỉnh sửa tay được giữ, bản AI mới hiện để chọn áp)"
      onClick={props.onRetranslatePage}
    >
      Dịch lại trang này
    </button>
  );
}

function BlockView(props: SelectPanelProps & { page: ProgressPage; row: Row }) {
  const { page, row } = props;
  const readOnly = useEditor((s) => !!s.readOnly);
  const box = useEditor((s) => (row.boxId ? s.doc?.text_boxes.find((b) => b.id === row.boxId) : undefined));
  // Áp kiểu cả chương ghi thẳng các trang khác (không hoàn tác được) → hỏi lại 1 bước, gắn với khối đang chọn.
  const [confirmKind, setConfirmKind] = useState<string | null>(null);
  const warn = box ? overflowText(box, props.kit) : null;
  const kind = KIND_LABEL[row.kind];
  const reocrOff = reocrDisabled(row, readOnly, props.busy.ocr);

  return (
    <section className="cw-block">
      <p className="cw-panel-sub">
        Trang {page.ord + 1} · Khối {row.index} / {props.blockTotal} · {kind}
      </p>
      <div className="cw-field">
        <span className="cw-field-head">Gốc (OCR)</span>
        <div className="cw-src-box">{row.source || <span className="muted">—</span>}</div>
      </div>
      <div className="cw-field">
        <label className="cw-field-head" htmlFor="cw-translation">
          Bản dịch
        </label>
        <TextField
          id="cw-translation"
          key={row.key}
          rows={3}
          value={row.translation}
          disabled={readOnly}
          onValue={(text) => setRowTranslation(row, text)}
        />
      </div>
      {warn && (
        <p className="cw-warn" role="status">
          {warn}
        </p>
      )}
      {box ? (
        <>
          <BasicStyle fonts={props.kit?.ids ?? []} customFonts={props.kit?.custom ?? []} />
          <details className="cw-adv">
            <summary>Kiểu chữ nâng cao</summary>
            <AdvancedStyle>
              {confirmKind === row.key ? (
                <div className="cw-field">
                  <p className="notice" role="status">
                    Áp font, cỡ, căn lề, màu, viền của khối này cho mọi khối {kind.toLowerCase()} trong chương? Trang
                    khác ghi ngay, không hoàn tác được.
                  </p>
                  <div className="row">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={readOnly || props.busy.applyKind}
                      onClick={() => {
                        setConfirmKind(null);
                        props.onApplyKind(row);
                      }}
                    >
                      Áp kiểu
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirmKind(null)}>
                      Huỷ
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="cw-wide"
                  disabled={readOnly || props.busy.applyKind}
                  onClick={() => setConfirmKind(row.key)}
                >
                  {props.busy.applyKind ? "Đang áp kiểu…" : `Áp kiểu này cho khối ${kind.toLowerCase()} trong chương`}
                </button>
              )}
            </AdvancedStyle>
          </details>
        </>
      ) : (
        <p className="muted small">Vùng này chưa có khung chữ — dùng công cụ Chữ (T) để thêm.</p>
      )}
      <div className="row">
        <button
          type="button"
          disabled={!!reocrOff}
          title={reocrOff ?? "Nhận dạng + dịch lại vùng này (thay chữ gốc và bản dịch)"}
          onClick={() => props.onReocr(row)}
        >
          {props.busy.ocr ? "Đang OCR…" : "Dịch lại khối"}
        </button>
        {box && (
          <button
            type="button"
            className="btn-danger"
            disabled={readOnly}
            title="Xoá khối (Delete)"
            onClick={() => editorStore.getState().apply(deleteBox(box.id))}
          >
            Xoá khối
          </button>
        )}
      </div>
      <div>
        <RetranslatePage {...props} link />
      </div>
    </section>
  );
}

function PageView(props: SelectPanelProps & { page: ProgressPage }) {
  const { page } = props;
  const readOnly = useEditor((s) => !!s.readOnly);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const doc = useEditor((s) => s.doc);
  const ai = useEditor((s) => s.ai.state);
  // Trang khác bản AI (chữ/khung/kiểu) → mới có gì để bỏ. Immer giữ tham chiếu khi không sửa → chỉ so lại khi đổi.
  const edited = useMemo(
    () =>
      !!doc && !!ai && JSON.stringify([doc.regions, doc.text_boxes]) !== JSON.stringify([ai.regions, ai.text_boxes]),
    [doc, ai],
  );
  const lv = PAGE_LEVEL[pageLevelOf(page)];
  const jobError = describeJobError(page.job);
  // Cờ chờ AI đã nói ở dòng lỗi job; tràn khung nói kèm số khối.
  const flags = thumbFlags(page, false).filter((f) => f !== "chờ AI thử lại");

  return (
    <section className="cw-block">
      <p className="cw-panel-sub cw-page-line">
        <strong>Trang {page.ord + 1}</strong>
        <span className="status" data-tone={lv.tone}>
          {lv.label}
        </span>
      </p>
      {(flags.length > 0 || props.overflowCount > 0 || jobError) && (
        <ul className="cw-flags">
          {page.ai_update_available && <li>AI có bản mới — xem bảng "AI có bản mới" ở trên.</li>}
          {props.overflowCount > 0 && <li>Tràn khung: {props.overflowCount} khối.</li>}
          {page.cut_flag && <li>Cắt ở trần chiều cao (không theo khoảng trắng).</li>}
          {jobError && (
            <li className={jobError.waiting ? "warn-text" : "danger"}>
              {jobError.text}
              {page.job?.error && page.job.status !== "cancelled" && (
                <details className="cw-error-raw">
                  <summary>Chi tiết kỹ thuật</summary>
                  {page.job.error}
                </details>
              )}
            </li>
          )}
        </ul>
      )}
      <p className="muted small">Bấm một khối chữ trên ảnh để sửa.</p>
      <div className="row">
        <RetranslatePage {...props} />
        <button
          type="button"
          disabled={!!props.hideDisabled}
          title={props.hideDisabled ?? "Không dịch, không xuất — khôi phục được ở cột trang"}
          onClick={props.onHidePage}
        >
          Ẩn trang này
        </button>
      </div>
      {edited &&
        ai &&
        (confirmReset === page.id ? (
          <>
            <p className="notice" role="status">
              Bỏ mọi chỉnh sửa tay trên trang {page.ord + 1} (bản dịch, khung, kiểu chữ) và dùng lại bản AI dịch? Hoàn
              tác được bằng Ctrl/Cmd+Z.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn-primary"
                disabled={readOnly}
                onClick={() => {
                  setConfirmReset(null);
                  editorStore.getState().apply(resetToAI(ai));
                }}
              >
                Bỏ chỉnh sửa
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmReset(null)}>
                Huỷ
              </button>
            </div>
          </>
        ) : (
          <div>
            <button
              type="button"
              className="btn-link"
              disabled={readOnly}
              title="Thay chỉnh sửa tay của trang này bằng bản AI dịch"
              onClick={() => setConfirmReset(page.id)}
            >
              Bỏ chỉnh sửa tay, dùng lại bản AI
            </button>
          </div>
        ))}
    </section>
  );
}

/** Panel Chọn khi chương chưa có page: ảnh gốc đang xem ở canvas. */
function SourcePanel({ item, total, skipped, editable, onSkip }: SourceView) {
  if (!item) return <p className="muted small cw-pad">Chưa có ảnh nào.</p>;
  const tag = sourceLabel(item);
  return (
    <section className="cw-block">
      <p className="cw-panel-sub cw-page-line">
        <strong>Ảnh {item.n}</strong>
        {tag && (
          <span className="status" data-tone={tag.tone}>
            {tag.label}
          </span>
        )}
      </p>
      <p className="muted small">
        {total} ảnh{skipped > 0 ? ` · đã bỏ ${skipped}` : ""}
      </p>
      {editable ? (
        <div className="row">
          {item.skip ? (
            <button type="button" onClick={() => onSkip(item, null)}>
              Khôi phục ảnh này
            </button>
          ) : (
            <button
              type="button"
              className="btn-danger"
              title="Bước 1 bỏ qua ảnh này"
              onClick={() => onSkip(item, "user")}
            >
              Xoá ảnh này
            </button>
          )}
        </div>
      ) : (
        <p className="muted small">Bộ ảnh đã chốt — không xoá / khôi phục ảnh được nữa.</p>
      )}
    </section>
  );
}
