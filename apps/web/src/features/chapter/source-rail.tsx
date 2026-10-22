/**
 * Cột ảnh gốc bên phải canvas khi chương chưa có page (nháp, đang cắt trang, cắt lỗi): thumbnail từng ảnh theo thứ tự
 * upload + số, hiện ngay khi thả file (Blob local). Bấm = xem ảnh đó ở canvas. Nhãn dưới thumbnail chỉ khi có
 * (Đã xoá / Credit · tự bỏ / Đang tải / Tải lỗi / Chưa tải / Có thể là credit). Xoá / Khôi phục ảnh qua menu chuột
 * phải (Shift+F10 / phím Menu) khi còn sửa được bộ ảnh (trước Bước 1); ảnh bỏ qua mờ đi, Bước 1 không ghép chúng.
 */
import { memo, useEffect, useRef, useState } from "react";
import { ContextMenu, isMenuKey, type MenuAt, menuAtElement } from "./context-menu.tsx";
import { type SourceItem, sourceCounts, sourceLabel } from "./source-rail-model.ts";

export const SourceRail = memo(function SourceRail(props: {
  items: SourceItem[];
  activeId: string | null;
  /** Còn đổi được bộ ảnh (chưa bấm Bước 1, hoặc cắt trang lỗi). */
  editable: boolean;
  onPick(id: string): void;
  onSkip(it: SourceItem, skip: "user" | null): void;
}) {
  const { total, skipped } = sourceCounts(props.items);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ item: SourceItem; at: MenuAt; anchor: HTMLElement } | null>(null);

  // Ảnh đang xem đổi (←/→, nút ‹ ›) → đưa vào tầm nhìn của cột.
  useEffect(() => {
    if (!props.activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-source="${props.activeId}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [props.activeId]);

  return (
    <aside className="cw-thumbs" aria-label="Danh sách ảnh gốc">
      <div className="cw-thumbs-head">
        <span>
          {total} ảnh{skipped > 0 ? ` · đã bỏ ${skipped}` : ""}
        </span>
      </div>
      <div className="cw-thumbs-list" ref={listRef}>
        {props.items.map((it) => {
          const on = it.id === props.activeId;
          const tag = sourceLabel(it);
          const openMenu = (at: MenuAt, anchor: HTMLElement) => {
            if (props.editable) setMenu({ item: it, at, anchor });
          };
          return (
            <div key={it.id} className="cw-thumb-item" data-source={it.id}>
              <button
                type="button"
                className="cw-thumb"
                data-tone={it.skip ? "hidden" : tag?.tone}
                aria-current={on ? "page" : undefined}
                aria-label={`Ảnh ${it.n}${tag ? ` · ${tag.label}` : ""}`}
                title={props.editable ? `Chuột phải: ${it.skip ? "khôi phục" : "xoá"} ảnh` : undefined}
                onClick={() => props.onPick(it.id)}
                onContextMenu={(e) => {
                  if (!props.editable) return;
                  e.preventDefault();
                  openMenu({ x: e.clientX, y: e.clientY }, e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (!isMenuKey(e) || !props.editable) return;
                  e.preventDefault();
                  openMenu(menuAtElement(e.currentTarget), e.currentTarget);
                }}
              >
                <img className="cw-thumb-img" src={it.url} alt="" loading="lazy" decoding="async" />
                <span className="cw-thumb-num" aria-hidden="true">
                  {it.n}
                </span>
              </button>
              {tag && (
                <span className="cw-thumb-mark" data-tone={it.skip ? "hidden" : tag.tone} aria-hidden="true">
                  {tag.label}
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
          label={`Ảnh ${menu.item.n}`}
          items={[
            menu.item.skip
              ? { label: `Khôi phục ảnh ${menu.item.n}`, run: () => props.onSkip(menu.item, null) }
              : {
                  label: `Xoá ảnh ${menu.item.n}`,
                  danger: true,
                  title: "Bước 1 bỏ qua ảnh này",
                  run: () => props.onSkip(menu.item, "user"),
                },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
});
