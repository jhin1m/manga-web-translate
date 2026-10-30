import { describe, expect, it } from "vitest";
import type { SourceFileImage } from "./api.ts";
import {
  creditHints,
  type IngestView,
  ingestTag,
  moveItem,
  sourceCounts,
  sourceItems,
  sourceLabel,
  stepSource,
} from "./source-rail-model.ts";

const file = (
  id: string,
  ord: number,
  skip: SourceFileImage["skip"] = null,
  width: number | null = null,
): SourceFileImage => ({
  id,
  ord,
  skip,
  width,
  url: `https://files/${id}`,
});

describe("source rail model", () => {
  it("orders by upload order and prefers the local blob over the signed url", () => {
    const items = sourceItems(
      [file("b", 4), file("a", 0)],
      new Map([["b", "blob:b"]]),
      { a: "done", b: "uploading" },
      null,
    );
    // "Ảnh n" theo vị trí (ord thủng sau khi commit loại file hỏng vẫn đánh 1, 2…).
    expect(items.map((it) => [it.id, it.n, it.url, it.upload])).toEqual([
      ["a", 1, "https://files/a", "done"],
      ["b", 2, "blob:b", "uploading"],
    ]);
  });

  it("labels skip before upload state; finished or foreign uploads have no label", () => {
    const labels = sourceItems(
      [file("u", 0, "user"), file("c", 1, "credit"), file("f", 2), file("d", 3), file("x", 4)],
      new Map(),
      { u: "uploading", f: "failed", d: "done" },
      null,
    ).map(sourceLabel);
    expect(labels).toEqual([
      { label: "Đã xoá", tone: "muted" },
      { label: "Credit · tự bỏ", tone: "muted" },
      { label: "Tải lỗi", tone: "danger" },
      null,
      null,
    ]);
  });

  it("files a previous tab never finished uploading are labelled Chưa tải", () => {
    const items = sourceItems([file("a", 0), file("b", 1)], new Map(), undefined, new Set(["a"]));
    expect(items.map(sourceLabel)).toEqual([null, { label: "Chưa tải", tone: "warn" }]);
  });

  it("hints credit only for the first / last 3 images whose width is more than 10% off the median", () => {
    const w = [690, 800, 800, 800, 600, 800, 800, 800, 880, 900];
    // 690 (−13.75%) đầu, 900 (+12.5%) cuối → gợi ý; 600 ở giữa → không; 880 (+10%) không vượt ngưỡng.
    expect(creditHints(w)).toEqual([true, false, false, false, false, false, false, false, false, true]);
    expect(creditHints([null, 800, 800, 800, 800, null])).toEqual(Array(6).fill(false));
    expect(creditHints([])).toEqual([]);
    // Trung vị số chẵn = trung bình 2 giữa: (800 + 1000) / 2 = 900 → 1000 lệch 11%.
    expect(creditHints([800, 1000])).toEqual([true, true]);
  });

  it("the credit hint shows after skip and upload labels", () => {
    const files = [
      file("a", 0, null, 500),
      file("b", 1, null, 800),
      file("c", 2, "user", 500),
      file("d", 3, null, 800),
    ];
    const items = sourceItems([...files, file("e", 4, null, 800)], new Map(), { d: "uploading" }, null);
    expect(items.map(sourceLabel)).toEqual([
      { label: "Có thể là credit", tone: "warn" },
      null,
      { label: "Đã xoá", tone: "muted" },
      { label: "Đang tải", tone: "busy" },
      null,
    ]);
  });

  it("counts skipped images and steps through every image, skipped included", () => {
    const items = sourceItems([file("a", 0), file("b", 1, "user"), file("c", 2)], new Map(), undefined, null);
    expect(sourceCounts(items)).toEqual({ total: 3, skipped: 1, active: 2 });
    expect(stepSource(items, "a", 1)).toBe("b");
    expect(stepSource(items, "c", 1)).toBeUndefined();
    expect(stepSource(items, "a", -1)).toBeUndefined();
    expect(stepSource(items, null, 1)).toBe("a");
  });
});

describe("moveItem", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves forward, backward, to the ends, and never mutates the input", () => {
    expect(moveItem(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(ids, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(ids, 2, 0)).toEqual(["c", "a", "b", "d"]);
    expect(moveItem(ids, 1, 3)).toEqual(["a", "c", "d", "b"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("clamps the target and returns the same array when nothing changes", () => {
    expect(moveItem(ids, 1, -5)).toEqual(["b", "a", "c", "d"]);
    expect(moveItem(ids, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveItem(ids, 2, 2)).toBe(ids);
    expect(moveItem(ids, 0, -1)).toBe(ids);
    expect(moveItem(ids, 3, 9)).toBe(ids);
    expect(moveItem(ids, 7, 0)).toBe(ids);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
});

describe("ingest tags", () => {
  const ing = (over: Partial<IngestView>): IngestView => ({
    stage: "download",
    progress: 0.2,
    done: 3,
    total: 5,
    label: "Đang tải ảnh 3/5",
    ...over,
  });

  it("downloaded images are marked while ingest downloads", () => {
    expect(ingestTag(1, ing({})).label).toBe("Đã tải");
    expect(ingestTag(3, ing({})).label).toBe("Đang tải");
    expect(ingestTag(4, ing({})).label).toBe("Chờ");
    for (const i of [0, 3, 4]) expect(ingestTag(i, ing({ stage: "cut", done: 1, total: 2 })).label).toBe("Đang xử lý");
    // Job còn xếp hàng / worker cũ không đếm → không đoán ảnh nào đã tải.
    expect(ingestTag(0, ing({ stage: null, done: null, total: null })).label).toBe("Đang xử lý");
    expect(ingestTag(0, ing({ done: null, total: null })).label).toBe("Đang xử lý");
  });
});
