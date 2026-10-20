/**
 * Hàng đợi upload: chạy song song `concurrency` file, mỗi file thử lại tối đa `maxAttempts` lần với backoff.
 * File lỗi sau cùng giữ trạng thái `failed` → gọi lại `run` với đúng các file đó (không upload lại file đã xong).
 */
export type ItemStatus = "queued" | "uploading" | "done" | "failed";
export type ItemState = { status: ItemStatus; loaded: number; attempts: number; error: string | null };

export type QueueOptions<T> = {
  concurrency: number;
  maxAttempts: number;
  /** ms chờ trước lần thử thứ n (n ≥ 2). */
  backoff: (attempt: number) => number;
  upload: (item: T, attempt: number, onProgress: (loaded: number) => void) => Promise<void>;
  onChange: (item: T, state: ItemState) => void;
  signal?: AbortSignal;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/** Upload mọi item; trả về item thất bại sau khi hết lượt thử. */
export async function runUploadQueue<T>(items: T[], o: QueueOptions<T>): Promise<T[]> {
  const failed: T[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i] as T;
      let attempt = 0;
      let lastError = "";
      while (attempt < o.maxAttempts && !o.signal?.aborted) {
        attempt++;
        if (attempt > 1) await sleep(o.backoff(attempt), o.signal);
        o.onChange(item, { status: "uploading", loaded: 0, attempts: attempt, error: null });
        try {
          await o.upload(item, attempt, (loaded) =>
            o.onChange(item, { status: "uploading", loaded, attempts: attempt, error: null }),
          );
          o.onChange(item, { status: "done", loaded: Number.POSITIVE_INFINITY, attempts: attempt, error: null });
          lastError = "";
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (lastError || o.signal?.aborted) {
        failed.push(item);
        o.onChange(item, { status: "failed", loaded: 0, attempts: attempt, error: lastError || "đã huỷ" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, items.length) }, worker));
  return failed;
}

export class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** POST multipart theo presigned policy (XHR để có tiến độ upload). */
export function postToPresigned(
  target: { url: string; fields: Record<string, string> },
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(target.fields)) form.append(k, v);
    form.append("file", blob);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", target.url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadHttpError(xhr.status, `storage ${xhr.status}`));
    xhr.onerror = () => reject(new UploadHttpError(0, "mất kết nối"));
    xhr.onabort = () => reject(new UploadHttpError(0, "đã huỷ"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
