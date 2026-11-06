/**
 * Dải tab của panel Văn bản: Bản dịch · Tìm / Thay · Glossary · Hiệu đính · N (N = gợi ý chờ duyệt). Tab đang mở có
 * `aria-selected`; ←/→/Home/End chuyển tab. Tab chưa dùng được (chương chưa dịch xong) bị tắt kèm lý do.
 */
import type { KeyboardEvent } from "react";
import { DOC_TABS, type DocTab } from "./tool-rail-model.ts";

export const DOC_TAB_LABEL: Record<DocTab, string> = {
  table: "Bản dịch",
  find: "Tìm / Thay",
  glossary: "Glossary",
  proofread: "Hiệu đính",
};

export const docTabId = (t: DocTab) => `cw-doc-tab-${t}`;
export const docPanelId = (t: DocTab) => `cw-doc-panel-${t}`;

/** Nhãn hiển thị của tab; Hiệu đính kèm số gợi ý chờ duyệt khi có. */
export const docTabLabel = (t: DocTab, pendingProofread: number) =>
  t === "proofread" && pendingProofread > 0 ? `${DOC_TAB_LABEL[t]} · ${pendingProofread}` : DOC_TAB_LABEL[t];

export function DocTabs(props: {
  tab: DocTab;
  /** Tab bị tắt → lý do. */
  disabled: Partial<Record<DocTab, string>>;
  pendingProofread: number;
  onSelect(t: DocTab): void;
}) {
  const enabled = DOC_TABS.filter((t) => !props.disabled[t]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = enabled.indexOf(props.tab);
    const next =
      e.key === "ArrowRight"
        ? enabled[(i + 1) % enabled.length]
        : e.key === "ArrowLeft"
          ? enabled[(i - 1 + enabled.length) % enabled.length]
          : e.key === "Home"
            ? enabled[0]
            : e.key === "End"
              ? enabled.at(-1)
              : undefined;
    if (!next) return;
    e.preventDefault();
    props.onSelect(next);
    document.getElementById(docTabId(next))?.focus();
  };
  return (
    <div className="cw-doctabs" role="tablist" aria-label="Văn bản" onKeyDown={onKey}>
      {DOC_TABS.map((t) => {
        const reason = props.disabled[t];
        return (
          <button
            key={t}
            id={docTabId(t)}
            type="button"
            role="tab"
            aria-selected={props.tab === t}
            aria-controls={docPanelId(t)}
            tabIndex={props.tab === t ? 0 : -1}
            disabled={!!reason}
            title={reason}
            onClick={() => props.onSelect(t)}
          >
            {docTabLabel(t, props.pendingProofread)}
          </button>
        );
      })}
    </div>
  );
}
