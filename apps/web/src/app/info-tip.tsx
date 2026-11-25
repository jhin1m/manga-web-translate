/**
 * Nút ⓘ kèm lời giải thích ngắn (thay cho dòng hint dưới trường). Hiện khi rê chuột, khi focus bằng phím (Tab) hoặc
 * khi bấm/chạm; ẩn khi rời đi hoặc blur. Nội dung gắn vào nút qua `aria-describedby` nên trình đọc màn hình đọc được.
 * `id`: id cố định cho phần nội dung — để ô điều khiển cạnh nút cũng trỏ `aria-describedby` vào cùng lời giải thích.
 */
import { type ReactNode, useId, useState } from "react";
import "./info-tip.css";

export function InfoTip({ label, id: fixedId, children }: { label: string; id?: string; children: ReactNode }) {
  const autoId = useId();
  const id = fixedId ?? autoId;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const shown = hover || focus || pinned;
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip-btn"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={shown}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false);
          setPinned(false);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
        }}
        onClick={() => setPinned((p) => !p)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5v.01" />
        </svg>
      </button>
      <span id={id} role="tooltip" className="info-tip-text" hidden={!shown}>
        {children}
      </span>
    </span>
  );
}
