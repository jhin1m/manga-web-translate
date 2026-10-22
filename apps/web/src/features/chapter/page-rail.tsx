/**
 * Rail trang bên trái màn chương: thumbnail (ảnh sạch/ảnh gốc, tải lười) + "Trang n" + chấm 4 mức + cờ cần xem.
 * Lọc Tất cả / Cần xem (lỗi, AI có bản mới, tràn khung) / Đã xoá (chỉ hiện khi có trang ẩn). Bấm = kích hoạt page và
 * cuộn canvas tới. Icon Xoá (ẩn trang: không dịch, không xuất) / Khôi phục khi đang giữ khoá chương. Số trang giữ số
 * gốc (ord + 1) — trang ẩn để lại lỗ số, khớp bảng văn bản và Tìm/Thay.
 */
import { memo, useEffect, useRef, useState } from "react";
import { RestoreIcon, TrashIcon } from "../home/row-icons.tsx";
import type { PageImage, ProgressPage } from "./api.ts";
import { describeJobError, waitingOnProvider } from "./job-error.ts";
import { needsReview, PAGE_LEVEL, pageLevel } from "./page-status.ts";

type Filter = "all" | "review" | "hidden";

/** memo: màn chương render lại mỗi lần gõ (bảng văn bản) — rail chỉ đổi khi page/ảnh/active/cờ đổi. */
export const PageRail = memo(function PageRail(props: {
  pages: ProgressPage[];
  /** Trang đã xoá (ẩn) — chỉ hiện trong bộ lọc "Đã xoá". */
  hidden: ProgressPage[];
  images: Map<string, PageImage>;
  activeId: string | null;
  /** Page có box chữ tràn khung (đo ở client). */
  overflow: Set<string>;
  /** Đang giữ khoá + chương không chạy → được xoá / khôi phục trang. */
  editable: boolean;
  onPick(pageId: string): void;
  onSkip(page: ProgressPage, skipped: boolean): void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const review = props.pages.filter((p) => needsReview(p, props.overflow.has(p.id)));
  // Khôi phục trang ẩn cuối cùng → bộ lọc "Đã xoá" biến mất, về "Tất cả".
  const mode = filter === "hidden" && props.hidden.length === 0 ? "all" : filter;
  const list = mode === "all" ? props.pages : mode === "review" ? review : props.hidden;
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
        <button type="button" aria-pressed={mode === "all"} onClick={() => setFilter("all")}>
          Tất cả {props.pages.length}
        </button>
        <button type="button" aria-pressed={mode === "review"} onClick={() => setFilter("review")}>
          Cần xem {review.length}
        </button>
        {props.hidden.length > 0 && (
          <button type="button" aria-pressed={mode === "hidden"} onClick={() => setFilter("hidden")}>
            Đã xoá {props.hidden.length}
          </button>
        )}
      </fieldset>
      <div className="cw-rail-list" ref={listRef}>
        {list.map((p) => {
          const lv = PAGE_LEVEL[pageLevel(p.status)];
          const img = props.images.get(p.id);
          const on = p.id === props.activeId;
          const n = p.ord + 1;
          const flags = [
            p.ai_update_available && "AI có bản mới",
            props.overflow.has(p.id) && "tràn khung",
            p.cut_flag && "cắt ở trần chiều cao",
            waitingOnProvider(p.job) && "chờ AI thử lại",
          ].filter(Boolean);
          return (
            <div
              key={p.id}
              data-page={p.id}
              className={`cw-rail-item cw-rail-row${on ? " on" : ""}`}
              data-skipped={p.skipped ? "" : undefined}
            >
              <button
                type="button"
                className="cw-rail-pick"
                aria-current={on ? "page" : undefined}
                title={describeJobError(p.job)?.text}
                // Trang ẩn không mở trên canvas (canvas chỉ có trang còn hiện) — khôi phục bằng icon bên cạnh.
                disabled={p.skipped}
                onClick={() => props.onPick(p.id)}
              >
                <span className="cw-thumb">
                  {img && <img src={img.image.url} alt="" loading="lazy" decoding="async" />}
                </span>
                <span className="cw-rail-meta">
                  <span className="cw-rail-title">Trang {n}</span>
                  {p.skipped ? (
                    <span className="status" data-tone="muted">
                      Đã xoá
                    </span>
                  ) : (
                    <span className="status" data-tone={lv.tone}>
                      {lv.label}
                    </span>
                  )}
                  {!p.skipped && flags.length > 0 && <span className="cw-rail-flag">{flags.join(" · ")}</span>}
                </span>
              </button>
              {props.editable &&
                (p.skipped ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Khôi phục trang ${n}`}
                    title="Khôi phục"
                    onClick={() => props.onSkip(p, false)}
                  >
                    <RestoreIcon />
                  </button>
                ) : (
                  // Trang cuối còn hiện không xoá được (API 409 last_page) → không hiện icon.
                  props.pages.length > 1 && (
                    <button
                      type="button"
                      className="icon-btn"
                      data-danger
                      aria-label={`Xoá trang ${n}`}
                      title="Xoá trang (không dịch, không xuất)"
                      onClick={() => props.onSkip(p, true)}
                    >
                      <TrashIcon />
                    </button>
                  )
                ))}
            </div>
          );
        })}
        {list.length === 0 && <p className="muted small">Không có trang cần xem.</p>}
      </div>
    </aside>
  );
});
