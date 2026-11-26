/** Khối lệnh cập nhật tay + nút Chép. Windows dùng `curl.exe`; từng dòng một (PowerShell 5.1). */
import { useRef, useState } from "react";
import { useT } from "../../i18n/t.ts";
import { manualCommands } from "./update-model.ts";
import "./update.css";

export function ManualUpdate({ pinned }: { pinned: boolean }) {
  const { t, tNode } = useT();
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
      <p className="small">{tNode("update.manualUpdate.runIn", { file: <code>docker-compose.yml</code> })}</p>
      {pinned && (
        <p className="small">
          {tNode("update.manualUpdate.unpin", { setting: <code>MTL_TAG</code>, file: <code>.env</code> })}
        </p>
      )}
      <pre ref={cmdRef} className="update-cmd" data-testid="manual-commands">
        {lines.join("\n")}
      </pre>
      <button type="button" onClick={copy}>
        {copied ? t("update.manualUpdate.copied") : t("update.manualUpdate.copy")}
      </button>
      {hint && (
        <p className="small muted" role="status">
          {t("update.manualUpdate.copyFallback")}
        </p>
      )}
    </div>
  );
}
