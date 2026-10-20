import { describe, expect, it } from "vitest";
import { isJunkEntry, listProblems, MAX_FILE_BYTES, mimeOf, toPageFile } from "./files.ts";
import { naturalSortBy } from "./natural-sort.ts";
import { type ItemState, runUploadQueue } from "./upload-queue.ts";

describe("natural sort", () => {
  it("orders numbers by value, not by character", () => {
    const names = ["10.png", "2.png", "1.png", "ch1/p10.jpg", "ch1/p9.jpg", "ch2/p1.jpg", "001.png", "Page 3.webp"];
    expect(naturalSortBy(names, (n) => n)).toEqual([
      "1.png",
      "001.png",
      "2.png",
      "10.png",
      "ch1/p9.jpg",
      "ch1/p10.jpg",
      "ch2/p1.jpg",
      "Page 3.webp",
    ]);
  });
});

describe("file checks", () => {
  it("maps extensions to fixed content types", () => {
    expect(mimeOf("a.PNG")).toBe("image/png");
    expect(mimeOf("a.jpeg")).toBe("image/jpeg");
    expect(mimeOf("a.webp")).toBe("image/webp");
    expect(mimeOf("a.gif")).toBeNull();
  });

  it("skips zip junk", () => {
    expect(isJunkEntry("__MACOSX/ch1/._1.png")).toBe(true);
    expect(isJunkEntry("ch1/.DS_Store")).toBe(true);
    expect(isJunkEntry("ch1/Thumbs.db")).toBe(true);
    expect(isJunkEntry("ch1/")).toBe(true);
    expect(isJunkEntry("ch1/1.png")).toBe(false);
  });

  it("flags bad files and the 400-file limit", () => {
    const ok = toPageFile("1.png", new Blob([new Uint8Array(10)]));
    const big = toPageFile("2.png", { size: MAX_FILE_BYTES + 1 } as Blob);
    const gif = toPageFile("3.gif", new Blob([new Uint8Array(10)]));
    expect([ok.problem, big.problem, gif.problem]).toEqual([null, "vượt 30MB", "chỉ nhận png/jpg/webp"]);
    expect(listProblems([ok])).toEqual([]);
    expect(listProblems([ok, big, gif])).toHaveLength(1);
    expect(listProblems(Array.from({ length: 401 }, () => ok))).toHaveLength(1);
  });
});

describe("upload queue", () => {
  const opts = (upload: (n: number, attempt: number) => Promise<void>, log: [number, ItemState][] = []) => ({
    concurrency: 4,
    maxAttempts: 3,
    backoff: () => 0,
    upload: (n: number, attempt: number) => upload(n, attempt),
    onChange: (n: number, s: ItemState) => log.push([n, s]),
  });

  it("never runs more than `concurrency` uploads at once", async () => {
    let active = 0;
    let peak = 0;
    const failed = await runUploadQueue(
      Array.from({ length: 20 }, (_, i) => i),
      opts(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
      }),
    );
    expect(failed).toEqual([]);
    expect(peak).toBe(4);
  });

  it("retries a flaky file, gives up after maxAttempts, and a second run only touches failed items", async () => {
    const calls: number[] = [];
    let online = false;
    const upload = async (n: number, attempt: number) => {
      calls.push(n);
      if (n === 1 && attempt < 2) throw new Error("mất kết nối");
      if (n === 2 && !online) throw new Error("mất kết nối");
    };
    const log: [number, ItemState][] = [];
    const failed = await runUploadQueue([0, 1, 2], opts(upload, log));
    expect(failed).toEqual([2]);
    expect(calls.filter((c) => c === 1)).toHaveLength(2);
    expect(calls.filter((c) => c === 2)).toHaveLength(3);
    expect(log.filter(([n, s]) => n === 2 && s.status === "failed")).toHaveLength(1);

    online = true;
    calls.length = 0;
    expect(await runUploadQueue(failed, opts(upload))).toEqual([]);
    expect(calls).toEqual([2]);
  });
});
