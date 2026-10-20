import { describe, expect, it } from "vitest";
import { primaryAction } from "./primary-action.ts";

const base = { sourceFiles: 3, upload: null, pages: 10, ready: 4 };

describe("primary action", () => {
  it("draft without (all) files → Tải ảnh", () => {
    expect(primaryAction({ ...base, status: "draft", sourceFiles: 0, pages: 0 })).toMatchObject({
      command: "upload",
      label: "Tải ảnh",
      disabled: false,
    });
    const incomplete = { phase: "incomplete" as const, done: 1, total: 3 };
    expect(primaryAction({ ...base, status: "draft", upload: incomplete, pages: 0 }).command).toBe("upload");
  });

  it("draft while uploading → Dịch chương disabled", () => {
    const uploading = { phase: "uploading" as const, done: 1, total: 3 };
    expect(primaryAction({ ...base, status: "draft", upload: uploading, pages: 0 })).toMatchObject({
      command: "commit",
      disabled: true,
    });
  });

  it("draft with every file → Dịch chương", () => {
    const uploaded = { phase: "uploaded" as const, done: 3, total: 3 };
    for (const upload of [uploaded, null]) {
      expect(primaryAction({ ...base, status: "draft", upload, pages: 0 })).toMatchObject({
        command: "commit",
        label: "Dịch chương",
        disabled: false,
        menu: [],
      });
    }
  });

  it("ingesting / processing → disabled progress, cancel in the menu", () => {
    const p = primaryAction({ ...base, status: "processing" });
    expect(p).toMatchObject({ command: null, label: "Đang dịch 4/10", disabled: true });
    expect(p.menu.map((m) => m.command)).toEqual(["cancel"]);
    expect(primaryAction({ ...base, status: "ingesting", pages: 0 })).toMatchObject({ command: null, disabled: true });
  });

  it("partial_failed → Chạy lại trang lỗi; menu Xuất + Dịch lại", () => {
    const p = primaryAction({ ...base, status: "partial_failed" });
    expect(p).toMatchObject({ command: "retry", label: "Chạy lại trang lỗi" });
    expect(p.menu.map((m) => m.command)).toEqual(["export", "retranslate"]);
  });

  it("review / done → Xuất; menu Dịch lại cả chương", () => {
    for (const status of ["review", "done"] as const) {
      const p = primaryAction({ ...base, status });
      expect(p).toMatchObject({ command: "export", label: "Xuất", disabled: false });
      expect(p.menu.map((m) => m.command)).toEqual(["retranslate"]);
    }
  });
});
