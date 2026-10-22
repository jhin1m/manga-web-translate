import { describe, expect, it } from "vitest";
import { primaryAction } from "./primary-action.ts";

const base = { sourceFiles: 3, skippedFiles: 0, pendingFiles: 0, upload: null, pages: 10, ready: 4, failed: 0 };

describe("primary action", () => {
  it("draft without (all) files → Tải ảnh", () => {
    expect(primaryAction({ ...base, status: "draft", sourceFiles: 0, pages: 0 })).toMatchObject({
      command: "upload",
      label: "Tải ảnh",
      disabled: false,
    });
    const incomplete = { phase: "incomplete" as const, done: 1, total: 3 };
    expect(primaryAction({ ...base, status: "draft", upload: incomplete, pendingFiles: 2, pages: 0 }).command).toBe(
      "upload",
    );
  });

  it("upload failed / unfinished but every missing image was deleted → Bước 1", () => {
    for (const phase of ["failed", "incomplete"] as const) {
      const upload = { phase, done: 2, total: 3 };
      expect(
        primaryAction({ ...base, status: "draft", upload, sourceFiles: 2, skippedFiles: 1, pendingFiles: 0, pages: 0 }),
      ).toMatchObject({ command: "commit", disabled: false });
    }
  });

  it("every image skipped → Bước 1 disabled until one is restored (not a new upload)", () => {
    for (const status of ["draft", "partial_failed"] as const) {
      expect(primaryAction({ ...base, status, sourceFiles: 0, skippedFiles: 2, pages: 0 })).toMatchObject({
        command: "commit",
        disabled: true,
        title: "Đã bỏ hết ảnh — khôi phục ít nhất 1 ảnh",
      });
    }
  });

  it("draft while uploading → Bước 1 disabled until every file is up", () => {
    const uploading = { phase: "uploading" as const, done: 1, total: 3 };
    expect(primaryAction({ ...base, status: "draft", upload: uploading, pages: 0 })).toMatchObject({
      command: "commit",
      disabled: true,
      title: "Chờ tải xong ảnh (1/3)",
    });
  });

  it("draft with every file → Bước 1 (cut + clean + OCR), never automatic", () => {
    const uploaded = { phase: "uploaded" as const, done: 3, total: 3 };
    for (const upload of [uploaded, null]) {
      expect(primaryAction({ ...base, status: "draft", upload, pages: 0 })).toMatchObject({
        command: "commit",
        label: "Bước 1 · Xoá chữ + OCR",
        disabled: false,
        menu: [],
      });
    }
  });

  it("prepared → Bước 2 · Dịch; failed pages can be re-run from the menu", () => {
    expect(primaryAction({ ...base, status: "prepared", ready: 0 })).toMatchObject({
      command: "translate",
      label: "Bước 2 · Dịch",
      disabled: false,
      menu: [],
    });
    expect(primaryAction({ ...base, status: "prepared", ready: 0, failed: 2 }).menu).toEqual([
      { command: "retry", label: "Chạy lại trang lỗi" },
    ]);
  });

  it("ingesting / processing → Xuất disabled (progress lives in the status chip), cancel in the menu", () => {
    const p = primaryAction({ ...base, status: "processing" });
    expect(p).toMatchObject({ command: "export", label: "Xuất", disabled: true });
    expect(p.menu.map((m) => m.command)).toEqual(["cancel"]);
    expect(primaryAction({ ...base, status: "ingesting", pages: 0 })).toMatchObject({
      command: "export",
      disabled: true,
    });
  });

  it("partial_failed → Chạy lại trang lỗi; menu Xuất + Dịch lại", () => {
    const p = primaryAction({ ...base, status: "partial_failed" });
    expect(p).toMatchObject({ command: "retry", label: "Chạy lại trang lỗi" });
    expect(p.menu.map((m) => m.command)).toEqual(["export", "retranslate"]);
  });

  it("partial_failed without pages (ingest failed) → Chạy lại bước 1 (commit lại), not the no-op retry", () => {
    const p = primaryAction({ ...base, status: "partial_failed", pages: 0, ready: 0, sourceFiles: 3 });
    expect(p).toMatchObject({ command: "commit", label: "Chạy lại bước 1", disabled: false, menu: [] });
    const none = primaryAction({ ...base, status: "partial_failed", pages: 0, ready: 0, sourceFiles: 0 });
    expect(none).toMatchObject({ command: "upload", label: "Tải ảnh" });
  });

  it("review / done → Xuất; menu Dịch lại cả chương", () => {
    for (const status of ["review", "done"] as const) {
      const p = primaryAction({ ...base, status });
      expect(p).toMatchObject({ command: "export", label: "Xuất", disabled: false });
      expect(p.menu.map((m) => m.command)).toEqual(["retranslate"]);
    }
  });
});
