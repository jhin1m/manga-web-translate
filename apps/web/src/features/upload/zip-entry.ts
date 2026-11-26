/**
 * Nhận dạng entry ảnh trong file chọn / ZIP + kiểu tin nhắn của worker giải nén. Tách khỏi `files.ts` để
 * `unzip-worker.ts` không kéo theo store i18n (Web Worker không có store ngôn ngữ, chỉ trả lỗi thô cho thread chính).
 */
export type UploadMime = "image/png" | "image/jpeg" | "image/webp";

const TYPES: Record<string, UploadMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";
export const mimeOf = (name: string): UploadMime | null => TYPES[ext(name)] ?? null;

/** Bỏ rác thường gặp trong ZIP (macOS, thumbnail Windows, file ẩn). */
export function isJunkEntry(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return (
    path.startsWith("__MACOSX/") || base.startsWith(".") || base.toLowerCase() === "thumbs.db" || path.endsWith("/")
  );
}

export type UnzipMessage =
  | { type: "entry"; name: string; blob: Blob }
  | { type: "done" }
  | { type: "error"; message: string };
