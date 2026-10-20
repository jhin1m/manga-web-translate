/**
 * Bảng văn bản cả chương (tab "Bản dịch" ở bảng dưới): 1 dòng / khối, sửa bản dịch tại chỗ, song song canvas.
 * Virtualize (`@tanstack/react-virtual`) — dòng đang focus luôn được render để textarea không mất focus khi cuộn.
 *
 * Đồng bộ 2 chiều: focus/click dòng → `onPick` (kích hoạt page, chọn box, cuộn canvas); dòng `current` đổi từ
 * ngoài (chọn box trên canvas, nhảy từ Tìm/Thay) → bảng cuộn tới dòng đó. Dòng của page chưa active chỉ đọc tới
 * khi kích hoạt xong. Phím trong ô Dịch: Enter → dòng sau (xuyên trang), Shift+Enter → dòng trước, Alt+Enter →
 * xuống dòng trong ô, Esc → bỏ focus.
 */
import type { PageState, TextBox } from "@mtl/shared";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { editText, setRegionTranslation } from "../../editor/actions.ts";
import { useChapterStore } from "../../editor/chapter-store.ts";
import type { FontKit } from "../../editor/fonts.ts";
import { boxOverflows } from "../../editor/measure.ts";
import { TextField } from "../../editor/panels/TextField.tsx";
import { editorStore, useEditor } from "../../editor/store.ts";
import { buildRows, FLAG_LABEL, KIND_LABEL, type Row, type TableFilter } from "./rows.ts";

const ROW_H = 40;

/** Dòng của cả chương: page active đọc `editorStore.doc`, page khác đọc cache; nhớ theo object state. */
export function useChapterRows(kit: FontKit | null): Row[] {
  const pages = useChapterStore((s) => s.pages);
  const cache = useChapterStore((s) => s.cache);
  const pageId = useEditor((s) => s.pageId);
  const doc = useEditor((s) => s.doc);
  const overflowOf = useMemo(
    () => (kit ? (b: TextBox) => boxOverflows(b, kit.metrics(b.font_family), kit.measure) : () => false),
    [kit],
  );
  // Nhớ dòng theo object state; font đổi (kit nạp xong) → đo lại tràn khung từ đầu.
  const memo = useRef({ of: overflowOf, rows: new WeakMap<PageState, { ord: number; ai: boolean; rows: Row[] }>() });
  if (memo.current.of !== overflowOf) memo.current = { of: overflowOf, rows: new WeakMap() };
  const rowsMemo = memo.current.rows;
  return useMemo(
    () => buildRows(pages, cache, { pageId, doc }, overflowOf, rowsMemo),
    [pages, cache, pageId, doc, overflowOf, rowsMemo],
  );
}

/** Sửa bản dịch của 1 khối (bảng hoặc inspector) trên page đang sửa; gõ liên tục = 1 bước undo. */
export function setRowTranslation(row: Pick<Row, "pageId" | "regionId" | "boxId">, text: string) {
  const s = editorStore.getState();
  if (s.pageId !== row.pageId || !s.layout) return;
  if (row.regionId) s.apply(setRegionTranslation(row.regionId, text, s.layout), `region:${row.regionId}`);
  else if (row.boxId) s.apply(editText(row.boxId, text, s.layout), `text:${row.boxId}`);
}

export function TableFilters(props: { value: TableFilter; onChange(f: TableFilter): void }) {
  const { value, onChange } = props;
  return (
    <>
      <label className="cw-check">
        <input
          type="checkbox"
          checked={value.review}
          onChange={(e) => onChange({ ...value, review: e.target.checked })}
        />
        Chỉ khối cần xem
      </label>
      <label className="cw-check">
        <input type="checkbox" checked={value.page} onChange={(e) => onChange({ ...value, page: e.target.checked })} />
        Chỉ trang đang sửa
      </label>
      <span className="muted small">Enter: dòng sau · click dòng = chọn trên canvas</span>
    </>
  );
}

function statusOf(r: Row): { text: string; tone: "ok" | "warn" | "busy" | "idle" } {
  const flags = r.flags.filter((f) => f !== "sfx");
  if (flags.length === 0) return { text: "Xong", tone: "ok" };
  const tone = flags.includes("ai_update") && flags.length === 1 ? "busy" : "warn";
  return { text: flags.map((f) => FLAG_LABEL[f]).join(" · "), tone };
}

export function TextTable(props: {
  rows: Row[];
  /** Tổng số dòng trước khi lọc (để báo "không có khối cần xem"). */
  total: number;
  current: string | null;
  activeId: string | null;
  onPick(row: Row): void;
}) {
  const { rows, current, activeId, onPick } = props;
  const readOnly = useEditor((s) => !!s.readOnly);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedKey = useRef<string | null>(null);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
    getItemKey: (i) => rows[i]?.key ?? i,
    // Dòng đang focus luôn render (cuộn xa bằng chuột không unmount textarea đang gõ).
    rangeExtractor: (range) => {
      const out = defaultRangeExtractor(range);
      const f = focusedKey.current ? indexOf.get(focusedKey.current) : undefined;
      if (f !== undefined && !out.includes(f)) {
        out.push(f);
        out.sort((a, b) => a - b);
      }
      return out;
    },
  });

  // Dòng hiện tại đổi từ ngoài bảng (canvas, Tìm/Thay) → cuộn bảng tới dòng đó.
  useEffect(() => {
    if (!current || current === focusedKey.current) return;
    const i = indexOf.get(current);
    if (i !== undefined) virt.scrollToIndex(i, { align: "auto" });
  }, [current, indexOf, virt]);

  /** Focus ô Dịch của dòng `i` (cuộn tới, đợi dòng được render). */
  const focusRow = (i: number) => {
    const row = rows[i];
    if (!row) return;
    virt.scrollToIndex(i, { align: "auto" });
    let tries = 0;
    const tick = () => {
      const el = scrollRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-key="${CSS.escape(row.key)}"]`);
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      } else if (tries++ < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    // Safari kết thúc bộ gõ (Telex/IME) bằng Enter với isComposing=false nhưng keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      // insertText giữ undo của textarea và phát sự kiện input như gõ thường.
      document.execCommand("insertText", false, "\n");
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      focusRow(i + (e.shiftKey ? -1 : 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  if (props.total === 0) return <p className="muted small cw-pad">Chương chưa có khối chữ nào.</p>;

  return (
    <div className="cw-table">
      <div className="cw-tr cw-th" aria-hidden="true">
        <span>#</span>
        <span>Tr.</span>
        <span>Gốc</span>
        <span>Dịch (sửa tại chỗ)</span>
        <span>Loại</span>
        <span>Tình trạng</span>
      </div>
      <div className="cw-tbody" ref={scrollRef}>
        {rows.length === 0 && <p className="muted small cw-pad">Không có khối nào cần xem.</p>}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const r = rows[v.index] as Row;
            const st = statusOf(r);
            const cls = ["cw-tr", r.key === current && "on", r.pageId === activeId && "active"].filter(Boolean);
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: bàn phím đi qua ô Dịch (focus = chọn dòng).
              // biome-ignore lint/a11y/noStaticElementInteractions: dòng bảng ảo (div), click chỉ là lối tắt chuột.
              <div
                key={v.key}
                data-row={r.key}
                className={cls.join(" ")}
                style={{ transform: `translateY(${v.start}px)`, height: ROW_H }}
                onClick={(e) => {
                  if (!(e.target instanceof HTMLTextAreaElement)) onPick(r);
                }}
              >
                <span className="num">{v.index + 1}</span>
                <span className="num">{r.ord + 1}</span>
                <span className="cw-src" title={r.source || undefined}>
                  {r.source || <span className="muted">—</span>}
                </span>
                <span>
                  <TextField
                    data-key={r.key}
                    aria-label={`Bản dịch trang ${r.ord + 1} vùng ${r.index}`}
                    rows={1}
                    value={r.translation}
                    readOnly={readOnly || r.pageId !== activeId}
                    onValue={(text) => setRowTranslation(r, text)}
                    onFocus={() => {
                      focusedKey.current = r.key;
                      onPick(r);
                    }}
                    onBlur={() => {
                      if (focusedKey.current === r.key) focusedKey.current = null;
                    }}
                    onKeyDown={(e) => onKey(e, v.index)}
                  />
                </span>
                <span className="muted small">{KIND_LABEL[r.kind]}</span>
                <span>
                  <span className="status" data-tone={st.tone}>
                    {st.text}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
