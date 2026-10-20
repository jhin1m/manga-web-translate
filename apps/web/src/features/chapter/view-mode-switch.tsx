/**
 * Chế độ xem màn chương `[Gốc | Dịch | Chia đôi]` (chapterStore.viewMode). Nút sáng theo chế độ đang hiển thị:
 * giữ `O` → "Gốc" sáng tới khi nhả.
 */
import { chapterStore, effectiveMode, useChapterStore, type ViewMode } from "../editor/chapter-store.ts";

const MODES: { id: ViewMode; label: string; title: string }[] = [
  { id: "original", label: "Gốc", title: "Ảnh gốc, ẩn chữ (giữ O: xem tạm · \\: đổi Gốc/Dịch)" },
  { id: "translated", label: "Dịch", title: "Ảnh đã xoá chữ + bản dịch (\\: đổi Gốc/Dịch)" },
  { id: "split", label: "Chia đôi", title: "Gốc bên trái, Dịch bên phải — cuộn/zoom cùng nhau, sửa ở cột Dịch" },
];

export function ViewModeSwitch() {
  const mode = useChapterStore(effectiveMode);
  return (
    <fieldset className="cw-seg" aria-label="Chế độ xem">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={mode === m.id}
          title={m.title}
          onClick={() => chapterStore.getState().setViewMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </fieldset>
  );
}
