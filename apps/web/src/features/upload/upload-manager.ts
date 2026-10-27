/**
 * Upload chương chạy nền, sống qua điều hướng (store zustand cấp module): thả file ở home/series → tạo chương →
 * trả `chapterId` ngay để mở màn chương, các file tiếp tục upload song song 4, thử lại 3 lần (ký lại khi thử lại).
 * Upload xong không tự chạy gì: chương ở lại nháp, chờ người dùng bấm "Bước 1" ở màn chương. Trước khi tạo chương tính
 * dấu nhận dạng từng ảnh (dHash + kích thước) để server bỏ qua sẵn ảnh credit series đã học.
 *
 * Tab đóng giữa chừng: localStorage giữ dấu `mtl.upload.<chapterId>` (tổng + id file đã xong); thả lại đúng bộ
 * file → khớp theo thứ tự (natural sort) + bytes với `source_files` theo thứ tự tạo (id uuid v7) → ký lại + upload phần thiếu.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { UploadView } from "../chapter/next-action.ts";
import { createChapter, type PresignedTarget, presignAgain } from "./api.ts";
import { isJunkEntry, type PageFile } from "./files.ts";
import { fingerprintAll } from "./image-fingerprint.ts";
import { naturalSortBy } from "./natural-sort.ts";
import { type ItemState, type ItemStatus, postToPresigned, runUploadQueue } from "./upload-queue.ts";

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const MARKER_PREFIX = "mtl.upload.";

export type ChapterUpload = {
  chapterId: string;
  phase: "uploading" | "uploaded" | "failed";
  total: number;
  done: number;
  bytesTotal: number;
  bytesDone: number;
  errors: { name: string; error: string }[];
  /** Trạng thái tải từng file (id source file) — rail ảnh gốc hiện "Đang tải" / "Lỗi" theo đây. */
  files: Record<string, ItemStatus>;
};

type Marker = { total: number; done: string[] };
type Item = { page: PageFile; fileId: string };
/** Phần không đưa vào store (Blob, target ký): giữ để thử lại file lỗi. */
type Job = {
  items: Item[];
  targets: Map<string, PresignedTarget>;
  states: Map<string, ItemState>;
};

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type UploadDeps = {
  createChapter: typeof createChapter;
  presignAgain: typeof presignAgain;
  post: (target: PresignedTarget, blob: Blob, onProgress: (loaded: number) => void) => Promise<void>;
  storage: KV | null;
  backoff: (attempt: number) => number;
  /** Dấu nhận dạng theo thứ tự trang (null = không tính được, gửi thiếu — không chặn upload). */
  fingerprints: (blobs: Blob[]) => Promise<({ dhash: string; width: number; height: number } | null)[]>;
};

/** Chương nháp tối thiểu cho resume (khớp ChapterDetail). */
export type DraftChapter = { id: string; source_files: { id: string; ord: number; bytes: number }[] };

/** Thứ tự trang = natural sort theo đường dẫn, bỏ rác ZIP (__MACOSX, file ẩn). */
export const orderPages = (pages: PageFile[]) =>
  naturalSortBy(
    pages.filter((p) => !isJunkEntry(p.name)),
    (p) => p.name,
  );

export function createUploadManager(deps: UploadDeps) {
  const store = createStore<{ chapters: Record<string, ChapterUpload> }>()(() => ({ chapters: {} }));
  const jobs = new Map<string, Job>();
  /** Chương đang có lượt upload chạy — chặn resume/thử lại chồng lên (lượt xong trước sẽ báo "uploaded" sai). */
  const active = new Set<string>();

  const readMarker = (id: string): Marker | null => {
    try {
      const raw = deps.storage?.getItem(MARKER_PREFIX + id);
      return raw ? (JSON.parse(raw) as Marker) : null;
    } catch {
      return null;
    }
  };
  const writeMarker = (id: string, m: Marker | null) => {
    try {
      if (m) deps.storage?.setItem(MARKER_PREFIX + id, JSON.stringify(m));
      else deps.storage?.removeItem(MARKER_PREFIX + id);
    } catch {
      // storage bị chặn: chỉ mất khả năng resume sau khi đóng tab
    }
  };

  const publish = (chapterId: string, phase?: ChapterUpload["phase"]) => {
    const job = jobs.get(chapterId);
    if (!job) return;
    let done = 0;
    let bytesDone = 0;
    const errors: ChapterUpload["errors"] = [];
    const files: ChapterUpload["files"] = {};
    for (const it of job.items) {
      const s = job.states.get(it.fileId);
      files[it.fileId] = s?.status ?? "queued";
      if (s?.status === "done") {
        done++;
        bytesDone += it.page.size;
      } else bytesDone += Math.min(it.page.size, s?.loaded ?? 0);
      if (s?.status === "failed") errors.push({ name: it.page.name, error: s.error ?? "lỗi" });
    }
    const prev = store.getState().chapters[chapterId];
    // Sự kiện tiến độ (mỗi vài KB) không đổi trạng thái file nào → giữ object cũ, rail ảnh không vẽ lại mỗi tick.
    const sameFiles =
      prev && Object.keys(files).length === Object.keys(prev.files).length
        ? Object.entries(files).every(([id, st]) => prev.files[id] === st)
        : false;
    store.setState((st) => ({
      chapters: {
        ...st.chapters,
        [chapterId]: {
          chapterId,
          phase: phase ?? prev?.phase ?? "uploading",
          total: job.items.length,
          done,
          bytesTotal: job.items.reduce((n, it) => n + it.page.size, 0),
          bytesDone,
          errors,
          files: sameFiles && prev ? prev.files : files,
        },
      },
    }));
  };

  /** Upload `items` của chương; cập nhật dấu localStorage theo từng file xong. */
  async function run(chapterId: string, items: Item[]) {
    const job = jobs.get(chapterId);
    if (!job || active.has(chapterId)) return;
    active.add(chapterId);
    publish(chapterId, "uploading");
    const failed = await runUploadQueue(items, {
      concurrency: CONCURRENCY,
      maxAttempts: MAX_ATTEMPTS,
      backoff: deps.backoff,
      onChange: (it, s) => {
        job.states.set(it.fileId, s);
        if (s.status === "done") {
          const m = readMarker(chapterId) ?? { total: job.items.length, done: [] };
          if (!m.done.includes(it.fileId)) writeMarker(chapterId, { ...m, done: [...m.done, it.fileId] });
        }
        publish(chapterId);
      },
      upload: async (it, attempt, onProgress) => {
        let target = job.targets.get(it.fileId);
        // Thử lại / chưa có target / policy sắp hết hạn → ký lại (mất mạng lâu làm policy cũ hết hạn).
        if (!target || attempt > 1 || Date.parse(target.expires_at) - Date.now() < 60_000) {
          const [fresh] = (await deps.presignAgain(chapterId, [it.fileId])).files;
          if (!fresh) throw new Error("không ký lại được file");
          target = fresh;
          job.targets.set(it.fileId, fresh);
        }
        await deps.post(target, it.page.blob, onProgress);
      },
    }).finally(() => active.delete(chapterId));
    const allDone = job.items.every((it) => job.states.get(it.fileId)?.status === "done");
    if (allDone) writeMarker(chapterId, null);
    publish(chapterId, failed.length || !allDone ? "failed" : "uploaded");
  }

  return {
    store,

    /** Tạo chương nháp + bắt đầu upload; resolve ngay sau khi có chapterId (upload chạy tiếp ở nền). */
    async startNewChapter(o: { seriesId: string; number: string; title?: string; pages: PageFile[] }) {
      const pages = orderPages(o.pages);
      const fps = await deps.fingerprints(pages.map((p) => p.blob)).catch(() => []);
      const res = await deps.createChapter({
        series_id: o.seriesId,
        number: o.number,
        title: o.title ?? "",
        files: pages.map((p, i) => ({
          name: p.name,
          content_type: p.contentType ?? "",
          bytes: p.size,
          ...(fps[i] ?? {}),
        })),
      });
      const chapterId = res.chapter.id;
      const items: Item[] = [];
      const targets = new Map<string, PresignedTarget>();
      for (const f of res.files) {
        const page = pages[f.ord];
        if (!page) continue;
        items.push({ page, fileId: f.id });
        targets.set(f.id, f);
      }
      items.sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page));
      jobs.set(chapterId, { items, targets, states: new Map() });
      writeMarker(chapterId, { total: items.length, done: [] });
      void run(chapterId, items);
      return { chapterId, chapter: res.chapter };
    },

    /**
     * Tiếp tục chương nháp đã khai báo file: bộ file thả lại phải khớp số lượng + bytes theo thứ tự với
     * `source_files` theo thứ tự khai báo lúc tạo chương (không thì ném lỗi, không upload gì). Chỉ upload file chưa có
     * trong dấu "đã xong". Thứ tự khai báo lấy từ id (uuid v7 sinh tuần tự khi tạo chương), không phải `ord`: `ord` đổi
     * được khi người dùng sắp xếp lại ảnh, còn file thả lại luôn theo thứ tự tên.
     */
    resumeChapter(o: { chapter: DraftChapter; pages: PageFile[] }): { uploading: number } {
      if (active.has(o.chapter.id)) throw new Error("Chương này đang tải ảnh — chờ lượt hiện tại xong.");
      const pages = orderPages(o.pages);
      const files = [...o.chapter.source_files].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (pages.length !== files.length) {
        throw new Error(`Chương nháp có ${files.length} ảnh, bạn thả ${pages.length} ảnh — chọn đúng bộ file đã tải.`);
      }
      const bad = files.findIndex((f, i) => pages[i]?.size !== f.bytes);
      if (bad >= 0) {
        throw new Error(
          `Ảnh thứ ${bad + 1} (${pages[bad]?.name}) khác dung lượng file đã khai báo — chọn đúng bộ file.`,
        );
      }
      const marker = readMarker(o.chapter.id);
      const doneIds = new Set(marker?.done ?? []);
      const items = files.map((f, i) => ({ page: pages[i] as PageFile, fileId: f.id }));
      const states = new Map<string, ItemState>();
      for (const id of doneIds)
        states.set(id, { status: "done", loaded: Number.POSITIVE_INFINITY, attempts: 0, error: null });
      jobs.set(o.chapter.id, { items, targets: new Map(), states });
      writeMarker(o.chapter.id, { total: items.length, done: [...doneIds] });
      const missing = items.filter((it) => !doneIds.has(it.fileId));
      void run(o.chapter.id, missing);
      return { uploading: missing.length };
    },

    /** Thử lại các file lỗi của chương (không upload lại file đã xong). */
    retryFailed(chapterId: string) {
      const job = jobs.get(chapterId);
      if (!job) return;
      void run(
        chapterId,
        job.items.filter((it) => job.states.get(it.fileId)?.status !== "done"),
      );
    },

    /** Trạng thái upload cho bảng "bước tiếp theo": store phiên này, không có thì dấu localStorage (tab cũ). */
    view(chapterId: string, current?: ChapterUpload): UploadView | null {
      const u = current ?? store.getState().chapters[chapterId];
      if (u) return { phase: u.phase, done: u.done, total: u.total };
      const m = readMarker(chapterId);
      return m ? { phase: "incomplete", done: m.done.length, total: m.total } : null;
    },

    /**
     * Id file đã lên storage: phiên này (trạng thái từng file) hoặc dấu localStorage của tab cũ. null = không có
     * upload nào được biết (coi như đủ — server kiểm lại khi commit).
     */
    uploadedIds(chapterId: string, current?: ChapterUpload): Set<string> | null {
      const u = current ?? store.getState().chapters[chapterId];
      if (u) return new Set(Object.entries(u.files).flatMap(([id, st]) => (st === "done" ? [id] : [])));
      const m = readMarker(chapterId);
      return m ? new Set(m.done) : null;
    },

    /** File local của chương upload trong tab này (id source file → Blob) — xem trước không cần chờ tải lên. */
    localFiles(chapterId: string): Map<string, Blob> {
      return new Map((jobs.get(chapterId)?.items ?? []).map((it) => [it.fileId, it.page.blob]));
    },

    anyUploading: () => Object.values(store.getState().chapters).some((c) => c.phase === "uploading"),
  };
}

const safeStorage = (): KV | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const uploadManager = createUploadManager({
  createChapter,
  presignAgain,
  post: (t, blob, onProgress) => postToPresigned(t, blob, onProgress),
  storage: safeStorage(),
  backoff: (n) => 1000 * 2 ** (n - 2),
  fingerprints: (blobs) => fingerprintAll(blobs),
});

// Rời tab khi còn file đang upload → trình duyệt hỏi xác nhận.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!uploadManager.anyUploading()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

/** Upload phiên này của 1 chương (undefined nếu chương không upload trong tab này). */
export const useChapterUpload = (chapterId: string) => useStore(uploadManager.store, (s) => s.chapters[chapterId]);

/** Mọi upload của phiên (cho danh sách nhiều chương). */
export const useUploads = () => useStore(uploadManager.store, (s) => s.chapters);
