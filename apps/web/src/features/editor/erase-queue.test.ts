import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api.ts";
import { type BBoxTuple, createEraseQueue, type EraseDeps } from "./erase-queue.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(opts: { pageRev?: number | null } = {}) {
  let rev = 10;
  const states: { pending: number; error: string | null }[] = [];
  const starts: number[] = [];
  const erased = vi.fn();
  const waits = new Map<string, (ok: boolean) => void>();
  const deps: EraseDeps = {
    start: vi.fn(async (_page, body) => {
      starts.push(body.base_clean_rev);
      return { job: { id: `j${starts.length}`, status: "queued" } };
    }),
    wait: (id, signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
        waits.set(id, (ok) =>
          resolve(
            ok
              ? { id, status: "succeeded", result: { type: "page.reinpaint", clean_rev: ++rev } }
              : { id, status: "failed", error: "không thấy chữ trong khung để xoá" },
          ),
        );
      }),
    cleanRev: () => (opts.pageRev === undefined ? 10 : opts.pageRev),
    onErased: erased,
    onState: (s) => states.push(s),
    errorText: (e) => (e instanceof Error ? e.message : String(e)),
  };
  /** Kết thúc job đang chờ (theo thứ tự tạo). */
  const finish = async (id: string, ok = true) => {
    await flush();
    waits.get(id)?.(ok);
    await flush();
  };
  return { deps, states, starts, erased, finish };
}

const B: BBoxTuple = [1, 2, 30, 40];

describe("createEraseQueue", () => {
  it("runs boxes one at a time, each on the clean rev the previous job produced", async () => {
    const h = harness();
    const q = createEraseQueue("p1", h.deps);
    q.push(B);
    q.push(B);
    q.push(B);
    await flush();
    expect(h.starts).toEqual([10]);
    expect(h.states.at(-1)).toEqual({ pending: 3, error: null });
    await h.finish("j1");
    expect(h.starts).toEqual([10, 11]);
    await h.finish("j2");
    await h.finish("j3");
    expect(h.starts).toEqual([10, 11, 12]);
    expect(h.erased).toHaveBeenCalledTimes(3);
    expect(h.states.at(-1)).toEqual({ pending: 0, error: null });
  });

  it("409 clean_rev_changed → retries once with the server's rev", async () => {
    const h = harness();
    const start = vi.mocked(h.deps.start);
    start.mockRejectedValueOnce(new ApiError(409, "conflict", { error: "clean_rev_changed", clean_rev: 15 }));
    const q = createEraseQueue("p1", h.deps);
    q.push(B);
    await flush();
    expect(start.mock.calls.map((c) => c[1].base_clean_rev)).toEqual([10, 15]);
    await h.finish("j1");
    expect(h.erased).toHaveBeenCalledTimes(1);
  });

  it("a failed job reports its error and the queue keeps going", async () => {
    const h = harness();
    const q = createEraseQueue("p1", h.deps);
    q.push(B);
    q.push(B);
    await h.finish("j1", false);
    expect(h.states.some((s) => s.error === "không thấy chữ trong khung để xoá")).toBe(true);
    await h.finish("j2");
    // Lần lỗi không tạo rev mới → lần sau vẫn dựng trên rev 10.
    expect(h.starts).toEqual([10, 10]);
    expect(h.erased).toHaveBeenCalledTimes(1);
  });

  it("dispose stops sending and waiting (the job already sent is left to finish on the server)", async () => {
    const h = harness();
    const q = createEraseQueue("p1", h.deps);
    q.push(B);
    q.push(B);
    await flush();
    const before = h.states.length;
    q.dispose();
    await flush();
    await flush();
    expect(h.starts).toEqual([10]);
    expect(h.erased).not.toHaveBeenCalled();
    expect(h.states.length).toBe(before);
  });

  it("page without a clean image → error, no request", async () => {
    const h = harness({ pageRev: null });
    const q = createEraseQueue("p1", h.deps);
    q.push(B);
    await flush();
    await flush();
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.states.at(-1)).toEqual({ pending: 0, error: "Trang chưa có ảnh đã xoá chữ." });
  });
});
