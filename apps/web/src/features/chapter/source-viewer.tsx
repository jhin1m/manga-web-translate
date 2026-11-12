/**
 * Canvas khi chương chưa có page: 1 ảnh gốc, vừa bề ngang khung (không phóng quá cỡ thật), ảnh cao cuộn dọc như đọc
 * webtoon. File chưa tải lên (URL ký 404) → ô "Chưa tải", thử lại mỗi khi upload xong thêm file.
 *
 * Ảnh đã cắt mép: dải bị cắt phủ mờ + chú thích. Chế độ cắt (`trimming`, mở từ menu thumbnail): kéo 2 thanh mép
 * trên / dưới, thanh dưới canvas thay pager bằng số px + Huỷ / Xong; Enter = Xong, Esc = Huỷ trên màn (trừ khi
 * focus đang ở ô nhập / menu / hộp thoại: các phần tử đó tự xử lý phím).
 */
import { useEffect, useRef, useState } from "react";
import { useChapterUpload } from "../upload/upload-manager.ts";
import { clampTrim, SKIP_LABEL, type SourceItem } from "./source-rail-model.ts";
import { SourceTrimOverlay, type TrimEdge } from "./source-trim-overlay.tsx";

/** Phần tử tự xử lý Enter / Esc: ô nhập, menu, hộp thoại / popover. Nút / liên kết chỉ giữ Enter (Esc vẫn huỷ). */
const OWN_KEYS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), form, [role="menu"], [role="menuitem"], [role="dialog"], [role="listbox"], [role="combobox"]';
const OWN_ENTER = `${OWN_KEYS}, button, a[href]`;

type Edges = { top: number; bottom: number };

export function SourceViewer(props: {
  chapterId: string;
  item: SourceItem | undefined;
  index: number;
  total: number;
  /** Đang ở chế độ cắt mép ảnh `item`. */
  trimming: boolean;
  onStep(dir: -1 | 1): void;
  /** Xong cắt: số px mép trên/dưới + chiều cao ảnh thật (px). */
  onTrimDone(edges: Edges, height: number): void;
  onTrimCancel(): void;
}) {
  const { item, index, total, trimming } = props;
  const retryKey = useChapterUpload(props.chapterId)?.done ?? 0;
  const [missing, setMissing] = useState(false);
  /** Chiều cao ảnh thật, đo khi ảnh tải xong; gắn với URL để ảnh khác không dùng nhầm số đo cũ. */
  const [measured, setMeasured] = useState<{ url: string; height: number } | null>(null);
  const natural = item && measured?.url === item.url ? measured.height : null;
  const [draft, setDraft] = useState<Edges | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Đổi ảnh / upload xong thêm file → thử tải lại.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey chỉ dùng để kích hoạt thử lại
  useEffect(() => setMissing(false), [item?.url, retryKey]);
  /** Đã bấm Xong: bản nháp ở lại hiển thị tới khi dữ liệu ảnh mang số mới (hoặc bị trả lại), không chớp số cũ. */
  const committed = useRef(false);
  // Đổi ảnh, hoặc vào chế độ cắt → bản nháp mới; rời chế độ cắt mà không bấm Xong (Huỷ / bị thoát) → bỏ nháp.
  // biome-ignore lint/correctness/useExhaustiveDependencies: các giá trị này chỉ dùng để kích hoạt đặt lại
  useEffect(() => {
    if (trimming || !committed.current) setDraft(null);
    if (trimming) committed.current = false;
  }, [trimming, item?.id]);
  // Dữ liệu ảnh đã nhận số cắt mới (hoặc được hoàn lại khi lỗi) → bỏ nháp đã chốt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi trim của ảnh đổi
  useEffect(() => {
    if (committed.current) {
      committed.current = false;
      setDraft(null);
    }
  }, [item?.trim]);

  const edges: Edges = draft ?? item?.trim ?? { top: 0, bottom: 0 };
  const ready = natural !== null && !missing;
  const isLast = index >= 0 && index === total - 1;
  // Vào chế độ cắt ở ảnh cuối: cuộn sẵn xuống đáy, nơi thường là banner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi vào chế độ cắt / ảnh vừa tải xong
  useEffect(() => {
    if (trimming && natural !== null && isLast && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [trimming, natural]);

  const change = (edge: TrimEdge, value: number) => {
    if (natural === null) return;
    setDraft(
      edge === "top" ? clampTrim(value, edges.bottom, natural, "top") : clampTrim(edges.top, value, natural, "bottom"),
    );
  };
  const done = () => {
    if (natural === null) return;
    committed.current = true;
    props.onTrimDone(edges, natural);
  };
  const latest = useRef({ done, cancel: props.onTrimCancel });
  latest.current = { done, cancel: props.onTrimCancel };
  useEffect(() => {
    if (!trimming) return;
    // Pha nổi bọt trên document: menu / popover / ô nhập xử lý phím trước (việc của chúng không bị coi là Xong / Huỷ),
    // còn phím tắt cấp cửa sổ của màn chương chạy sau nên không giành mất Enter / Esc.
    const on = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(e.key === "Enter" ? OWN_ENTER : OWN_KEYS)) return;
      if (e.key === "Escape") latest.current.cancel();
      else if (e.key === "Enter") latest.current.done();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [trimming]);

  return (
    <div className="cw-canvas">
      {/* key: đổi ảnh → khung cuộn mới, về đầu ảnh (ảnh webtoon cao). */}
      <div className="cw-source-view" key={item?.id} ref={scroller}>
        {!item ? (
          <p className="muted">Chưa có ảnh.</p>
        ) : missing ? (
          <div className="source-missing small muted">Chưa tải</div>
        ) : (
          <figure data-skipped={item.skip ? "" : undefined}>
            <div className="cw-source-frame" ref={frame}>
              <img
                src={item.url}
                alt={`Ảnh gốc ${item.n}`}
                onLoad={(e) => {
                  const height = e.currentTarget.naturalHeight;
                  if (height > 0) setMeasured({ url: item.url, height });
                }}
                onError={() => setMissing(true)}
              />
              {natural !== null && (
                <SourceTrimOverlay
                  height={natural}
                  top={edges.top}
                  bottom={edges.bottom}
                  editing={trimming}
                  frame={frame}
                  onChange={change}
                />
              )}
            </div>
            {item.skip && (
              <figcaption className="small">{SKIP_LABEL[item.skip]} — bỏ qua ảnh này khi cắt trang</figcaption>
            )}
            {!item.skip && !trimming && item.trim && (
              <figcaption className="small">Phần mờ bị bỏ khi cắt trang</figcaption>
            )}
          </figure>
        )}
      </div>
      <div className="cw-canvas-foot">
        {trimming ? (
          <span className="cw-pager cw-trim-bar">
            <span aria-live="polite">
              Trên {edges.top} px · Dưới {edges.bottom} px
            </span>
            <button type="button" className="btn btn-ghost" onClick={props.onTrimCancel} title="Huỷ (Esc)">
              Huỷ
            </button>
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={done} title="Xong (Enter)">
              Xong
            </button>
          </span>
        ) : (
          <span className="cw-pager">
            <button
              type="button"
              disabled={index <= 0}
              onClick={() => props.onStep(-1)}
              aria-label="Ảnh trước"
              title="Ảnh trước (←)"
            >
              ‹
            </button>
            <span>
              Ảnh {index >= 0 ? index + 1 : "–"}/{total || "–"}
            </span>
            <button
              type="button"
              disabled={index < 0 || index >= total - 1}
              onClick={() => props.onStep(1)}
              aria-label="Ảnh sau"
              title="Ảnh sau (→)"
            >
              ›
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
