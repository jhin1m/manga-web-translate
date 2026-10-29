import { describe, expect, it } from "vitest";
import { STAGE_LABELS, stageLabel } from "./stage-labels.ts";

const job = (type: string, stage: string | null, done: number | null = null, total: number | null = null) => ({
  type,
  stage,
  progress_done: done,
  progress_total: total,
});

describe("stage labels", () => {
  it("ingest stages read as Vietnamese with counts", () => {
    expect(stageLabel(job("chapter.ingest", "download", 3, 12))).toBe("Đang tải ảnh 3/12");
    expect(stageLabel(job("chapter.ingest", "cut", 2, 5))).toBe("Đang cắt trang 2/5 đoạn");
    // Worker cũ báo `detect` cho bước cắt trang.
    expect(stageLabel(job("chapter.ingest", "detect", 2, 5))).toBe("Đang cắt trang 2/5 đoạn");
    expect(stageLabel(job("chapter.ingest", "upload", 4, 9))).toBe("Đang lưu trang 4/9");
  });

  it("prepare shows inpaint as its own step", () => {
    expect(stageLabel(job("page.prepare", "inpaint"))).toBe("Xoá chữ");
    expect(stageLabel(job("page.prepare", "detect"))).toBe("Nhận diện chữ");
    expect(stageLabel(job("page.prepare", "ocr"))).toBe("Đọc chữ (OCR)");
  });

  it("short form drops counts", () => {
    const label = stageLabel(job("chapter.translate", "typeset", 2, 4), { short: true });
    expect(label).toBe("Đang đặt chữ");
    expect(label).not.toContain("/");
  });

  it("unknown or English codes never leak", () => {
    expect(stageLabel(job("page.prepare", "foo"))).toBe("Đang xử lý");
    expect(stageLabel(job("weird.type", "download", 1, 2))).toBe("Đang xử lý");
    for (const [type, stages] of Object.entries(STAGE_LABELS)) {
      for (const stage of Object.keys(stages)) {
        const label = stageLabel(job(type, stage, 1, 3)) ?? "";
        expect(label).not.toMatch(/^[a-z_]+$/);
        expect(label).not.toContain(stage);
      }
    }
  });

  it("null stage gives null", () => {
    expect(stageLabel(job("page.prepare", null))).toBeNull();
    expect(stageLabel(null)).toBeNull();
  });
});
