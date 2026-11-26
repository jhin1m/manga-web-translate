/**
 * Chip chữ "AI" cạnh mục trí nhớ series do AI tự ghi khi dịch (glossary, xưng hô, Giọng văn). Không có thao tác.
 * Khoảng trắng phía trước tách chip khỏi chữ đứng trước (trình đọc màn hình không đọc dính "민준AI"); phần giải
 * thích nằm ở span ẩn trực quan vì `title` không tới được người dùng bàn phím / màn cảm ứng.
 */
import { useT } from "../i18n/t.ts";

export function AiTag() {
  const { t } = useT();
  return (
    <>
      {" "}
      <span className="ai-tag" title={t("app.aiTag.title")}>
        <span aria-hidden="true">AI</span>
        <span className="sr-only">{t("app.aiTag.srLabel")}</span>
      </span>
    </>
  );
}
