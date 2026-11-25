import { FontLibrary } from "../features/fonts/font-settings.tsx";
import "../features/admin/admin.css";

/** Font (`/fonts`, menu tài khoản): chỗ duy nhất thêm / xem / xoá font — font trong máy, file, font có sẵn. */
export function FontsPage() {
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Font</h1>
      </div>
      <FontLibrary />
    </div>
  );
}
