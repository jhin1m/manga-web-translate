import { FontSettings } from "../features/fonts/font-settings.tsx";

/** Font của tôi: font tuỳ chỉnh của riêng người dùng (menu tài khoản). */
export function FontsPage() {
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Font của tôi</h1>
      </div>
      <div className="tab-panel">
        <FontSettings />
      </div>
    </div>
  );
}
