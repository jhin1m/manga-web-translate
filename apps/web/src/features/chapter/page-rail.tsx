/**
 * Rail trang bên trái màn chương: thumbnail (ảnh sạch/ảnh gốc, tải lười) + "Trang n" + chấm 4 mức + cờ cần xem.
 * Lọc Tất cả / Cần xem (lỗi, AI có bản mới, tràn khung). Bấm = kích hoạt page và cuộn canvas tới.
 */
import { memo, useEffect, useRef, useState } from "react";
import type { PageImage, ProgressPage } from "./api.ts";
import { describeJobError, waitingOnProvider } from "./job-error.ts";
import { needsReview, PAGE_LEVEL, pageLevel } from "./page-status.ts";

/** memo: màn chương render lại mỗi lần gõ (bảng văn bản) — rail chỉ đổi khi page/ảnh/active/cờ đổi. */
export const PageRail = memo(function PageRail(props: {
  pages: ProgressPage[];
  images: Map<string, PageImage>;
  activeId: string | null;
  /** Page có box chữ tràn khung (đo ở client). */
  overflow: Set<string>;
  onPick(pageId: string): void;
}) {
  const [filter, setFilter] = useState<"all" | "review">("all");
  const review = props.pages.filter((p) => needsReview(p, props.overflow.has(p.id)));
  const list = filter === "all" ? props.pages : review;
  const listRef = useRef<HTMLDivElement>(null);

  // Page active đổi (canvas, phím ←/→, ?page=) → đưa vào tầm nhìn của rail.
  useEffect(() => {
    if (!props.activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-page="${props.activeId}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [props.activeId]);

  return (
    <aside className="cw-rail" aria-label="Danh sách trang">
      <fieldset className="cw-rail-filter" aria-label="Lọc trang">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          Tất cả {props.pages.length}
        </button>
        <button type="button" aria-pressed={filter === "review"} onClick={() => setFilter("review")}>
          Cần xem {review.length}
        </button>
      </fieldset>
      <div className="cw-rail-list" ref={listRef}>
        {list.map((p) => {
          const lv = PAGE_LEVEL[pageLevel(p.status)];
          const img = props.images.get(p.id);
          const on = p.id === props.activeId;
          const flags = [
            p.ai_update_available && "AI có bản mới",
            props.overflow.has(p.id) && "tràn khung",
            p.cut_flag && "cắt ở trần chiều cao",
            waitingOnProvider(p.job) && "chờ AI thử lại",
          ].filter(Boolean);
          return (
            <button
              key={p.id}
              type="button"
              data-page={p.id}
              className={on ? "cw-rail-item on" : "cw-rail-item"}
              aria-current={on ? "page" : undefined}
              title={describeJobError(p.job)?.text}
              onClick={() => props.onPick(p.id)}
            >
              <span className="cw-thumb">
                {img && <img src={img.image.url} alt="" loading="lazy" decoding="async" />}
              </span>
              <span className="cw-rail-meta">
                <span className="cw-rail-title">Trang {p.ord + 1}</span>
                <span className="status" data-tone={lv.tone}>
                  {lv.label}
                </span>
                {flags.length > 0 && <span className="cw-rail-flag">{flags.join(" · ")}</span>}
              </span>
            </button>
          );
        })}
        {list.length === 0 && <p className="muted small">Không có trang cần xem.</p>}
      </div>
    </aside>
  );
});
