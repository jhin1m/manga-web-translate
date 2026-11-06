import { describe, expect, it } from "vitest";
import { docTabLabel } from "./doc-tabs.tsx";

describe("docTabLabel", () => {
  it("Hiệu đính kèm số gợi ý chờ duyệt khi có", () => {
    expect(docTabLabel("proofread", 3)).toBe("Hiệu đính · 3");
  });
  it("không có gợi ý chờ thì chỉ tên tab", () => {
    expect(docTabLabel("proofread", 0)).toBe("Hiệu đính");
  });
  it("tab khác không mang số", () => {
    expect(docTabLabel("table", 5)).toBe("Bản dịch");
    expect(docTabLabel("find", 5)).toBe("Tìm / Thay");
    expect(docTabLabel("glossary", 5)).toBe("Glossary");
  });
});
