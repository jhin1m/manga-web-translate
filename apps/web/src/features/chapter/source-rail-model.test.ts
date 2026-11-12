import { MIN_TRIM_KEEP_PX } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import type { SourceFileImage } from "./api.ts";
import {
  clampTrim,
  creditHints,
  currentBandTrim,
  type IngestView,
  ingestTag,
  moveItem,
  sourceCounts,
  sourceItems,
  sourceLabel,
  stepSource,
  trimLabel,
} from "./source-rail-model.ts";

const file = (
  id: string,
  ord: number,
  skip: SourceFileImage["skip"] = null,
  width: number | null = null,
  trim: SourceFileImage["trim"] = null,
): SourceFileImage => ({
  id,
  ord,
  skip,
  width,
  trim,
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

describe("clampTrim", () => {
  const H = 1000;

  it("keeps values that leave enough image", () => {
    expect(clampTrim(100, 200, H, "top")).toEqual({ top: 100, bottom: 200 });
    expect(clampTrim(0, 0, H, "bottom")).toEqual({ top: 0, bottom: 0 });
  });

  it("turns negative, fractional and non-finite input into whole non-negative px", () => {
    expect(clampTrim(-5, -1, H, "top")).toEqual({ top: 0, bottom: 0 });
    expect(clampTrim(10.6, 3.2, H, "top")).toEqual({ top: 11, bottom: 3 });
    expect(clampTrim(Number.NaN, Number.POSITIVE_INFINITY, H, "bottom")).toEqual({
      top: 0,
      bottom: H - MIN_TRIM_KEEP_PX,
    });
  });

  it("allows the kept part to shrink to exactly MIN_TRIM_KEEP_PX but no further", () => {
    const max = H - MIN_TRIM_KEEP_PX;
    expect(clampTrim(0, max, H, "bottom")).toEqual({ top: 0, bottom: max });
    expect(clampTrim(0, max + 1, H, "bottom")).toEqual({ top: 0, bottom: max });
  });

  it("pulls back the edge being dragged, never the other one", () => {
    const max = H - MIN_TRIM_KEEP_PX;
    expect(clampTrim(500, 800, H, "bottom")).toEqual({ top: 500, bottom: max - 500 });
    expect(clampTrim(800, 500, H, "top")).toEqual({ top: max - 500, bottom: 500 });
  });

  it("falls back to the other edge when the dragged one alone cannot fix the overflow", () => {
    const max = H - MIN_TRIM_KEEP_PX;
    expect(clampTrim(5000, 100, H, "top")).toEqual({ top: max - 100, bottom: 100 });
    expect(clampTrim(100, 5000, H, "bottom")).toEqual({ top: 100, bottom: max - 100 });
    expect(clampTrim(5000, 5000, H, "top").top + clampTrim(5000, 5000, H, "top").bottom).toBe(max);
  });

  it("an image no taller than the minimum cannot be trimmed", () => {
    expect(clampTrim(10, 10, MIN_TRIM_KEEP_PX, "top")).toEqual({ top: 0, bottom: 0 });
    expect(clampTrim(10, 10, 20, "bottom")).toEqual({ top: 0, bottom: 0 });
    expect(clampTrim(10, 10, 0, "bottom")).toEqual({ top: 0, bottom: 0 });
  });
});

describe("trim labels", () => {
  it("names who set the trim", () => {
    expect(trimLabel({ top: 0, bottom: 40, by: "user" })).toBe("Đã cắt mép");
    expect(trimLabel({ top: 12, bottom: 0, by: "credit" })).toBe("Credit · tự cắt");
  });

  it("flags trimmed images after skip and upload state, before the credit hint", () => {
    const trim = { top: 0, bottom: 40, by: "user" as const };
    const items = sourceItems(
      [
        file("a", 0, "user", 500, trim),
        file("b", 1, null, 500, trim),
        file("c", 2, null, 800),
        file("d", 3, null, 800, trim),
        file("e", 4, null, 800),
      ],
      new Map(),
      { d: "uploading" },
      null,
    );
    expect(items.map(sourceLabel)).toEqual([
      { label: "Đã xoá", tone: "muted" },
      { label: "Đã cắt mép", tone: "trim" },
      null,
      { label: "Đang tải", tone: "busy" },
      null,
    ]);
    expect(items[1]?.trim).toEqual(trim);
  });
});

describe("currentBandTrim", () => {
  it("uses the current value of each requested edge", () => {
    expect(currentBandTrim({ top: 0, bottom: 50 }, { top: 7, bottom: 80 })).toEqual({ top: 0, bottom: 80 });
    expect(currentBandTrim({ top: 20, bottom: 50 }, { top: 30, bottom: 40 })).toEqual({ top: 30, bottom: 40 });
  });
  it("returns null when a requested edge is no longer trimmed", () => {
    expect(currentBandTrim({ top: 0, bottom: 50 }, null)).toBeNull();
    expect(currentBandTrim({ top: 0, bottom: 50 }, { top: 10, bottom: 0 })).toBeNull();
    expect(currentBandTrim({ top: 20, bottom: 50 }, { top: 0, bottom: 50 })).toBeNull();
  });
});
