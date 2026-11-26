/**
 * Dải tab của panel Văn bản: Bản dịch · Tìm / Thay · Glossary · Hiệu đính · N (N = gợi ý chờ duyệt). Tab đang mở có
 * `aria-selected`; ←/→/Home/End chuyển tab. Tab chưa dùng được (chương chưa dịch xong) bị tắt kèm lý do.
 */
import type { KeyboardEvent } from "react";
import { type MessageKey, t, useT } from "../../i18n/t.ts";
import { DOC_TABS, type DocTab } from "./tool-rail-model.ts";

export const DOC_TAB_LABEL: Record<DocTab, MessageKey> = {
  table: "chapter.docTabs.table",
  find: "chapter.docTabs.find",
  glossary: "chapter.docTabs.glossary",
  proofread: "chapter.docTabs.proofread",
};

export const docTabId = (t: DocTab) => `cw-doc-tab-${t}`;
export const docPanelId = (t: DocTab) => `cw-doc-panel-${t}`;

/** Nhãn hiển thị của tab; Hiệu đính kèm số gợi ý chờ duyệt khi có. */
export const docTabLabel = (tab: DocTab, pendingProofread: number) =>
  tab === "proofread" && pendingProofread > 0
    ? t("chapter.docTabs.withCount", { label: t(DOC_TAB_LABEL[tab]), count: pendingProofread })
    : t(DOC_TAB_LABEL[tab]);

export function DocTabs(props: {
  tab: DocTab;
  /** Tab bị tắt → lý do. */
  disabled: Partial<Record<DocTab, string>>;
  pendingProofread: number;
  onSelect(t: DocTab): void;
}) {
  useT();
  const enabled = DOC_TABS.filter((tab) => !props.disabled[tab]);
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
    <div className="cw-doctabs" role="tablist" aria-label={t("chapter.docTabs.tablist")} onKeyDown={onKey}>
      {DOC_TABS.map((tab) => {
        const reason = props.disabled[tab];
        return (
          <button
            key={tab}
            id={docTabId(tab)}
            type="button"
            role="tab"
            aria-selected={props.tab === tab}
            aria-controls={docPanelId(tab)}
            tabIndex={props.tab === tab ? 0 : -1}
            disabled={!!reason}
            title={reason}
            onClick={() => props.onSelect(tab)}
          >
            {docTabLabel(tab, props.pendingProofread)}
          </button>
        );
      })}
    </div>
  );
}
