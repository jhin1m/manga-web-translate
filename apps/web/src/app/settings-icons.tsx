/**
 * Icon nét (kiểu lucide, 16px) cho tiêu đề mục / nhóm của trang Cài đặt và modal Cài đặt dịch, kèm chevron của nhóm
 * gập. Luôn `aria-hidden` — chữ bên cạnh đã là tên.
 */
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Mũi tên xuống của nhóm gập (CSS xoay khi gập). */
export const ChevronDownIcon = () => (
  <Icon>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

/** Series: quyển sách mở. */
export const BookIcon = () => (
  <Icon>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Icon>
);

/** Hướng dẫn cho AI: lấp lánh. */
export const SparklesIcon = () => (
  <Icon>
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
    <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
  </Icon>
);

/** Font: chữ T. */
export const TypeIcon = () => (
  <Icon>
    <path d="M4 7V4h16v3M9 20h6M12 4v16" />
  </Icon>
);

/** Bỏ qua khi dịch: mắt gạch chéo. */
export const EyeOffIcon = () => (
  <Icon>
    <path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49M14.08 14.16a3 3 0 0 1-4.24-4.24M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14M2 2l20 20" />
  </Icon>
);

/** Pipeline: hai khối nối nhau. */
export const WorkflowIcon = () => (
  <Icon>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <path d="M7 11v4a2 2 0 0 0 2 2h4" />
    <rect x="13" y="13" width="8" height="8" rx="2" />
  </Icon>
);

/** Nhà cung cấp AI: phích cắm. */
export const PlugIcon = () => (
  <Icon>
    <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </Icon>
);

/** Người dùng. */
export const UsersIcon = () => (
  <Icon>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    <circle cx="9" cy="7" r="4" />
  </Icon>
);

/** Phát hiện chữ: khung quét. */
export const ScanIcon = () => (
  <Icon>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
  </Icon>
);

/** Đọc chữ (OCR): khung quét có dòng chữ. */
export const ScanTextIcon = () => (
  <Icon>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h8M7 12h10M7 16h6" />
  </Icon>
);

/** Xoá chữ: cục tẩy. */
export const EraserIcon = () => (
  <Icon>
    <path d="M21 21H8a2 2 0 0 1-1.42-.59l-4-4a2 2 0 0 1 0-2.82l10-10a2 2 0 0 1 2.83 0l6 6a2 2 0 0 1 0 2.82L12.83 21M5.08 11.09l8.83 8.83" />
  </Icon>
);

/** Dịch: hai hệ chữ. */
export const LanguagesIcon = () => (
  <Icon>
    <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
  </Icon>
);

/** Hiệu đính: chữ A + dấu kiểm. */
export const SpellCheckIcon = () => (
  <Icon>
    <path d="M6 16l6-12 6 12M8 12h8M16 20l2 2 4-4" />
  </Icon>
);

/** Thêm font: tải lên. */
export const UploadIcon = () => (
  <Icon>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </Icon>
);

/** Font có sẵn: gói. */
export const PackageIcon = () => (
  <Icon>
    <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zM12 22V12M3.29 7 12 12l8.71-5M7.5 4.27l9 5.15" />
  </Icon>
);
