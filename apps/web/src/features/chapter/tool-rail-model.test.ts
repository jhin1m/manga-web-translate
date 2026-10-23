import { describe, expect, it } from "vitest";
import { railClick } from "./tool-rail-model.ts";

describe("railClick", () => {
  it("mở panel công cụ và đặt công cụ khi panel đang thu", () => {
    expect(railClick({ panel: null, tool: "select" }, "text")).toEqual({ panel: "tool", tool: "text" });
  });
  it("bấm lại công cụ đang mở thì thu panel, giữ công cụ", () => {
    expect(railClick({ panel: "tool", tool: "brush" }, "brush")).toEqual({ panel: null, tool: "brush" });
  });
  it("đổi công cụ khi panel công cụ đang mở", () => {
    expect(railClick({ panel: "tool", tool: "select" }, "ocr")).toEqual({ panel: "tool", tool: "ocr" });
  });
  it("Bản dịch / Tìm bật tắt panel của nó, không đổi công cụ", () => {
    expect(railClick({ panel: "tool", tool: "eraser" }, "table")).toEqual({ panel: "table", tool: "eraser" });
    expect(railClick({ panel: "table", tool: "eraser" }, "table")).toEqual({ panel: null, tool: "eraser" });
    expect(railClick({ panel: "table", tool: "eraser" }, "find")).toEqual({ panel: "find", tool: "eraser" });
  });
  it("bấm công cụ đang chọn khi panel đang là Bản dịch thì mở panel công cụ", () => {
    expect(railClick({ panel: "table", tool: "select" }, "select")).toEqual({ panel: "tool", tool: "select" });
  });
  it("Hiệu đính bật tắt panel của nó như Bản dịch / Tìm", () => {
    expect(railClick({ panel: "tool", tool: "text" }, "proofread")).toEqual({ panel: "proofread", tool: "text" });
    expect(railClick({ panel: "proofread", tool: "text" }, "proofread")).toEqual({ panel: null, tool: "text" });
  });
});
