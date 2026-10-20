/** Gom file người dùng chọn (ảnh rời và/hoặc ZIP) thành danh sách trang, kiểm sơ bộ để báo sớm (server kiểm lại). */
import { naturalSortBy } from "./natural-sort.ts";

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_FILES = 400;

const TYPES: Record<string, UploadMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
export type UploadMime = "image/png" | "image/jpeg" | "image/webp";

export type PageFile = {
  /** Khoá ổn định cho React (tên có thể trùng giữa các ZIP). */
  key: string;
  /** Đường dẫn gốc (trong ZIP: thư mục/tên) — dùng để sort tự nhiên. */
  name: string;
  blob: Blob;
  size: number;
  contentType: UploadMime | null;
  problem: string | null;
};

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";
export const mimeOf = (name: string): UploadMime | null => TYPES[ext(name)] ?? null;
export const isZip = (f: File) => ext(f.name) === "zip" || f.type === "application/zip";

/** Bỏ rác thường gặp trong ZIP (macOS, thumbnail Windows, file ẩn). */
export function isJunkEntry(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return (
    path.startsWith("__MACOSX/") || base.startsWith(".") || base.toLowerCase() === "thumbs.db" || path.endsWith("/")
  );
}

let seq = 0;
export function toPageFile(name: string, blob: Blob): PageFile {
  const contentType = mimeOf(name);
  const problem = !contentType
    ? "chỉ nhận png/jpg/webp"
    : blob.size > MAX_FILE_BYTES
      ? "vượt 30MB"
      : blob.size === 0
        ? "file rỗng"
        : null;
  return { key: `${++seq}:${name}`, name, blob, size: blob.size, contentType, problem };
}

/** Giải nén ZIP trong Web Worker (không treo tab với ZIP vài trăm MB). */
export function unzipInWorker(file: File, onEntry: (p: PageFile) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./unzip-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<UnzipMessage>) => {
      const m = e.data;
      if (m.type === "entry") onEntry(toPageFile(m.name, m.blob));
      else {
        worker.terminate();
        if (m.type === "done") resolve();
        else reject(new Error(`Không giải nén được ${file.name}: ${m.message}`));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`Không giải nén được ${file.name}: ${e.message}`));
    };
    worker.postMessage(file);
  });
}

export type UnzipMessage =
  | { type: "entry"; name: string; blob: Blob }
  | { type: "done" }
  | { type: "error"; message: string };

/** File chọn → danh sách trang đã sort tự nhiên (ảnh rời theo tên; mỗi ZIP theo đường dẫn trong ZIP). */
export async function collectPages(files: File[]): Promise<PageFile[]> {
  const out: PageFile[] = [];
  const loose = files.filter((f) => !isZip(f));
  out.push(
    ...naturalSortBy(
      loose.map((f) => toPageFile(f.name, f)),
      (p) => p.name,
    ),
  );
  for (const z of naturalSortBy(files.filter(isZip), (f) => f.name)) {
    const entries: PageFile[] = [];
    await unzipInWorker(z, (p) => entries.push(p));
    out.push(...naturalSortBy(entries, (p) => p.name));
  }
  return out;
}

export function listProblems(pages: PageFile[]): string[] {
  const problems: string[] = [];
  if (pages.length > MAX_FILES) problems.push(`Tối đa ${MAX_FILES} file/chương (đang có ${pages.length}).`);
  const bad = pages.filter((p) => p.problem);
  if (bad.length) problems.push(`${bad.length} file không hợp lệ — bỏ chúng trước khi upload.`);
  return problems;
}
