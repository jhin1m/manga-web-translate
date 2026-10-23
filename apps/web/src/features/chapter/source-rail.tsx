/**
 * Cột ảnh gốc bên phải canvas khi chương chưa có page (nháp, đang cắt trang, cắt lỗi): thumbnail từng ảnh theo thứ tự
 * upload + số, hiện ngay khi thả file (Blob local). Bấm = xem ảnh đó ở canvas. Nhãn dưới thumbnail chỉ khi có
 * (Đã xoá / Credit · tự bỏ / Đang tải / Tải lỗi / Chưa tải / Có thể là credit). Xoá / Khôi phục ảnh bằng nút góc
 * thumbnail (hiện khi rê chuột / focus) hoặc menu chuột phải (Shift+F10 / phím Menu) khi còn sửa được bộ ảnh (trước
 * Bước 1); ảnh bỏ qua mờ đi, Bước 1 không ghép chúng. Cũng khi còn sửa được: kéo-thả thumbnail (vạch báo chỗ thả), menu
 * "Đưa lên đầu / Lên 1 / Xuống 1 / Đưa xuống cuối" hoặc Alt+↑/↓ trên thumbnail đang focus để đổi thứ tự ghép. Đang cắt trang (Bước 1) → đầu cột hiện tiến độ, ảnh được ghép
 * có viền "đang xử lý".
 */
import { memo, useEffect, useRef, useState } from "react";
import { ContextMenu, isMenuKey, type MenuAt, type MenuItem, menuAtElement } from "./context-menu.tsx";
import { moveItem, type SourceItem, sourceCounts, sourceLabel } from "./source-rail-model.ts";
import { TrashIcon, UndoIcon } from "./tool-icons.tsx";

export const SourceRail = memo(function SourceRail(props: {
  items: SourceItem[];
  activeId: string | null;
  /** Còn đổi được bộ ảnh (chưa bấm Bước 1, hoặc cắt trang lỗi). */
  editable: boolean;
  /** Bước 1 đang cắt trang: tiến độ job 0..1, null khi job còn xếp hàng; undefined = không chạy. */
  cutting?: number | null;
  onPick(id: string): void;
  onSkip(it: SourceItem, skip: "user" | null): void;
  /** Đưa ảnh `id` tới vị trí `to` (0-based). */
  onMove(id: string, to: number): void;
}) {
  const { total, skipped } = sourceCounts(props.items);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ item: SourceItem; at: MenuAt; anchor: HTMLElement } | null>(null);

  /** Ảnh đang kéo + khe thả (0..số ảnh): vạch hiện ở khe đó. */
  const [drag, setDrag] = useState<{ id: string; gap: number | null } | null>(null);
  /** Ảnh vừa đổi chỗ bằng phím / menu: DOM bị dời nên trả focus lại sau khi rail vẽ xong. */
  const refocus = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: props.items chỉ dùng để chạy lại sau khi rail đổi thứ tự
  useEffect(() => {
    if (!refocus.current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-source="${refocus.current}"] .cw-thumb`)?.focus();
    refocus.current = null;
  }, [props.items]);

  const last = props.items.length - 1;
  const moveTo = (id: string, to: number) => {
    // Không đổi chỗ thật (đầu/cuối danh sách) → không đặt refocus, tránh kéo focus về ảnh cũ ở lần vẽ lại sau.
    if (
      moveItem(
        props.items,
        props.items.findIndex((x) => x.id === id),
        to,
      ) === props.items
    )
      return;
    refocus.current = id;
    props.onMove(id, to);
  };
  /** Mục menu đổi chỗ của ảnh `id` (vô hiệu khi đã ở đầu / cuối). */
  const moveItems = (id: string): MenuItem[] => {
    const i = props.items.findIndex((x) => x.id === id);
    const at = (label: string, to: number): MenuItem => {
      const target = Math.max(0, Math.min(last, to));
      return { label, disabled: i < 0 || i === target, run: () => moveTo(id, target) };
    };
    return [at("Đưa lên đầu", 0), at("Lên 1", i - 1), at("Xuống 1", i + 1), at("Đưa xuống cuối", last)];
  };

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
        {props.cutting !== undefined && (
          <>
            <span className="cw-thumbs-busy" role="status">
              Đang cắt trang{props.cutting === null ? "…" : ` ${Math.round(props.cutting * 100)}%`}
            </span>
            <span className="cw-thumb-bar" data-wait={props.cutting === null || undefined} aria-hidden="true">
              <span className="cw-thumb-bar-fill" style={{ width: `${Math.round((props.cutting ?? 1) * 100)}%` }} />
            </span>
          </>
        )}
      </div>
      <div className="cw-thumbs-list" ref={listRef}>
        {props.items.map((it) => {
          const on = it.id === props.activeId;
          const tag = sourceLabel(it);
          const openMenu = (at: MenuAt, anchor: HTMLElement) => {
            if (props.editable) setMenu({ item: it, at, anchor });
          };
          const i = props.items.indexOf(it);
          const drop = drag?.gap === i ? "before" : drag?.gap === last + 1 && i === last ? "after" : undefined;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: kéo-thả chỉ là đường tắt cho chuột; bàn phím dùng Alt+↑/↓ và menu
            <div
              key={it.id}
              className="cw-thumb-item"
              data-source={it.id}
              data-dragging={drag?.id === it.id || undefined}
              data-drop={drop}
              draggable={props.editable}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", it.id);
                setDrag({ id: it.id, gap: null });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const r = e.currentTarget.getBoundingClientRect();
                const gap = e.clientY < r.top + r.height / 2 ? i : i + 1;
                if (gap !== drag.gap) setDrag({ ...drag, gap });
              }}
              onDrop={(e) => {
                if (!drag || drag.gap === null) return;
                e.preventDefault();
                const from = props.items.findIndex((x) => x.id === drag.id);
                // Khe nằm sau vị trí cũ → bỏ ảnh ra rồi mọi chỉ số sau nó lùi 1.
                const to = drag.gap > from ? drag.gap - 1 : drag.gap;
                setDrag(null);
                if (moveItem(props.items, from, to) !== props.items) props.onMove(drag.id, to);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <button
                type="button"
                className="cw-thumb"
                data-tone={it.skip ? "hidden" : props.cutting !== undefined ? "busy" : tag?.tone}
                aria-current={on ? "page" : undefined}
                aria-label={`Ảnh ${it.n}${tag ? ` · ${tag.label}` : ""}`}
                title={
                  props.editable ? `Kéo để đổi thứ tự · chuột phải: ${it.skip ? "khôi phục" : "xoá"} ảnh` : undefined
                }
                onClick={() => props.onPick(it.id)}
                onContextMenu={(e) => {
                  if (!props.editable) return;
                  e.preventDefault();
                  openMenu({ x: e.clientX, y: e.clientY }, e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (!props.editable) return;
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    moveTo(it.id, i + (e.key === "ArrowUp" ? -1 : 1));
                    return;
                  }
                  if (!isMenuKey(e)) return;
                  e.preventDefault();
                  openMenu(menuAtElement(e.currentTarget), e.currentTarget);
                }}
              >
                <img className="cw-thumb-img" src={it.url} alt="" loading="lazy" decoding="async" />
                <span className="cw-thumb-num" aria-hidden="true">
                  {it.n}
                </span>
              </button>
              {props.editable && (
                <button
                  type="button"
                  className="cw-thumb-act"
                  data-danger={!it.skip || undefined}
                  aria-label={it.skip ? `Khôi phục ảnh ${it.n}` : `Xoá ảnh ${it.n}`}
                  title={it.skip ? "Khôi phục ảnh" : "Xoá ảnh — Bước 1 bỏ qua ảnh này"}
                  onClick={() => props.onSkip(it, it.skip ? null : "user")}
                >
                  {it.skip ? <UndoIcon size={14} /> : <TrashIcon size={14} />}
                </button>
              )}
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
            ...moveItems(menu.item.id),
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
