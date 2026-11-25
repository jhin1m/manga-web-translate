/**
 * Số font riêng tối đa mỗi tài khoản (font dùng chung không tính). Bản local chỉ một người dùng, font lấy từ máy nên
 * cho nhiều hơn; bản nhiều người giữ 20 để kho lưu trữ không phình theo số tài khoản.
 */
export const USER_FONT_LIMIT = { hosted: 20, local: 200 } as const;

export const userFontLimit = (localMode: boolean): number =>
  localMode ? USER_FONT_LIMIT.local : USER_FONT_LIMIT.hosted;
