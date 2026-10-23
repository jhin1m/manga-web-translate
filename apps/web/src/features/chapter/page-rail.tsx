/**
 * Cột trang bên phải canvas (112px): thumbnail (ảnh sạch/ảnh gốc, tải lười) + số trang. Trạng thái = viền + nhãn ngắn
 * chỉ khi có vấn đề (Đã ẩn / Lỗi / Chờ AI / Cần xem — page-status.ts `thumbMark`); tên truy cập luôn đủ trạng thái.
 * Trang ẩn nằm đúng vị trí theo số trang (mờ). Nút "Cần xem k" lọc trang lỗi / AI có bản mới / tràn khung. Bấm = kích
 * hoạt page và cuộn canvas tới; ẩn / khôi phục trang qua menu chuột phải (Shift+F10 / phím Menu khi đang focus), bấm
 * trang ẩn cũng mở menu. Số trang giữ số gốc (ord + 1) — trang ẩn để lại lỗ số, khớp bảng văn bản và Tìm/Thay.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PageImage, ProgressPage } from "./api.ts";
import { ContextMenu, isMenuKey, type MenuAt, menuAtElement } from "./context-menu.tsx";
import { needsReview, thumbAria, thumbMark, thumbTitle } from "./page-status.ts";

const LOCK_HINT = "Cần giữ khoá chương (chương không đang chạy)";

/** memo: màn chương render lại mỗi lần gõ (bảng văn bản) — cột chỉ đổi khi page/ảnh/active/cờ đổi. */
export const PageRail = memo(function PageRail(props: {
  pages: ProgressPage[];
  /** Trang đã ẩn — hiện mờ đúng vị trí, khôi phục qua menu. */
  hidden: ProgressPage[];
  images: Map<string, PageImage>;
  activeId: string | null;
  /** Page có box chữ tràn khung (đo ở client). */
  overflow: Set<string>;
  /** Đang giữ khoá + chương không chạy → được ẩn / khôi phục trang. */
  editable: boolean;
  onPick(pageId: string): void;
  onSkip(page: ProgressPage, skipped: boolean): void;
}) {
  const [reviewOnly, setReviewOnly] = useState(false);
  const [menu, setMenu] = useState<{ page: ProgressPage; at: MenuAt; anchor: HTMLElement } | null>(null);
  const all = useMemo(
    () => [...props.pages, ...props.hidden].sort((a, b) => a.ord - b.ord),
    [props.pages, props.hidden],
  );
  const review = props.pages.filter((p) => needsReview(p, props.overflow.has(p.id)));
  // Hết trang cần xem → bỏ lọc (nút lọc biến mất).
  const filtering = reviewOnly && review.length > 0;
  const list = filtering ? review : all;
  const listRef = useRef<HTMLDivElement>(null);

  // Page active đổi (canvas, phím ←/→, ?page=) → đưa vào tầm nhìn của cột.
  useEffect(() => {
    if (!props.activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-page="${props.activeId}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [props.activeId]);

  const menuItems = (p: ProgressPage) => {
    const n = p.ord + 1;
    if (p.skipped)
      return [
        {
          label: `Khôi phục trang ${n}`,
          disabled: !props.editable,
          title: props.editable ? undefined : LOCK_HINT,
          run: () => props.onSkip(p, false),
        },
      ];
    // Trang cuối còn hiện không ẩn được (API 409 last_page).
    const reason = !props.editable ? LOCK_HINT : props.pages.length <= 1 ? "Không ẩn được trang cuối cùng" : undefined;
    return [
      {
        label: `Ẩn trang ${n}`,
        danger: true,
        disabled: !!reason,
        title: reason ?? "Không dịch, không xuất — khôi phục được",
        run: () => props.onSkip(p, true),
      },
    ];
  };

  return (
    <aside className="cw-thumbs" aria-label="Danh sách trang">
      <div className="cw-thumbs-head">
        <span>{props.pages.length} trang</span>
        {review.length > 0 && (
          <button type="button" aria-pressed={filtering} onClick={() => setReviewOnly(!filtering)}>
            Cần xem {review.length}
          </button>
        )}
      </div>
      <div className="cw-thumbs-list" ref={listRef}>
        {list.map((p) => {
          const img = props.images.get(p.id);
          const on = p.id === props.activeId;
          const overflow = props.overflow.has(p.id);
          const mark = thumbMark(p, overflow);
          const openMenu = (at: MenuAt, anchor: HTMLElement) => setMenu({ page: p, at, anchor });
          return (
            <div key={p.id} className="cw-thumb-item" data-page={p.id}>
              <button
                type="button"
                className="cw-thumb"
                data-tone={mark?.tone}
                aria-current={on ? "page" : undefined}
                aria-label={thumbAria(p, overflow)}
                aria-haspopup={p.skipped ? "menu" : undefined}
                title={thumbTitle(p, overflow)}
                // Trang ẩn không mở trên canvas (canvas chỉ có trang còn hiện) → bấm mở menu khôi phục.
                onClick={(e) =>
                  p.skipped ? openMenu(menuAtElement(e.currentTarget), e.currentTarget) : props.onPick(p.id)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu({ x: e.clientX, y: e.clientY }, e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (!isMenuKey(e)) return;
                  e.preventDefault();
                  openMenu(menuAtElement(e.currentTarget), e.currentTarget);
                }}
              >
                {img && <img className="cw-thumb-img" src={img.image.url} alt="" loading="lazy" decoding="async" />}
                <span className="cw-thumb-num" aria-hidden="true">
                  {p.ord + 1}
                </span>
              </button>
              {mark && (
                <span className="cw-thumb-mark" data-tone={mark.tone} aria-hidden="true">
                  {mark.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          at={menu.at}
          anchor={menu.anchor}
          label={`Trang ${menu.page.ord + 1}`}
          items={menuItems(menu.page)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
});
