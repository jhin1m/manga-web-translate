/// <reference lib="webworker" />
/**
 * Giải nén ZIP theo luồng (fflate Unzip) trong Web Worker; chỉ giữ entry ảnh, gửi từng entry về main thread.
 * Entry gom lại và chỉ gửi khi cả ZIP đọc xong — streaming lỗi giữa chừng (VD ZIP lạ) thì thử lại bằng `unzip`
 * cả file mà không gửi trùng entry.
 */
import { Unzip, UnzipInflate, unzip } from "fflate";
import { isJunkEntry, mimeOf, type UnzipMessage } from "./files.ts";

const post = (m: UnzipMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const wanted = (name: string) => !isJunkEntry(name) && mimeOf(name) !== null;

type Entry = { name: string; blob: Blob };

async function streamUnzip(file: File): Promise<Entry[]> {
  const out: Entry[] = [];
  let failure: Error | null = null;
  const uz = new Unzip((entry) => {
    if (!wanted(entry.name)) return;
    const chunks: Uint8Array[] = [];
    entry.ondata = (err, data, final) => {
      if (err) {
        failure = err;
        return;
      }
      chunks.push(data);
      if (final) out.push({ name: entry.name, blob: new Blob(chunks as BlobPart[]) });
    };
    entry.start();
  });
  uz.register(UnzipInflate);
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (failure) throw failure;
    if (done) {
      uz.push(new Uint8Array(0), true);
      break;
    }
    uz.push(value);
  }
  if (failure) throw failure;
  return out;
}

function wholeUnzip(file: File): Promise<Entry[]> {
  return file.arrayBuffer().then(
    (buf) =>
      new Promise<Entry[]>((resolve, reject) => {
        unzip(new Uint8Array(buf), { filter: (f) => wanted(f.name) }, (err, files) => {
          if (err) return reject(err);
          resolve(Object.entries(files).map(([name, data]) => ({ name, blob: new Blob([data as BlobPart]) })));
        });
      }),
  );
}

self.onmessage = async (e: MessageEvent<File>) => {
  try {
    const entries = await streamUnzip(e.data).catch(() => wholeUnzip(e.data));
    for (const en of entries) post({ type: "entry", ...en });
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
