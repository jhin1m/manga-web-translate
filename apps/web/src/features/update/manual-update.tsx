/** Khối lệnh cập nhật tay + nút Chép. Windows dùng `curl.exe`; từng dòng một (PowerShell 5.1). */
import { useRef, useState } from "react";
import { manualCommands } from "./update-model.ts";
import "./update.css";

export function ManualUpdate({ pinned }: { pinned: boolean }) {
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState(false);
  const cmdRef = useRef<HTMLPreElement>(null);
  const lines = manualCommands(navigator.userAgent);

  // Trang http trên host LAN không có navigator.clipboard: chọn sẵn khối lệnh để người dùng tự chép.
  const selectText = () => {
    const el = cmdRef.current;
    if (!el) return;
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
    setHint(true);
  };

  const copy = () => {
    setHint(false);
    const clip = navigator.clipboard;
    if (!clip?.writeText) {
      selectText();
      return;
    }
    clip
      .writeText(lines.join("\n"))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(selectText);
  };

  return (
    <div className="update-manual">
      <p className="small">
        Chạy trong thư mục chứa <code>docker-compose.yml</code>, từng dòng một:
      </p>
      {pinned && (
        <p className="small">
          Bỏ dòng <code>MTL_TAG</code> trong file <code>.env</code> trước.
        </p>
      )}
      <pre ref={cmdRef} className="update-cmd" data-testid="manual-commands">
        {lines.join("\n")}
      </pre>
      <button type="button" onClick={copy}>
        {copied ? "Đã chép" : "Chép"}
      </button>
      {hint && (
        <p className="small muted" role="status">
          Không chép tự động được. Hãy chọn và chép tay.
        </p>
      )}
    </div>
  );
}
