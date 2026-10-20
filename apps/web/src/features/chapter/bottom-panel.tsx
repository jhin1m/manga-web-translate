/**
 * Bảng dưới màn chương: tab Bản dịch (bảng văn bản cả chương) / Tìm–Thay / Áp glossary; kéo cao, thu gọn, nhớ
 * trong localStorage `mtl.layout` (< 1600px mặc định thu gọn). Tab đã mở giữ nguyên nội dung khi đổi tab/thu gọn
 * (không mất kết quả xem trước); tab chưa mở lần nào thì chưa mount. `request` mở tab từ ngoài (Ctrl/Cmd+F → Tìm /
 * Thay + focus ô tìm; "Xem các khối này" của drawer Xuất → Bản dịch).
 */
import { type ReactNode, useEffect, useRef, useState } from "react";

type LayoutPrefs = { bottomOpen: boolean; bottomH: number };
const LAYOUT_KEY = "mtl.layout";
const MIN_H = 120;

function readLayout(): LayoutPrefs {
  const fallback = { bottomOpen: typeof innerWidth === "number" && innerWidth >= 1600, bottomH: 280 };
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      bottomOpen: typeof v.bottomOpen === "boolean" ? v.bottomOpen : fallback.bottomOpen,
      bottomH: typeof v.bottomH === "number" && v.bottomH >= MIN_H ? v.bottomH : fallback.bottomH,
    };
  } catch {
    return fallback;
  }
}

export type BottomTab = {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  render(): ReactNode;
  /** Điều khiển phụ của tab trên thanh tab (VD bộ lọc bảng). */
  tools?: ReactNode;
  /** Nội dung tự cuộn (bảng ảo) — khung không padding, không cuộn. */
  flush?: boolean;
};

/** Mở 1 tab từ ngoài (phím tắt, drawer Xuất); `seq` đổi = yêu cầu mới; `focus` = selector cần focus trong panel. */
export type TabRequest = { tab: string; seq: number; focus?: string };

export function BottomPanel({ tabs, request }: { tabs: BottomTab[]; request?: TabRequest | null }) {
  const [prefs, setPrefs] = useState(readLayout);
  const [tab, setTab] = useState(tabs[0]?.id ?? "");
  const [seen, setSeen] = useState<Set<string>>(() => new Set([tab]));
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs));
    } catch {
      // Không lưu được (chế độ riêng tư) → chỉ mất ghi nhớ bố cục.
    }
  }, [prefs]);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const current = tabs.find((t) => t.id === tab && !t.disabled) ?? tabs[0];
  const pick = (id: string) => {
    setTab(id);
    setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
    setPrefs((p) => (p.bottomOpen ? p : { ...p, bottomOpen: true }));
  };

  const pickRef = useRef(pick);
  pickRef.current = pick;
  const pendingFocus = useRef<TabRequest | null>(null);
  useEffect(() => {
    if (!request) return;
    pendingFocus.current = request.focus ? request : null;
    pickRef.current(request.tab);
  }, [request]);
  // Sau khi panel đã hiện (tab vừa mount lần đầu cũng vậy) → focus phần tử được yêu cầu.
  useEffect(() => {
    const r = pendingFocus.current;
    if (!r?.focus || !prefs.bottomOpen || current?.id !== r.tab) return;
    const el = document.getElementById(`cw-panel-${r.tab}`)?.querySelector<HTMLElement>(r.focus);
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  });

  return (
    <section
      className="cw-bottom"
      aria-label="Bảng văn bản chương"
      style={{ height: prefs.bottomOpen ? prefs.bottomH : undefined }}
    >
      {prefs.bottomOpen && (
        <button
          type="button"
          className="cw-resize"
          aria-label="Kéo để đổi chiều cao bảng"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, h: prefs.bottomH };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const max = Math.max(MIN_H, innerHeight - 260);
            setPrefs((p) => ({ ...p, bottomH: Math.min(max, Math.max(MIN_H, d.h + d.y - e.clientY)) }));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        />
      )}
      <div className="cw-bottom-head">
        <div role="tablist" aria-label="Bảng văn bản" className="cw-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`cw-tab-${t.id}`}
              aria-controls={`cw-panel-${t.id}`}
              aria-selected={prefs.bottomOpen && current?.id === t.id}
              disabled={t.disabled}
              title={t.title}
              onClick={() => pick(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {prefs.bottomOpen && current?.tools}
        <button
          type="button"
          className="btn-ghost"
          aria-expanded={prefs.bottomOpen}
          onClick={() => setPrefs((p) => ({ ...p, bottomOpen: !p.bottomOpen }))}
        >
          {prefs.bottomOpen ? "Thu gọn" : "Mở bảng"}
        </button>
      </div>
      {/* Thu gọn chỉ ẩn (giữ trạng thái Tìm/Thay đang xem trước). */}
      {tabs.map(
        (t) =>
          (seen.has(t.id) || t.id === current?.id) && (
            <div
              key={t.id}
              role="tabpanel"
              id={`cw-panel-${t.id}`}
              aria-labelledby={`cw-tab-${t.id}`}
              className={t.flush ? "cw-bottom-body flush" : "cw-bottom-body"}
              hidden={!prefs.bottomOpen || t.id !== current?.id}
            >
              {t.render()}
            </div>
          ),
      )}
    </section>
  );
}
