/** Cột trang bên trái: số trang + chấm trạng thái + đánh dấu có kết quả AI mới; bấm để chuyển (←/→). */

import type { ProgressPage } from "../../chapter/api.ts";
import { PAGE_STATUS } from "../../chapter/status.ts";

export function PageStrip(props: { pages: ProgressPage[]; current: string; onGo(id: string): void }) {
  return (
    <nav className="ed-strip" aria-label="Trang trong chương">
      {props.pages.map((p) => {
        const st = PAGE_STATUS[p.status];
        return (
          <button
            key={p.id}
            type="button"
            className={p.id === props.current ? "on" : undefined}
            aria-current={p.id === props.current ? "page" : undefined}
            title={`Trang ${p.ord + 1} · ${st.label}${p.ai_update_available ? " · có kết quả AI mới" : ""}`}
            onClick={() => props.onGo(p.id)}
          >
            <span className="status" data-tone={st.tone} />
            {p.ord + 1}
            {p.ai_update_available && <span className="ed-dot" />}
          </button>
        );
      })}
    </nav>
  );
}
