/**
 * Rail trái khi chương chưa có page (nháp, đang cắt trang, cắt lỗi): từng ảnh gốc "Ảnh n" theo thứ tự upload,
 * hiện ngay khi thả file (Blob local). Bấm = xem ảnh đó ở canvas. Icon Xoá / Khôi phục khi còn sửa được bộ ảnh
 * (trước Bước 1); ảnh bỏ qua mờ đi kèm nhãn, Bước 1 không ghép chúng.
 */
import { memo, useEffect, useRef } from "react";
import { RestoreIcon, TrashIcon } from "../home/row-icons.tsx";
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

  // Ảnh đang xem đổi (←/→, nút ‹ ›) → đưa vào tầm nhìn của rail.
  useEffect(() => {
    if (!props.activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-source="${props.activeId}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [props.activeId]);

  return (
    <aside className="cw-rail" aria-label="Danh sách ảnh gốc">
      <div className="cw-rail-head small muted">
        {total} ảnh{skipped > 0 ? ` · đã bỏ ${skipped}` : ""}
      </div>
      <div className="cw-rail-list" ref={listRef}>
        {props.items.map((it) => {
          const { n } = it;
          const on = it.id === props.activeId;
          const tag = sourceLabel(it);
          return (
            <div
              key={it.id}
              data-source={it.id}
              className={`cw-rail-item cw-rail-row${on ? " on" : ""}`}
              data-skipped={it.skip ? "" : undefined}
            >
              <button
                type="button"
                className="cw-rail-pick"
                aria-current={on ? "page" : undefined}
                onClick={() => props.onPick(it.id)}
              >
                <span className="cw-thumb">
                  <img src={it.url} alt="" loading="lazy" decoding="async" />
                </span>
                <span className="cw-rail-meta">
                  <span className="cw-rail-title">Ảnh {n}</span>
                  {tag && (
                    <span className="status" data-tone={tag.tone}>
                      {tag.label}
                    </span>
                  )}
                </span>
              </button>
              {props.editable &&
                (it.skip ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Khôi phục ảnh ${n}`}
                    title="Khôi phục"
                    onClick={() => props.onSkip(it, null)}
                  >
                    <RestoreIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    data-danger
                    aria-label={`Xoá ảnh ${n}`}
                    title="Xoá (Bước 1 bỏ qua ảnh này)"
                    onClick={() => props.onSkip(it, "user")}
                  >
                    <TrashIcon />
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
});
