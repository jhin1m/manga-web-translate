/**
 * Đường dẫn tương đối của file thả vào, không đổi kiểu `File[]` của các component thả: file lấy qua
 * `FileSystemEntry` (kéo-thả folder) ghi đường dẫn vào WeakMap, file từ `<input webkitdirectory>` đã có
 * `webkitRelativePath`.
 */
import { isJunkEntry, isZip, mimeOf } from "./files.ts";

/** Rác ở bất kỳ cấp nào của đường dẫn (`__MACOSX/` không chỉ ở gốc như trong ZIP). */
export const isJunkPath = (path: string): boolean => isJunkEntry(path) || path.split("/").includes("__MACOSX");

const paths = new WeakMap<File, string>();

/** Đường dẫn tương đối (`folder/sub/001.png`); file thả lẻ → tên file. */
export const relPath = (f: File): string => paths.get(f) ?? (f.webkitRelativePath || f.name);

/** Thư mục chứa trực tiếp file ("" khi file ở gốc). */
export const dirOf = (f: File): string => {
  const p = relPath(f);
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
};

const readBatch = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (isJunkPath(entry.fullPath.replace(/^\//, ""))) return;
  try {
    if (entry.isFile) {
      const f = await fileOf(entry as FileSystemFileEntry);
      paths.set(f, entry.fullPath.replace(/^\//, ""));
      out.push(f);
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // Chrome trả từng lô (~100) → đọc tới khi hết.
    for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
      for (const child of batch) await walk(child, out);
    }
  } catch {
    // Một entry lỗi (không đọc được file / folder) chỉ bỏ entry đó, phần còn lại của lần thả vẫn dùng được.
  }
}

/**
 * Mọi file trong lần thả (đệ quy qua folder). Entry phải lấy đồng bộ trước mọi await vì item của DataTransfer hết hạn
 * sau tick đầu. Trình duyệt không có entry API → `dt.files`.
 */
export async function filesFromDataTransfer(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return [];
  const entries = [...(dt.items ?? [])]
    .filter((i) => i.kind === "file")
    .map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
  const direct = [...dt.files];
  if (!entries.length || entries.some((e) => !e)) return direct;
  const out: File[] = [];
  for (const e of entries) if (e) await walk(e, out);
  return out;
}

/**
 * File dùng được của lần thả: bỏ rác, và file không phải ảnh / ZIP nằm trong folder (.txt, .nfo…). File lẻ ở gốc giữ
 * nguyên để báo lỗi định dạng. Dùng chung cho tạo chương mới và tải tiếp chương nháp.
 */
export const usableFiles = (files: File[]): File[] =>
  files.filter((f) => !isJunkPath(relPath(f)) && (!dirOf(f) || isZip(f) || mimeOf(f.name)));
