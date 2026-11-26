/**
 * Khung chung của trang Cài đặt và modal Cài đặt dịch: đầu mục (ô icon + tiêu đề + 1 dòng mô tả + hành động), nhóm là
 * một thẻ (đầu thẻ có ô icon, thân là các hàng), hàng = nhãn (+ ⓘ giải thích) bên trái, ô điều khiển bên phải. Giải thích
 * dài nằm trong ⓘ thay vì dòng chữ dưới nhãn. Màn hẹp: hàng xếp dọc.
 */
import { type ReactNode, useId, useState } from "react";
import { InfoTip } from "../../app/info-tip.tsx";
import { ChevronDownIcon } from "../../app/settings-icons.tsx";
import { useT } from "../../i18n/t.ts";

/** Ô vuông nền nhạt chứa icon nét (`app/settings-icons.tsx`); `step`: số bước nhỏ ở góc (luồng Pipeline). */
function IconTile(props: { icon: ReactNode; step?: number; size?: "lg" }) {
  return (
    <span className={props.size === "lg" ? "set-icon set-icon-lg" : "set-icon"} aria-hidden="true">
      {props.icon}
      {props.step !== undefined && <span className="set-step">{props.step}</span>}
    </span>
  );
}

/*
 * Tên nút ⓘ cố ý không chứa nhãn bên cạnh: tìm ô theo nhãn (`getByLabel`, khớp cả `aria-label`) không được trùng nút ⓘ.
 * Nội dung giải thích đã gắn vào nút qua `aria-describedby`.
 */

/** Đầu mục: `desc` 1 dòng ngắn, `tip` phần giải thích thêm (ⓘ cạnh tiêu đề), `aside` hành động bên phải. */
export function SectionHead(props: {
  title: string;
  desc?: ReactNode;
  tip?: ReactNode;
  aside?: ReactNode;
  icon?: ReactNode;
}) {
  const { t } = useT();
  return (
    <header className="set-head">
      {props.icon && <IconTile icon={props.icon} size="lg" />}
      <div className="set-head-text">
        <div className="set-title-line">
          <h2>{props.title}</h2>
          {props.tip && <InfoTip label={t("admin.settingsUi.sectionTip")}>{props.tip}</InfoTip>}
        </div>
        {props.desc && <p className="set-desc">{props.desc}</p>}
      </div>
      {props.aside && <div className="set-head-aside">{props.aside}</div>}
    </header>
  );
}

/**
 * Một nhóm = một thẻ: đầu thẻ (ô icon + tiêu đề + mô tả 1 dòng + `aside`) và thân chứa các hàng (`children`, bỏ trống =
 * thẻ chỉ có đầu). `collapsible`: cả đầu thẻ bấm được để mở / gập (nút nằm trong tiêu đề, phủ cả đầu thẻ; mặc định gập
 * mỗi lần gắn), khi gập hiện `summary` bên phải. Thân gập chỉ bị `hidden` (không gỡ) → trạng thái bên trong còn nguyên;
 * ô đang sửa đã lưu khi rời ô lúc bấm nút gập.
 */
export function SetGroup(props: {
  title: string;
  desc?: ReactNode;
  tip?: ReactNode;
  children?: ReactNode;
  label?: string;
  icon?: ReactNode;
  step?: number;
  aside?: ReactNode;
  collapsible?: boolean;
  summary?: ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const shown = !props.collapsible || open;
  return (
    <section
      className="set-group"
      aria-label={props.label ?? props.title}
      data-collapsible={props.collapsible || undefined}
      data-open={(props.collapsible && open) || undefined}
    >
      <div className="set-group-head">
        {props.icon && <IconTile icon={props.icon} step={props.step} />}
        <div className="set-group-text">
          <div className="set-title-line">
            <h3>
              {props.collapsible ? (
                <button
                  type="button"
                  className="set-group-toggle"
                  aria-expanded={open}
                  aria-controls={cardId}
                  onClick={() => setOpen((o) => !o)}
                >
                  {props.title}
                </button>
              ) : (
                props.title
              )}
            </h3>
            {props.tip && <InfoTip label={t("admin.settingsUi.groupTip")}>{props.tip}</InfoTip>}
          </div>
          {props.desc && <p className="set-desc">{props.desc}</p>}
        </div>
        {!shown && props.summary && <span className="set-group-summary">{props.summary}</span>}
        {props.aside && <div className="set-group-aside">{props.aside}</div>}
        {props.collapsible && (
          <span className="set-chevron" aria-hidden="true">
            <ChevronDownIcon />
          </span>
        )}
      </div>
      {props.children !== undefined && props.children !== false && (
        <div className="set-card" id={cardId} hidden={!shown}>
          {props.children}
        </div>
      )}
    </section>
  );
}

/**
 * Hàng: `htmlFor` nối nhãn với ô; `desc` nằm trong ⓘ cạnh nhãn, phần nội dung có id `descId(htmlFor)` để ô trỏ
 * `aria-describedby` vào → tên truy cập của ô chỉ là nhãn, lời giải thích là mô tả.
 */
export const descId = (id: string) => `${id}-desc`;
export function SetRow(props: { label: ReactNode; htmlFor?: string; desc?: ReactNode; children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="set-row">
      <div className="set-row-label">
        {props.htmlFor ? <label htmlFor={props.htmlFor}>{props.label}</label> : <span>{props.label}</span>}
        {props.desc && (
          <InfoTip label={t("admin.settingsUi.rowTip")} id={props.htmlFor ? descId(props.htmlFor) : undefined}>
            {props.desc}
          </InfoTip>
        )}
      </div>
      <div className="set-row-control">{props.children}</div>
    </div>
  );
}

/** Trạng thái tự lưu ở đầu mục. */
export function SaveStatus(props: { pending: boolean; error: string | null; saved: boolean }) {
  const { t } = useT();
  if (props.pending)
    return (
      <span className="muted small" role="status">
        {t("common.saving")}
      </span>
    );
  if (props.error)
    return (
      <span className="error small" role="alert">
        {props.error}
      </span>
    );
  if (props.saved)
    return (
      <span className="set-saved small" role="status">
        {t("common.saved")}
      </span>
    );
  return null;
}
