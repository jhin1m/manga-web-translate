import { describe, expect, it } from "vitest";
import { type RailHas, railClick } from "./tool-rail-model.ts";

const nothing: RailHas = { content: false, selection: false };
const selected: RailHas = { content: false, selection: true };
const content: RailHas = { content: true, selection: false };

describe("railClick", () => {
  it("Chọn mở panel khối khi đang thu và có khối đang chọn hoặc có nội dung", () => {
    expect(railClick({ panel: null, tool: "text" }, "select", selected)).toEqual({ panel: "tool", tool: "select" });
    expect(railClick({ panel: null, tool: "text" }, "select", content)).toEqual({ panel: "tool", tool: "select" });
  });
  it("Chọn không mở panel khi không có khối đang chọn và không có nội dung", () => {
    expect(railClick({ panel: null, tool: "text" }, "select", nothing)).toEqual({ panel: null, tool: "select" });
    expect(railClick({ panel: null, tool: "select" }, "select", nothing)).toEqual({ panel: null, tool: "select" });
    // Đang ở Văn bản thì giữ Văn bản (như phím V không đụng panel).
    expect(railClick({ panel: "doc", tool: "select" }, "select", nothing)).toEqual({ panel: "doc", tool: "select" });
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
    expect(railClick({ panel: "tool", tool: "select" }, "brush", content)).toEqual({ panel: "tool", tool: "brush" });
    expect(railClick({ panel: null, tool: "select" }, "brush", content)).toEqual({ panel: null, tool: "brush" });
  });
  it("Tẩy nét đứng chung nút Tẩy chữ: bấm Tẩy chữ giữ chế độ tẩy", () => {
    expect(railClick({ panel: null, tool: "eraser" }, "brush")).toEqual({ panel: null, tool: "eraser" });
    expect(railClick({ panel: "doc", tool: "eraser" }, "brush")).toEqual({ panel: null, tool: "eraser" });
  });
  it("Văn bản bật tắt panel của nó, không đổi công cụ", () => {
    expect(railClick({ panel: "tool", tool: "eraser" }, "doc")).toEqual({ panel: "doc", tool: "eraser" });
    expect(railClick({ panel: "doc", tool: "eraser" }, "doc")).toEqual({ panel: null, tool: "eraser" });
    expect(railClick({ panel: null, tool: "text" }, "doc")).toEqual({ panel: "doc", tool: "text" });
  });
  it("thu Văn bản khi còn nội dung phải xử lý thì quay về panel khối, không giấu nội dung", () => {
    expect(railClick({ panel: "doc", tool: "select" }, "doc", content)).toEqual({ panel: "tool", tool: "select" });
    expect(railClick({ panel: "doc", tool: "select" }, "doc", selected)).toEqual({ panel: null, tool: "select" });
  });
  it("bấm công cụ Chọn khi panel đang là Văn bản và có khối đang chọn thì mở panel khối", () => {
    expect(railClick({ panel: "doc", tool: "select" }, "select", selected)).toEqual({ panel: "tool", tool: "select" });
  });
});
