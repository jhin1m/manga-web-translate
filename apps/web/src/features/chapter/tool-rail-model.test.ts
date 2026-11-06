import { describe, expect, it } from "vitest";
import { railClick } from "./tool-rail-model.ts";

describe("railClick", () => {
  it("Chọn mở panel khối khi đang thu", () => {
    expect(railClick({ panel: null, tool: "text" }, "select")).toEqual({ panel: "tool", tool: "select" });
  });
  it("bấm lại Chọn đang mở thì thu panel, giữ công cụ", () => {
    expect(railClick({ panel: "tool", tool: "select" }, "select")).toEqual({ panel: null, tool: "select" });
  });
  it("Chữ / Tẩy chữ / Quét chữ chỉ đặt công cụ, không mở panel", () => {
    expect(railClick({ panel: null, tool: "select" }, "text")).toEqual({ panel: null, tool: "text" });
    expect(railClick({ panel: null, tool: "select" }, "brush")).toEqual({ panel: null, tool: "brush" });
    expect(railClick({ panel: null, tool: "select" }, "ocr")).toEqual({ panel: null, tool: "ocr" });
  });
  it("đổi từ Chọn sang công cụ có thanh phụ thì thu panel khối", () => {
    expect(railClick({ panel: "tool", tool: "select" }, "ocr")).toEqual({ panel: null, tool: "ocr" });
  });
  it("còn nội dung phải xử lý (AI mới, xung đột) thì panel khối ở lại", () => {
    expect(railClick({ panel: "tool", tool: "select" }, "brush", true)).toEqual({ panel: "tool", tool: "brush" });
    expect(railClick({ panel: null, tool: "select" }, "brush", true)).toEqual({ panel: null, tool: "brush" });
  });
  it("Tẩy nét đứng chung nút Tẩy chữ: bấm Tẩy chữ giữ chế độ tẩy", () => {
    expect(railClick({ panel: null, tool: "eraser" }, "brush")).toEqual({ panel: null, tool: "eraser" });
    expect(railClick({ panel: "table", tool: "eraser" }, "brush")).toEqual({ panel: null, tool: "eraser" });
  });
  it("Bản dịch / Tìm bật tắt panel của nó, không đổi công cụ", () => {
    expect(railClick({ panel: "tool", tool: "eraser" }, "table")).toEqual({ panel: "table", tool: "eraser" });
    expect(railClick({ panel: "table", tool: "eraser" }, "table")).toEqual({ panel: null, tool: "eraser" });
    expect(railClick({ panel: "table", tool: "eraser" }, "find")).toEqual({ panel: "find", tool: "eraser" });
  });
  it("bấm công cụ Chọn đang chọn khi panel đang là Bản dịch thì mở panel khối", () => {
    expect(railClick({ panel: "table", tool: "select" }, "select")).toEqual({ panel: "tool", tool: "select" });
  });
  it("Hiệu đính bật tắt panel của nó như Bản dịch / Tìm", () => {
    expect(railClick({ panel: "tool", tool: "text" }, "proofread")).toEqual({ panel: "proofread", tool: "text" });
    expect(railClick({ panel: "proofread", tool: "text" }, "proofread")).toEqual({ panel: null, tool: "text" });
  });
});
