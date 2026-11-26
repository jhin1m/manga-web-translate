/**
 * Cột trang bên phải canvas (72px): thumbnail 52×72 (ảnh sạch/ảnh gốc, tải lười) + số trang, không chữ. Trạng thái =
 * viền + cờ ở góc ("!" cần xem / chờ AI, "×" lỗi; tên truy cập + tooltip là câu đầy đủ — page-status.ts `thumbFlag`),
 * thanh % trên thumbnail khi AI đang chạy; trang ẩn mờ + viền đứt, nằm đúng vị trí theo số trang. Bấm = kích hoạt
 * page và cuộn canvas tới (bỏ chọn); ⌘-click (macOS) / Ctrl-click / Shift-click = chọn trang để dịch riêng
 * (page-selection.ts), có chọn → thanh "Dịch N trang · Bỏ chọn" ở đầu cột. Thao tác trang là một menu: nút ⋯ luôn hiện
 * trên trang đang mở, chuột phải (Shift+F10 / phím Menu) mở cùng menu — Dịch / Dịch lại trang, Quét lại trang, Bỏ chỉnh sửa tay (khi khác
 * bản AI), Ẩn trang. Trang khác chỉ có Ẩn trang; bấm trang ẩn mở menu Khôi phục. Số trang giữ số gốc (ord + 1) — trang
 * ẩn để lại lỗ số, khớp bảng văn bản và Tìm/Thay.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n/t.ts";
import type { PageImage, ProgressPage } from "./api.ts";
import { ContextMenu, isMenuKey, type MenuAt, type MenuItem, menuAtElement } from "./context-menu.tsx";
import { selectablePage } from "./page-selection.ts";
import { thumbAria, thumbFlag, thumbMark, thumbTitle } from "./page-status.ts";
import { ThumbFlagBadge } from "./thumb-flag.tsx";
import { MoreIcon } from "./tool-icons.tsx";

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
  /** Trang đang chọn để dịch riêng (đã lọc trang không chọn được). */
  selected: ReadonlySet<string>;
  /** Đang gửi lượt dịch các trang chọn. */
  translating: boolean;
  onSelect(pageId: string, mod: { shift: boolean; toggle: boolean }): void;
  onTranslateSelected(): void;
  onClearSelection(): void;
  /** Dịch (trang chờ dịch) / dịch lại riêng 1 trang; `retranslateOff` = lý do đang tắt. */
  onRetranslate(page: ProgressPage): void;
  retranslateOff?: string;
  /** Quét lại trang (xoá chữ + OCR lại rồi dịch) — tắt cùng lý do với dịch lại. */
  onRescan(page: ProgressPage): void;
  /** Trang này có chỉnh sửa tay để bỏ không (chỉ trang đang mở). Gọi lúc mở menu nên đọc state mới nhất. */
  canResetEdits(page: ProgressPage): boolean;
  onResetEdits(page: ProgressPage): void;
}) {
  const { t, tp } = useT();
  const [menu, setMenu] = useState<{ page: ProgressPage; at: MenuAt; anchor: HTMLElement } | null>(null);
  const all = useMemo(
    () => [...props.pages, ...props.hidden].sort((a, b) => a.ord - b.ord),
    [props.pages, props.hidden],
  );
  const listRef = useRef<HTMLDivElement>(null);

  // Page active đổi (canvas, phím ←/→, ?page=) → đưa vào tầm nhìn của cột.
  useEffect(() => {
    if (!props.activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-page="${props.activeId}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [props.activeId]);

  const menuItems = (p: ProgressPage) => {
    const n = p.ord + 1;
    const lockHint = t("chapter.pageRail.lockHint");
    if (p.skipped)
      return [
        {
          label: t("chapter.pageRail.restore", { page: n }),
          disabled: !props.editable,
          title: props.editable ? undefined : lockHint,
          run: () => props.onSkip(p, false),
        },
      ];
    // Trang cuối còn hiện không ẩn được (API 409 last_page).
    const reason = !props.editable ? lockHint : props.pages.length <= 1 ? t("chapter.pageRail.lastPage") : undefined;
    const items: MenuItem[] = [];
    // Dịch / bỏ sửa tay chỉ có ở trang đang mở (state AI nằm trong phiên sửa của nó); trang khác chỉ ẩn được.
    if (p.id === props.activeId && selectablePage(p)) {
      const first = p.status === "prepared";
      items.push({
        label: first ? t("chapter.pageRail.translate", { page: n }) : t("chapter.pageRail.retranslate", { page: n }),
        disabled: !!props.retranslateOff,
        title:
          props.retranslateOff ??
          (first ? t("chapter.pageRail.translateTitle") : t("chapter.pageRail.retranslateTitle")),
        run: () => props.onRetranslate(p),
      });
      items.push({
        label: t("chapter.pageRail.rescan", { page: n }),
        disabled: !!props.retranslateOff,
        title: props.retranslateOff ?? t("chapter.pageRail.rescanTitle"),
        run: () => props.onRescan(p),
      });
    }
    if (props.canResetEdits(p)) {
      items.push({
        label: t("chapter.pageRail.resetEdits", { page: n }),
        title: t("chapter.pageRail.resetEditsTitle"),
        run: () => props.onResetEdits(p),
      });
    }
    return [
      ...items,
      {
        label: t("chapter.pageRail.hide", { page: n }),
        danger: true,
        disabled: !!reason,
        title: reason ?? t("chapter.pageRail.hideTitle"),
        run: () => props.onSkip(p, true),
      },
    ];
  };

  return (
    <aside className="cw-thumbs" aria-label={t("chapter.pageRail.listAria")}>
      {props.selected.size > 0 && (
        <div className="cw-thumbs-sel" role="toolbar" aria-label={t("chapter.pageRail.selectedAria")}>
          <button
            type="button"
            className="btn-primary"
            disabled={props.translating}
            title={t("chapter.pageRail.translateSelectedTitle")}
            onClick={props.onTranslateSelected}
          >
            {tp("chapter.pageRail.translateSelected", props.selected.size)}
          </button>
          <button
            type="button"
            className="btn-link"
            title={t("chapter.pageRail.clearSelectionTitle")}
            onClick={props.onClearSelection}
          >
            {t("chapter.pageRail.clearSelection")}
          </button>
        </div>
      )}
      <div className="cw-thumbs-list" ref={listRef}>
        {all.map((p) => {
          const img = props.images.get(p.id);
          const on = p.id === props.activeId;
          const overflow = props.overflow.has(p.id);
          const mark = thumbMark(p, overflow);
          const flag = thumbFlag(p, overflow);
          const picked = props.selected.has(p.id);
          const openMenu = (at: MenuAt, anchor: HTMLElement) => setMenu({ page: p, at, anchor });
          return (
            <div key={p.id} className="cw-thumb-item" data-page={p.id}>
              <button
                type="button"
                className="cw-thumb"
                data-tone={mark?.tone}
                aria-current={on ? "page" : undefined}
                data-selected={picked || undefined}
                aria-label={
                  picked
                    ? t("chapter.pageRail.thumbSelected", { name: thumbAria(p, overflow) })
                    : thumbAria(p, overflow)
                }
                aria-haspopup={p.skipped ? "menu" : undefined}
                title={thumbTitle(p, overflow, undefined, on)}
                // Trang ẩn không mở trên canvas (canvas chỉ có trang còn hiện) → bấm mở menu khôi phục.
                onClick={(e) => {
                  const toggle = e.ctrlKey || e.metaKey;
                  if (toggle || e.shiftKey) {
                    // Không để trình duyệt bôi chọn văn bản / mở tab mới.
                    e.preventDefault();
                    return props.onSelect(p.id, { shift: e.shiftKey, toggle });
                  }
                  if (p.skipped) return openMenu(menuAtElement(e.currentTarget), e.currentTarget);
                  props.onPick(p.id);
                }}
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
                {mark?.tone === "busy" && (
                  <span className="cw-thumb-bar" data-wait={mark.progress === null || undefined} aria-hidden="true">
                    <span
                      className="cw-thumb-bar-fill"
                      style={{ width: `${Math.round((mark.progress ?? 1) * 100)}%` }}
                    />
                  </span>
                )}
                <span className="cw-thumb-num" aria-hidden="true">
                  {p.ord + 1}
                </span>
              </button>
              {flag && <ThumbFlagBadge glyph={flag.glyph} tone={flag.tone} text={flag.text} />}
              {on && !p.skipped && (
                <button
                  type="button"
                  className="cw-thumb-act"
                  data-always
                  aria-label={t("chapter.pageRail.actionsAria", { page: p.ord + 1 })}
                  aria-haspopup="menu"
                  aria-expanded={menu?.page.id === p.id}
                  title={t("chapter.pageRail.actionsTitle")}
                  onClick={(e) => {
                    const anchor = e.currentTarget;
                    // Bấm lại nút khi menu của nó đang mở = đóng.
                    setMenu((m) => (m?.anchor === anchor ? null : { page: p, at: menuAtElement(anchor), anchor }));
                  }}
                >
                  <MoreIcon size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          at={menu.at}
          anchor={menu.anchor}
          label={t("chapter.pageRail.menuLabel", { page: menu.page.ord + 1 })}
          items={menuItems(menu.page)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
});
