/**
 * Chọn ngôn ngữ giao diện ở cột trái trang Cài đặt — mọi người dùng thấy, ở mọi mục. Đổi là áp ngay (không reload) và
 * nhớ trong trình duyệt. Tên ngôn ngữ luôn viết bằng chính ngôn ngữ đó để ai cũng tìm được.
 */
import { useId, useState } from "react";
import { setLocale } from "../../i18n/i18n-store.ts";
import { isLocale, LOCALES, type Locale } from "../../i18n/locales.ts";
import { useT } from "../../i18n/t.ts";

export function LanguageSettings() {
  const { t, locale } = useT();
  const labelId = useId();
  // Đang tải bảng chuỗi của ngôn ngữ vừa chọn: ô chọn hiện ngay lựa chọn mới thay vì nhảy về ngôn ngữ cũ.
  const [pending, setPending] = useState<Locale | null>(null);
  const [failed, setFailed] = useState(false);

  const choose = (value: string) => {
    if (!isLocale(value) || value === locale) return;
    setPending(value);
    setFailed(false);
    setLocale(value)
      .catch(() => setFailed(true))
      .finally(() => setPending(null));
  };

  return (
    // Cùng khung với nhóm của thanh mục; tên nối bằng `aria-labelledby` vì màn hẹp ẩn tên nhóm.
    <div className="admin-nav-group">
      <span className="admin-nav-title" id={labelId}>
        {t("settings.language.label")}
      </span>
      <select aria-labelledby={labelId} value={pending ?? locale} onChange={(e) => choose(e.target.value)}>
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.native}
          </option>
        ))}
      </select>
      {failed && (
        <span className="error small" role="alert">
          {t("settings.language.loadError")}
        </span>
      )}
    </div>
  );
}
