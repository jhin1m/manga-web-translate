import { describe, expect, it } from "vitest";
import type { ExportView } from "./api.ts";
import {
  CBZ_QUALITY,
  EXPORT_POLL_MS,
  exportLabel,
  exportPhase,
  exportPollInterval,
  FORMAT_LABEL,
  latestActiveExport,
  optionsSummary,
  qualityLabel,
  showLayoutChoice,
} from "./export-options.ts";

const view = (over: Partial<ExportView>): ExportView => ({
  id: "x1",
  status: "queued",
  progress: 0,
  stage: null,
  error: null,
  format: "png_zip",
  layout: "original_slices",
  quality: 90,
  include_untranslated: false,
  bytes: null,
  created_at: "2026-10-29T00:00:00Z",
  expires_at: null,
  download_url: null,
  ...over,
});

describe("export options", () => {
  it("CBZ_QUALITY maps Gốc/Cao/Nhẹ to 100/90/75", () => {
    expect(CBZ_QUALITY.original).toEqual({ label: "Gốc", value: 100 });
    expect(CBZ_QUALITY.high).toEqual({ label: "Cao", value: 90 });
    expect(CBZ_QUALITY.light.value).toBe(75);
    expect(qualityLabel(100)).toBe("Gốc");
    expect(qualityLabel(90)).toBe("Cao");
    expect(qualityLabel(75)).toBe("Nhẹ");
    expect(qualityLabel(80)).toBe("chất lượng 80");
  });

  it("summary line says what the file contains", () => {
    const counts = { sources: 96, pages: 30 };
    expect(
      optionsSummary({ format: "png_zip", layout: "original_slices", quality: 90, includeUntranslated: false }, counts),
    ).toBe("Ảnh .zip · 96 ảnh như lúc tải lên");
    expect(optionsSummary({ format: "cbz", layout: "pages", quality: 75, includeUntranslated: true }, counts)).toBe(
      ".cbz · 30 trang đã cắt · Nhẹ · gồm trang chưa dịch",
    );
  });

  it("layout choice hidden when uploads map 1:1 to pages", () => {
    expect(showLayoutChoice({ sources: 12, pages: 12 })).toBe(false);
    expect(showLayoutChoice({ sources: 96, pages: 30 })).toBe(true);
  });

  it("exportPhase follows the pending export", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(exportPhase([view({ status: "running", progress: 0.4 })], "x1", now)).toEqual({
      kind: "running",
      pct: 40,
    });
    expect(
      exportPhase(
        [view({ status: "succeeded", progress: 1, download_url: "/d", expires_at: "2026-11-05T00:00:00Z" })],
        "x1",
        now,
      ),
    ).toEqual({ kind: "ready", id: "x1", url: "/d" });
    expect(
      exportPhase(
        [view({ status: "succeeded", progress: 1, download_url: "/d", expires_at: "2026-10-01T00:00:00Z" })],
        "x1",
        now,
      ),
    ).toEqual({ kind: "expired" });
    expect(exportPhase([view({ status: "failed", error: "hết dung lượng" })], "x1", now)).toEqual({
      kind: "failed",
      error: "hết dung lượng",
    });
    // Hết ngân sách: hàng đợi tự chạy tiếp → vẫn đang chờ, không phải lỗi.
    expect(exportPhase([view({ status: "paused_budget", progress: 0.4 })], "x1", now)).toEqual({
      kind: "running",
      pct: 40,
      paused: true,
    });
    expect(exportPhase([view({ status: "running", progress: 0.4 })], null, now)).toEqual({ kind: "idle" });
    // Danh sách chưa kịp tải lại sau khi gửi job: coi như vừa bắt đầu.
    expect(exportPhase([], "x1", now)).toEqual({ kind: "running", pct: 0 });
  });

  it("no label contains slice or ZIP PNG", () => {
    const texts = [
      ...Object.values(FORMAT_LABEL).flatMap((f) => [f.ext, f.long]),
      ...(["png_zip", "cbz"] as const).flatMap((format) =>
        (["original_slices", "pages"] as const).flatMap((layout) => [
          optionsSummary({ format, layout, quality: 90, includeUntranslated: true }, { sources: 5, pages: 3 }),
          exportLabel(view({ format, layout, include_untranslated: true })),
        ]),
      ),
    ];
    for (const t of texts) expect(t).not.toMatch(/slice|ZIP PNG/i);
  });

  it("history label names the format, layout and CBZ quality", () => {
    expect(exportLabel(view({ format: "png_zip", layout: "original_slices" }))).toBe(".zip · như lúc tải lên");
    expect(exportLabel(view({ format: "cbz", layout: "pages", quality: 90, include_untranslated: true }))).toBe(
      ".cbz · theo trang đã cắt · Cao · gồm trang chưa dịch",
    );
  });

  it("reopening the drawer picks up the newest export still running", () => {
    const list = [
      view({ id: "x3", status: "succeeded" }),
      view({ id: "x2", status: "running" }),
      view({ id: "x1", status: "queued" }),
    ];
    expect(latestActiveExport(list)?.id).toBe("x2");
    expect(latestActiveExport([view({ status: "failed" }), view({ status: "cancelled" })])).toBeNull();
    expect(latestActiveExport(undefined)).toBeNull();
  });

  it("polling keeps going through a failed request while an export is running", () => {
    const running = { exports: [view({ status: "running" })] };
    expect(exportPollInterval({ data: running, status: "success" })).toBe(EXPORT_POLL_MS);
    expect(exportPollInterval({ data: running, status: "error" })).toBe(EXPORT_POLL_MS);
    expect(exportPollInterval({ data: { exports: [view({ status: "succeeded" })] }, status: "error" })).toBe(false);
    expect(exportPollInterval({ data: undefined, status: "error" })).toBe(false);
  });
});
