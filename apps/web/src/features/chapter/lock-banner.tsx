import { useT } from "../../i18n/t.ts";
import type { LockState } from "./use-chapter-lock.ts";

/** Trạng thái khoá chương ở tab ghi nội dung (Tìm/Thay, Áp glossary): chỉ hiện khi chưa giữ được khoá. */
export function LockBanner({ state, onRetry }: { state: LockState; onRetry(): void }) {
  const { t } = useT();
  if (state.status === "held") return null;
  if (state.status === "acquiring") return <p className="notice info">{t("chapter.lockBanner.acquiring")}</p>;
  if (state.status === "denied")
    return (
      <p className="notice">
        {t("chapter.lockBanner.denied")}{" "}
        <button type="button" className="btn-ghost" onClick={onRetry}>
          {t("common.retry")}
        </button>
      </p>
    );
  return (
    <p className="notice danger">
      {t("chapter.lockBanner.failed", { message: state.message })}{" "}
      <button type="button" className="btn-ghost" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </p>
  );
}
