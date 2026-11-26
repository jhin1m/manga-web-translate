/** Gom file người dùng chọn (ảnh rời và/hoặc ZIP) thành danh sách trang, kiểm sơ bộ để báo sớm (server kiểm lại). */
import { t, tp } from "../../i18n/t.ts";
import { naturalSortBy } from "./natural-sort.ts";
import { ext, mimeOf, type UnzipMessage, type UploadMime } from "./zip-entry.ts";

export { isJunkEntry, mimeOf, type UnzipMessage, type UploadMime } from "./zip-entry.ts";

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_FILES = 400;

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

export const isZip = (f: File) => ext(f.name) === "zip" || f.type === "application/zip";

let seq = 0;
export function toPageFile(name: string, blob: Blob): PageFile {
  const contentType = mimeOf(name);
  const problem = !contentType
    ? t("upload.files.problemType")
    : blob.size > MAX_FILE_BYTES
      ? t("upload.files.problemSize")
      : blob.size === 0
        ? t("upload.files.problemEmpty")
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
        else reject(new Error(t("upload.files.unzipFailed", { name: file.name, error: m.message })));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(t("upload.files.unzipFailed", { name: file.name, error: e.message })));
    };
    worker.postMessage(file);
  });
}

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
  if (pages.length > MAX_FILES) problems.push(t("upload.files.tooMany", { max: MAX_FILES, count: pages.length }));
  const bad = pages.filter((p) => p.problem);
  if (bad.length) problems.push(tp("upload.files.invalid", bad.length));
  return problems;
}
