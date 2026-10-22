import { describe, expect, it } from "vitest";
import type { SourceFileImage } from "./api.ts";
import { sourceCounts, sourceItems, sourceLabel, stepSource } from "./source-rail-model.ts";

const file = (id: string, ord: number, skip: SourceFileImage["skip"] = null): SourceFileImage => ({
  id,
  ord,
  skip,
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

  it("counts skipped images and steps through every image, skipped included", () => {
    const items = sourceItems([file("a", 0), file("b", 1, "user"), file("c", 2)], new Map(), undefined, null);
    expect(sourceCounts(items)).toEqual({ total: 3, skipped: 1, active: 2 });
    expect(stepSource(items, "a", 1)).toBe("b");
    expect(stepSource(items, "c", 1)).toBeUndefined();
    expect(stepSource(items, "a", -1)).toBeUndefined();
    expect(stepSource(items, null, 1)).toBe("a");
  });
});
