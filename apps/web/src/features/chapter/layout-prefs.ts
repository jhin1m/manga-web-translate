/**
 * Bố cục màn chương không nhớ panel nào đang mở: panel đóng mặc định và tự mở theo ngữ cảnh (chọn khối, AI có bản
 * mới, xung đột khi lưu). Khoá `mtl.layout` của bản cũ ({ panel } — luôn mở lại panel đã nhớ) bị xoá khi vào màn chương
 * để mặc định đóng có hiệu lực.
 */
const LEGACY_LAYOUT_KEY = "mtl.layout";

export function clearLegacyLayout(storage: Pick<Storage, "removeItem"> | undefined = safeStorage()) {
  try {
    storage?.removeItem(LEGACY_LAYOUT_KEY);
  } catch {
    // Không ghi được (chế độ riêng tư) → không có gì để dọn.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
