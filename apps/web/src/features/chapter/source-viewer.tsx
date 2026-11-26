/**
 * Canvas khi chương chưa có page: 1 ảnh gốc, vừa bề ngang khung (không phóng quá cỡ thật), ảnh cao cuộn dọc như đọc
 * webtoon. File chưa tải lên (URL ký 404) → ô "Chưa tải", thử lại mỗi khi upload xong thêm file.
 *
 * Zoom: cụm − / % / + cạnh pager (% đổi Vừa khung ↔ 100% như editor), Ctrl/⌘+cuộn và chụm trackpad (wheel kèm ctrlKey)
 * zoom quanh con trỏ, cuộn thường = cuộn ảnh. Mức zoom giữ khi đổi ảnh (như editor giữ khi đổi trang); ảnh mới rộng
 * hơn khung thì cuộn ngang căn giữa. Thanh cắt đặt theo % chiều cao ảnh nên đúng px ảnh thật ở mọi mức zoom.
 *
 * Cuộn quá mép dưới / trên = sang ảnh sau / trước (`editor/wheel-page-flip.ts`, cùng ngưỡng + khoá quán tính với
 * editor), qua `onStep` như pager; cuộn lên vào cuối ảnh trước. Tắt khi đang cắt mép (kéo thanh dưới sát đáy không lỡ
 * tay đổi ảnh rồi tự lưu).
 *
 * Ảnh đã cắt mép: dải bị cắt phủ mờ + chú thích. Chế độ cắt (`trimming`, panel Cắt mép đang mở): kéo 2 thanh mép
 * trên / dưới (số nằm ở panel, hai bên đồng bộ qua `edges`); Enter = Lưu, Esc = Huỷ trên màn (trừ khi focus đang ở ô
 * nhập / menu / hộp thoại: các phần tử đó tự xử lý phím).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n/t.ts";
import { type FlipState, initialFlip, stepFlip } from "../editor/wheel-page-flip.ts";
import { useChapterUpload } from "../upload/upload-manager.ts";
import { ZoomControls } from "./canvas-controls.tsx";
import { SKIP_LABEL, type SourceItem } from "./source-rail-model.ts";
import type { TrimEdges } from "./source-trim-model.ts";
import { SourceTrimOverlay } from "./source-trim-overlay.tsx";
import { anchorShift, clampZoom, fitScale, MAX_ZOOM, MIN_ZOOM, stepZoom, wheelZoom } from "./source-zoom.ts";
import type { NaturalSize } from "./use-source-trim.ts";

/** Phần tử tự xử lý Enter / Esc: ô nhập, menu, hộp thoại / popover. Nút / liên kết chỉ giữ Enter (Esc vẫn huỷ). */
const OWN_KEYS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), form, [role="menu"], [role="menuitem"], [role="dialog"], [role="listbox"], [role="combobox"]';
const OWN_ENTER = `${OWN_KEYS}, button, a[href]`;

/** Điểm ảnh (px ảnh thật) phải giữ dưới con trỏ `client` khi đổi cỡ. */
type Anchor = { nx: number; ny: number; cx: number; cy: number };

export function SourceViewer(props: {
  chapterId: string;
  item: SourceItem | undefined;
  index: number;
  total: number;
  /** Đang ở chế độ cắt mép ảnh `item`. */
  trimming: boolean;
  /** Số px cắt đang hiển thị (nháp khi đang cắt, không thì số đã lưu). */
  edges: TrimEdges;
  /** Cỡ ảnh thật, null = ảnh chưa tải xong. */
  natural: NaturalSize | null;
  onMeasure(url: string, size: NaturalSize): void;
  onEdgeChange(edge: "top" | "bottom", value: number): void;
  onStep(dir: -1 | 1): void;
  onTrimSave(): void;
  onTrimCancel(): void;
}) {
  const { t } = useT();
  const { item, index, total, trimming, natural, edges } = props;
  const retryKey = useChapterUpload(props.chapterId)?.done ?? 0;
  const [missing, setMissing] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // Đổi ảnh / upload xong thêm file → thử tải lại.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey chỉ dùng để kích hoạt thử lại
  useEffect(() => setMissing(false), [item?.url, retryKey]);

  // ---- Zoom ----
  /** Scale tuyệt đối đã chọn (null = Vừa khung); giữ qua đổi ảnh. */
  const [zoom, setZoom] = useState<number | null>(null);
  /** Bề ngang vùng chứa ảnh (khung cuộn trừ padding), để tính cỡ "Vừa khung". */
  const [avail, setAvail] = useState(0);
  const fit = natural ? fitScale(natural.width, avail) : 1;
  const scale = zoom ?? fit;
  const percent = Math.round(scale * 100);
  /** Ảnh đã đo xong mới đặt cỡ zoom; trước đó (vừa đổi ảnh, chưa tải) ảnh chưa hiện gì. */
  const sized = zoom !== null && natural !== null;
  const anchor = useRef<Anchor | null>(null);
  const { onStep } = props;
  const live = useRef({ item, natural, scale, fit, index, total, trimming, onStep });
  live.current = { item, natural, scale, fit, index, total, trimming, onStep };
  /** Scale mới nhất đã yêu cầu nhưng React chưa vẽ (nhiều wheel đến liên tiếp). */
  const wanted = useRef<number | null>(null);
  /** Trạng thái cuộn quá mép; sống qua đổi ảnh để khoá quán tính nuốt cả wheel rơi vào khung cuộn mới. */
  const flip = useRef<FlipState>(initialFlip);
  // biome-ignore lint/correctness/useExhaustiveDependencies: xoá scale đang chờ khi React đã vẽ xong
  useEffect(() => {
    wanted.current = null;
  }, [zoom]);

  /** Đặt zoom, giữ điểm ảnh dưới (clientX, clientY) đứng yên. */
  const zoomTo = (next: number, clientX: number, clientY: number) => {
    const cur = live.current;
    const img = frame.current?.querySelector("img");
    if (!cur.item || !cur.natural || !img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // Quy đổi theo cỡ đang vẽ thật (không theo state): wheel đến dồn trước khi React vẽ lại vẫn đúng.
    anchor.current = {
      nx: ((clientX - rect.left) / rect.width) * cur.natural.width,
      ny: ((clientY - rect.top) / rect.height) * cur.natural.height,
      cx: clientX,
      cy: clientY,
    };
    wanted.current = clampZoom(next);
    setZoom(wanted.current);
  };
  const centre = () => {
    const box = scroller.current?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: 0, y: 0 };
  };
  const zoomStep = (dir: -1 | 1) => {
    const c = centre();
    zoomTo(stepZoom(wanted.current ?? live.current.scale, dir), c.x, c.y);
  };
  const zoomToggle = () => {
    const c = centre();
    if (zoom !== null && percent === 100) setZoom(null);
    else zoomTo(1, c.x, c.y);
  };

  // ---- Vị trí cuộn khi vào ảnh mới ----
  /** Lần đổi ảnh sắp tới đến từ cuộn lên quá mép trên → vào ở cuối ảnh. */
  const enterFromBottom = useRef(false);
  /** Ảnh vừa vào, chờ tải + đo xong để đặt vị trí cuộn ban đầu. */
  const entry = useRef<{ id: string; fromBottom: boolean } | null>(null);
  // Khung cuộn mới (key = id ảnh) mở ở đầu ảnh; chỉ cần đặt thêm khi vào từ đáy hoặc ảnh đang zoom rộng hơn khung.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi đổi ảnh
  useLayoutEffect(() => {
    entry.current = item ? { id: item.id, fromBottom: enterFromBottom.current } : null;
    enterFromBottom.current = false;
  }, [item?.id]);
  // Ảnh đã đo xong (đã vẽ đúng cỡ zoom): căn giữa ngang, vào từ đáy thì cuộn xuống cuối.
  useLayoutEffect(() => {
    const e = entry.current;
    const box = scroller.current;
    const img = frame.current?.querySelector("img");
    // Chờ <img> có cỡ thật (ảnh chưa tải dù `natural` đã biết): lần đo sau `onLoad` gọi lại effect này.
    if (!e || e.id !== item?.id || !box || natural === null || !img?.complete || img.naturalHeight === 0) return;
    entry.current = null;
    if (box.scrollWidth > box.clientWidth) box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
    if (e.fromBottom) box.scrollTop = box.scrollHeight;
  }, [item?.id, natural]);

  // Sau khi cỡ ảnh đổi: kéo cuộn để điểm neo về lại dưới con trỏ.
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const box = scroller.current;
    const img = frame.current?.querySelector("img");
    const nat = live.current.natural;
    if (!a || !box || !img || !nat || zoom === null) return;
    const rect = img.getBoundingClientRect();
    box.scrollLeft += anchorShift(rect.left, a.nx, zoom, a.cx);
    box.scrollTop += anchorShift(rect.top, a.ny, zoom, a.cy);
  }, [zoom]);

  // Đo bề ngang khung cuộn (mỗi ảnh một khung mới).
  // biome-ignore lint/correctness/useExhaustiveDependencies: gắn lại khi khung cuộn mới (đổi ảnh)
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measureBox = () => {
      const cs = getComputedStyle(box);
      setAvail(box.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight));
    };
    measureBox();
    const ro = new ResizeObserver(measureBox);
    ro.observe(box);
    return () => ro.disconnect();
  }, [item?.id]);

  // Wheel / chụm: listener không-passive (chặn zoom của trình duyệt, nuốt quán tính sau khi đổi ảnh) gắn MỘT lần lên
  // `.cw-canvas` (không bị key), đọc khung cuộn hiện tại lúc có sự kiện. Gắn theo khung cuộn thì giữa lúc khung mới vào
  // DOM và lúc effect gắn lại có khe hở: wheel quán tính lọt qua, cuộn lệch ảnh vừa vào.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ đọc ref / live.current, các hàm dùng đều ổn định
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    /** Khung cuộn đang hiện, nếu sự kiện rơi vào nó (không tính cụm pager / zoom bên dưới). */
    const target = (e: Event) => {
      const box = scroller.current;
      return box && e.target instanceof Node && box.contains(e.target) ? box : null;
    };
    const onWheel = (e: WheelEvent) => {
      const box = target(e);
      if (!box) return;
      const cur = live.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (cur.natural) zoomTo(wheelZoom(wanted.current ?? cur.scale, e.deltaY), e.clientX, e.clientY);
        return;
      }
      if (cur.trimming) return;
      const r = stepFlip(flip.current, {
        t: e.timeStamp,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        modified: e.shiftKey,
        // Ảnh nằm trọn khung (hoặc ô "Chưa tải") không cuộn được = ở cả hai mép.
        atTop: box.scrollTop <= 0,
        atBottom: box.scrollTop + box.clientHeight >= box.scrollHeight - 1,
        hasPrev: cur.index > 0,
        hasNext: cur.index >= 0 && cur.index < cur.total - 1,
        busy: e.buttons !== 0,
        frameH: box.clientHeight,
      });
      flip.current = r.state;
      // Quán tính của lần đổi: nuốt, để ảnh mới vào đúng đầu / cuối.
      if (r.locked) e.preventDefault();
      if (r.flip) {
        enterFromBottom.current = r.flip < 0;
        cur.onStep(r.flip);
      }
    };
    // Safari: chụm trackpad bắn gesture* (không phải wheel + ctrl) và zoom cả trang nếu không chặn.
    let pinchBase = 1;
    const onGestureStart = (e: Event) => {
      if (!target(e)) return;
      e.preventDefault();
      pinchBase = wanted.current ?? live.current.scale;
    };
    const onGestureChange = (e: Event) => {
      if (!target(e)) return;
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      if (live.current.natural) zoomTo(pinchBase * g.scale, g.clientX, g.clientY);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("gesturestart", onGestureStart);
    root.addEventListener("gesturechange", onGestureChange);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("gesturestart", onGestureStart);
      root.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const ready = natural !== null && !missing;
  /** Vừa mở chế độ cắt: thanh trên nhận focus một lần; đổi ảnh khi panel đang mở không giành focus của rail. */
  const focusHandle = useRef(false);
  useLayoutEffect(() => {
    focusHandle.current = trimming;
  }, [trimming]);
  const isLast = index >= 0 && index === total - 1;
  // Vào chế độ cắt ở ảnh cuối: cuộn sẵn xuống đáy, nơi thường là banner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi vào chế độ cắt / ảnh vừa tải xong
  useEffect(() => {
    if (trimming && natural !== null && isLast && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [trimming, natural !== null]);

  const latest = useRef({ save: props.onTrimSave, cancel: props.onTrimCancel, ready });
  latest.current = { save: props.onTrimSave, cancel: props.onTrimCancel, ready };
  useEffect(() => {
    if (!trimming) return;
    // Pha nổi bọt trên document: menu / popover / ô nhập xử lý phím trước (việc của chúng không bị coi là Lưu / Huỷ),
    // còn phím tắt cấp cửa sổ của màn chương chạy sau nên không giành mất Enter / Esc.
    const on = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(e.key === "Enter" ? OWN_ENTER : OWN_KEYS)) return;
      if (e.key === "Escape") latest.current.cancel();
      else if (e.key === "Enter") {
        if (latest.current.ready) latest.current.save();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [trimming]);

  return (
    <div className="cw-canvas" ref={canvas}>
      {/* key: đổi ảnh → khung cuộn mới, về đầu ảnh (ảnh webtoon cao). */}
      <div className="cw-source-view" key={item?.id} ref={scroller} data-zoomed={sized || undefined}>
        {!item ? (
          <p className="muted">{t("chapter.sourceViewer.noImage")}</p>
        ) : missing ? (
          <div className="source-missing small muted">{t("chapter.sourceViewer.notUploaded")}</div>
        ) : (
          <figure data-skipped={item.skip ? "" : undefined}>
            <div className="cw-source-frame" ref={frame}>
              <img
                src={item.url}
                alt={t("chapter.sourceViewer.alt", { n: item.n })}
                // Đang zoom mà ảnh mới chưa đo: ẩn tới khi biết cỡ, không nháy ở cỡ vừa khung rồi mới nhảy.
                style={zoom === null ? undefined : natural ? { width: natural.width * zoom } : { visibility: "hidden" }}
                onLoad={(e) => {
                  const height = e.currentTarget.naturalHeight;
                  const width = e.currentTarget.naturalWidth;
                  if (height > 0 && width > 0) props.onMeasure(item.url, { width, height });
                }}
                onError={() => setMissing(true)}
              />
              {natural !== null && (
                <SourceTrimOverlay
                  height={natural.height}
                  top={edges.top}
                  bottom={edges.bottom}
                  editing={trimming}
                  frame={frame}
                  focusOnMount={focusHandle}
                  onChange={props.onEdgeChange}
                />
              )}
            </div>
            {item.skip && (
              <figcaption className="small">
                {t("chapter.sourceViewer.skippedCaption", { reason: SKIP_LABEL[item.skip] })}
              </figcaption>
            )}
            {!item.skip && !trimming && item.trim && (
              <figcaption className="small">{t("chapter.sourceViewer.trimCaption")}</figcaption>
            )}
          </figure>
        )}
      </div>
      <div className="cw-canvas-foot">
        <span className="cw-pager">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => props.onStep(-1)}
            aria-label={t("chapter.sourceViewer.prev")}
            title={t("chapter.sourceViewer.prevTitle")}
          >
            ‹
          </button>
          <span>{t("chapter.sourceViewer.position", { n: index >= 0 ? index + 1 : "–", total: total || "–" })}</span>
          <button
            type="button"
            disabled={index < 0 || index >= total - 1}
            onClick={() => props.onStep(1)}
            aria-label={t("chapter.sourceViewer.next")}
            title={t("chapter.sourceViewer.nextTitle")}
          >
            ›
          </button>
          {ready && (
            <ZoomControls
              percent={percent}
              zoomed={zoom !== null}
              canOut={scale > MIN_ZOOM + 1e-6}
              canIn={scale < MAX_ZOOM - 1e-6}
              onOut={() => zoomStep(-1)}
              onIn={() => zoomStep(1)}
              onToggle={zoomToggle}
            />
          )}
        </span>
      </div>
    </div>
  );
}
