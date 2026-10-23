import { describe, expect, it, vi } from "vitest";
import { toPageFile } from "./files.ts";
import { createUploadManager, type UploadDeps } from "./upload-manager.ts";

const png = (name: string, size = 10) => toPageFile(name, new Blob([new Uint8Array(size)]));

/** Map giả localStorage. */
const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const target = (id: string, ord: number) => ({
  id,
  ord,
  url: "http://files.test/upload",
  fields: {},
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
});

/** Server + storage giả: ghi lại body createChapter, số lần presign, và mỗi lần POST file. */
function fakeServer(post: (fileId: string, attempt: number) => Promise<void> = async () => {}) {
  const calls = {
    create: [] as string[][],
    createFiles: [] as Parameters<UploadDeps["createChapter"]>[1]["files"][],
    presign: [] as string[][],
    post: [] as string[],
  };
  const attempts = new Map<string, number>();
  const deps: UploadDeps = {
    createChapter: async (_ws, body) => {
      calls.create.push(body.files.map((f) => f.name));
      calls.createFiles.push(body.files);
      return {
        chapter: {
          id: "ch-1",
          series_id: body.series_id,
          number: body.number,
          title: "",
          status: "draft",
          locked_by: null,
          created_at: "",
          updated_at: "",
        },
        files: body.files.map((f, ord) => ({ ...target(`f${ord}`, ord), name: f.name })),
      };
    },
    presignAgain: async (_ws, _ch, ids) => {
      calls.presign.push(ids);
      return { files: ids.map((id) => target(id, Number(id.slice(1)))) };
    },
    post: async (t) => {
      const n = (attempts.get(t.id) ?? 0) + 1;
      attempts.set(t.id, n);
      calls.post.push(t.id);
      await post(t.id, n);
    },
    storage: memoryStorage(),
    backoff: () => 0,
    fingerprints: async (blobs) => blobs.map(() => null),
  };
  return { deps, calls };
}

type Manager = ReturnType<typeof createUploadManager>;
type Upload = NonNullable<ReturnType<Manager["store"]["getState"]>["chapters"][string]>;

const until = (m: Manager, id: string, ok: (u: Upload) => boolean) =>
  new Promise<void>((resolve) => {
    const check = () => {
      const u = m.store.getState().chapters[id];
      if (u && ok(u)) {
        unsub();
        resolve();
      }
    };
    const unsub = m.store.subscribe(check);
    check();
  });
const settled = (m: Manager, id: string) => until(m, id, (u) => u.phase === "uploaded" || u.phase === "failed");

describe("upload manager", () => {
  it("sends files to createChapter in natural order, without ZIP junk", async () => {
    const { deps, calls } = fakeServer();
    const m = createUploadManager(deps);
    await m.startNewChapter({
      ws: "w",
      seriesId: "s",
      number: "1",
      pages: [png("10.png"), png("__MACOSX/._9.png"), png("9.png"), png("1.png")],
    });
    expect(calls.create).toEqual([["1.png", "9.png", "10.png"]]);
    await settled(m, "ch-1");
  });

  it("sends each image's fingerprint in page order; leaves it out when it could not be computed", async () => {
    const { deps, calls } = fakeServer();
    const seen: number[] = [];
    deps.fingerprints = async (blobs) =>
      blobs.map((b) => {
        seen.push(b.size);
        return b.size === 2 ? null : { dhash: "0f0f0f0f0f0f0f0f", width: b.size, height: 100 };
      });
    const m = createUploadManager(deps);
    await m.startNewChapter({ ws: "w", seriesId: "s", number: "1", pages: [png("2.png", 2), png("1.png", 1)] });
    expect(seen).toEqual([1, 2]);
    expect(calls.createFiles[0]).toEqual([
      { name: "1.png", content_type: "image/png", bytes: 1, dhash: "0f0f0f0f0f0f0f0f", width: 1, height: 100 },
      { name: "2.png", content_type: "image/png", bytes: 2 },
    ]);
    await settled(m, "ch-1");
  });

  it("still creates the chapter when fingerprinting fails outright", async () => {
    const { deps, calls } = fakeServer();
    deps.fingerprints = async () => {
      throw new Error("decode");
    };
    const m = createUploadManager(deps);
    await m.startNewChapter({ ws: "w", seriesId: "s", number: "1", pages: [png("1.png", 3)] });
    expect(calls.createFiles[0]).toEqual([{ name: "1.png", content_type: "image/png", bytes: 3 }]);
    await settled(m, "ch-1");
  });

  it("resolves chapterId before the upload finishes, then reaches uploaded", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { deps } = fakeServer(() => gate);
    const m = createUploadManager(deps);
    const { chapterId } = await m.startNewChapter({ ws: "w", seriesId: "s", number: "1", pages: [png("1.png")] });
    expect(chapterId).toBe("ch-1");
    expect(m.store.getState().chapters[chapterId]?.phase).toBe("uploading");
    expect(m.view(chapterId)).toEqual({ phase: "uploading", done: 0, total: 1 });
    // Trạng thái từng file cho rail ảnh gốc.
    expect(Object.values(m.store.getState().chapters[chapterId]?.files ?? {})).toEqual(["uploading"]);
    release();
    await settled(m, chapterId);
    expect(m.store.getState().chapters[chapterId]).toMatchObject({ phase: "uploaded", done: 1, total: 1 });
    expect(Object.values(m.store.getState().chapters[chapterId]?.files ?? {})).toEqual(["done"]);
    // Xong hết → dấu resume bị xoá.
    expect(deps.storage?.getItem("mtl.upload.ch-1")).toBeNull();
  });

  it("re-signs on retry: a file failing twice then succeeding ends uploaded", async () => {
    const { deps, calls } = fakeServer(async (id, attempt) => {
      if (id === "f1" && attempt < 3) throw new Error("mất kết nối");
    });
    const m = createUploadManager(deps);
    await m.startNewChapter({ ws: "w", seriesId: "s", number: "1", pages: [png("1.png"), png("2.png")] });
    await settled(m, "ch-1");
    expect(calls.presign).toEqual([["f1"], ["f1"]]);
    expect(calls.post.filter((id) => id === "f1")).toHaveLength(3);
    expect(m.store.getState().chapters["ch-1"]?.phase).toBe("uploaded");
  });

  it("resumes only missing files, and refuses a set whose bytes differ", async () => {
    const { deps, calls } = fakeServer();
    deps.storage?.setItem("mtl.upload.ch-9", JSON.stringify({ total: 3, done: ["f0"] }));
    const m = createUploadManager(deps);
    const chapter = {
      id: "ch-9",
      source_files: [
        { id: "f0", ord: 0, bytes: 10 },
        { id: "f1", ord: 1, bytes: 10 },
        { id: "f2", ord: 2, bytes: 20 },
      ],
    };
    expect(m.view("ch-9")).toEqual({ phase: "incomplete", done: 1, total: 3 });
    // Tab cũ: id đã lên storage lấy từ dấu localStorage.
    expect(m.uploadedIds("ch-9")).toEqual(new Set(["f0"]));
    expect(() => m.resumeChapter({ ws: "w", chapter, pages: [png("1.png"), png("2.png"), png("3.png", 10)] })).toThrow(
      /khác dung lượng/,
    );
    expect(() => m.resumeChapter({ ws: "w", chapter, pages: [png("1.png")] })).toThrow(/3 ảnh/);
    expect(calls.post).toEqual([]);

    const r = m.resumeChapter({ ws: "w", chapter, pages: [png("3.png", 20), png("2.png"), png("1.png")] });
    expect(r.uploading).toBe(2);
    // Lượt thứ 2 chồng lên lượt đang chạy bị từ chối (không để lượt xong trước báo "uploaded" sớm).
    expect(() => m.resumeChapter({ ws: "w", chapter, pages: [png("3.png", 20), png("2.png"), png("1.png")] })).toThrow(
      /đang tải/,
    );
    await settled(m, "ch-9");
    expect(calls.post.sort()).toEqual(["f1", "f2"]);
    expect(m.store.getState().chapters["ch-9"]).toMatchObject({ phase: "uploaded", done: 3, total: 3 });
    expect(m.uploadedIds("ch-9")).toEqual(new Set(["f0", "f1", "f2"]));
  });

  it("resume matches dropped files by creation order even after the user reordered the images", async () => {
    const { deps, calls } = fakeServer();
    const m = createUploadManager(deps);
    // Tạo theo thứ tự f0 < f1 < f2 (uuid v7); người dùng kéo ảnh cuối lên đầu → ord đổi, id không đổi.
    const chapter = {
      id: "ch-7",
      source_files: [
        { id: "f2", ord: 0, bytes: 20 },
        { id: "f0", ord: 1, bytes: 10 },
        { id: "f1", ord: 2, bytes: 11 },
      ],
    };
    const r = m.resumeChapter({ ws: "w", chapter, pages: [png("1.png"), png("2.png", 11), png("3.png", 20)] });
    expect(r.uploading).toBe(3);
    await settled(m, "ch-7");
    expect(m.localFiles("ch-7").size).toBe(3);
    expect([...m.localFiles("ch-7").keys()]).toEqual(["f0", "f1", "f2"]);
    expect(calls.post.sort()).toEqual(["f0", "f1", "f2"]);
  });

  it("progress ticks keep the per-file map object; only status changes replace it", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { deps } = fakeServer();
    deps.post = async (_t, _blob, onProgress) => {
      for (const loaded of [1, 2, 3]) onProgress(loaded);
      await gate;
    };
    const m = createUploadManager(deps);
    const seen: unknown[] = [];
    m.store.subscribe((st) => seen.push(st.chapters["ch-1"]?.files));
    await m.startNewChapter({ ws: "w", seriesId: "s", number: "1", pages: [png("1.png")] });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(4));
    release();
    await settled(m, "ch-1");
    // Nhiều lần publish (tiến độ) nhưng chỉ vài object: uploading → done.
    expect(seen.length).toBeGreaterThan(new Set(seen).size);
    expect(Object.values(m.store.getState().chapters["ch-1"]?.files ?? {})).toEqual(["done"]);
  });
});
