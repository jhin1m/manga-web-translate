/**
 * Inspector bên phải màn chương, 2 tab:
 * - "Khối chữ": khối đang chọn (bảng hoặc canvas) — Gốc (OCR, read-only) + "OCR lại", Bản dịch (cùng nguồn với
 *   bảng), cảnh báo tràn khung, thuộc tính box, "Áp kiểu này cho khối cùng loại trong chương". Không chọn khối →
 *   thông tin trang (trạng thái, cờ, lỗi job). Luôn có "Dịch lại trang này", AI có bản mới, xung đột khi lưu.
 * - "Xoá chữ": brush/tẩy mask + xoá chữ lại (MaskPanel). Chọn tab = đổi công cụ và ngược lại.
 */
import type { TextBox } from "@mtl/shared";
import { useState } from "react";
import type { FontKit } from "../editor/fonts.ts";
import { boxOverflow, MIN_SIZE } from "../editor/measure.ts";
import { AiUpdatePanel } from "../editor/panels/AiUpdatePanel.tsx";
import { ConflictList } from "../editor/panels/ConflictList.tsx";
import { MaskPanel } from "../editor/panels/MaskPanel.tsx";
import { Properties } from "../editor/panels/Properties.tsx";
import { TextField } from "../editor/panels/TextField.tsx";
import { editorStore, useEditor } from "../editor/store.ts";
import type { ProgressPage } from "./api.ts";
import { PAGE_LEVEL, pageLevel } from "./page-status.ts";
import { KIND_LABEL, type Row } from "./text-table/rows.ts";
import { setRowTranslation } from "./text-table/text-table.tsx";

export type InspectorProps = {
  ws: string;
  page: ProgressPage | undefined;
  /** Khối đang chọn trên page active (null: chưa chọn). */
  row: Row | null;
  /** Số khối tràn khung trên page active. */
  overflowCount: number;
  kit: FontKit | null;
  busy: { retranslate: boolean; ocr: boolean; applyKind: boolean };
  onRetranslatePage(): void;
  onReocr(row: Row): void;
  onApplyKind(row: Row): void;
  onMaskDone(): void;
};

function overflowText(box: TextBox, kit: FontKit | null) {
  if (!kit || box.hidden) return null;
  const px = boxOverflow(box, kit.metrics(box.font_family), kit.measure);
  if (px <= 0) return null;
  const min = box.auto_fit && box.font_size <= MIN_SIZE ? " ở cỡ tối thiểu" : "";
  return `Tràn khung ${Math.ceil(px)}px${min} — nới khung hoặc rút gọn câu.`;
}

export function Inspector(props: InspectorProps) {
  const { page, row } = props;
  const tool = useEditor((s) => s.tool);
  const readOnly = useEditor((s) => !!s.readOnly);
  const box = useEditor((s) => (row?.boxId ? s.doc?.text_boxes.find((b) => b.id === row.boxId) : undefined));
  const maskTab = tool === "brush" || tool === "eraser";
  // Áp kiểu cả chương ghi thẳng các trang khác (không hoàn tác được) → hỏi lại 1 bước, gắn với khối đang chọn.
  const [confirmKind, setConfirmKind] = useState<string | null>(null);
  if (!page) return <p className="muted small ed-pad cw-pad">Chưa có trang để sửa.</p>;

  const setTab = (mask: boolean) => {
    const s = editorStore.getState();
    if (mask && !maskTab) s.setTool("brush");
    else if (!mask && maskTab) s.setTool("select");
  };
  const lv = PAGE_LEVEL[pageLevel(page.status)];
  const retranslate = (
    <button
      type="button"
      disabled={readOnly || props.busy.retranslate}
      title="Dịch lại riêng trang này bằng AI (chỉnh sửa tay được giữ, bản AI mới hiện để chọn áp)"
      onClick={props.onRetranslatePage}
    >
      Dịch lại trang này
    </button>
  );
  const warn = box ? overflowText(box, props.kit) : null;

  return (
    <>
      <div role="tablist" aria-label="Bảng thuộc tính" className="cw-tabs cw-side-tabs">
        <button type="button" role="tab" aria-selected={!maskTab} onClick={() => setTab(false)}>
          Khối chữ
        </button>
        <button type="button" role="tab" aria-selected={maskTab} onClick={() => setTab(true)}>
          Xoá chữ
        </button>
      </div>
      <div className="cw-side-head">
        <h2>Trang {page.ord + 1}</h2>
        <span className="muted small">
          {row ? `Khối ${row.index} · ${KIND_LABEL[row.kind]}` : "Chưa chọn khối chữ"}
        </span>
      </div>
      {maskTab ? (
        <MaskPanel
          ws={props.ws}
          pageId={page.id}
          cleanRev={page.clean_rev}
          page={{ w: page.width, h: page.height }}
          onDone={props.onMaskDone}
        />
      ) : (
        <>
          <AiUpdatePanel ws={props.ws} />
          <ConflictList />
          {row ? (
            <section className="cw-block">
              <div className="cw-field">
                <div className="cw-field-head">
                  <span>Gốc (OCR)</span>
                  {row.regionId && (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={readOnly || props.busy.ocr}
                      title="Nhận dạng + dịch lại vùng này (thay chữ gốc và bản dịch)"
                      onClick={() => props.onReocr(row)}
                    >
                      {props.busy.ocr ? "Đang OCR…" : "OCR lại"}
                    </button>
                  )}
                </div>
                <div className="cw-src-box">{row.source || <span className="muted">—</span>}</div>
              </div>
              <div className="cw-field">
                <div className="cw-field-head">
                  <label htmlFor="cw-translation">Bản dịch</label>
                </div>
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
                <p className="notice warn" role="status">
                  {warn}
                </p>
              )}
              <div className="row">{retranslate}</div>
            </section>
          ) : (
            <section className="cw-block">
              <dl className="cw-page-info">
                <dt>Trạng thái</dt>
                <dd>
                  <span className="status" data-tone={lv.tone}>
                    {lv.label}
                  </span>
                </dd>
                {page.ai_update_available && (
                  <>
                    <dt>AI</dt>
                    <dd>Có bản mới — xem bảng "AI có bản mới"</dd>
                  </>
                )}
                {props.overflowCount > 0 && (
                  <>
                    <dt>Tràn khung</dt>
                    <dd>{props.overflowCount} khối</dd>
                  </>
                )}
                {page.cut_flag && (
                  <>
                    <dt>Cắt trang</dt>
                    <dd>Cắt ở trần chiều cao (không theo khoảng trắng)</dd>
                  </>
                )}
                {page.job?.error && (
                  <>
                    <dt>Lỗi</dt>
                    <dd className="danger">
                      {page.job.error_class ? `${page.job.error_class}: ` : ""}
                      {page.job.error}
                    </dd>
                  </>
                )}
              </dl>
              <p className="muted small">Chọn một khối trên canvas hoặc trong bảng văn bản để sửa.</p>
              <div className="row">{retranslate}</div>
            </section>
          )}
          {row && (
            <section>
              <h3 className="ed-h">Kiểu chữ</h3>
              {box ? (
                <>
                  <Properties fonts={props.kit?.ids ?? []} />
                  <div className="ed-pad cw-field">
                    {confirmKind === row.key ? (
                      <>
                        <p className="notice" role="status">
                          Áp font, cỡ, căn lề, màu, viền của khối này cho mọi khối {KIND_LABEL[row.kind].toLowerCase()}{" "}
                          trong chương? Trang khác ghi ngay, không hoàn tác được.
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
                      </>
                    ) : (
                      <button
                        type="button"
                        className="cw-wide"
                        disabled={readOnly || props.busy.applyKind}
                        onClick={() => setConfirmKind(row.key)}
                      >
                        {props.busy.applyKind
                          ? "Đang áp kiểu…"
                          : `Áp kiểu này cho khối ${KIND_LABEL[row.kind].toLowerCase()} trong chương`}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="muted small ed-pad">Vùng này chưa có khung chữ — dùng công cụ Chữ (T) để thêm.</p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
