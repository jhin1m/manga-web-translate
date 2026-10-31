import { describe, expect, it } from "vitest";
import { undoStyleText } from "./undo-style-text.ts";

const list = [
  { id: "a", ord: 0 },
  { id: "b", ord: 1 },
  { id: "c", ord: 2 },
];

describe("undoStyleText", () => {
  it("names the open page as untouched when it was skipped", () => {
    expect(undoStyleText(1, ["a"], list, "a")).toBe(
      "Đã hoàn tác áp kiểu trên 1 trang · trang đang mở (trang 1) giữ nguyên vì đã sửa sau đó.",
    );
  });
  it("keeps the plain skipped wording when the open page was restored", () => {
    expect(undoStyleText(1, ["b"], list, "a")).toBe(
      "Đã hoàn tác áp kiểu trên 1 trang · bỏ qua trang 2 vì đã sửa sau đó.",
    );
  });
  it("lists other skipped pages alongside the open one", () => {
    expect(undoStyleText(1, ["c", "a"], list, "a")).toBe(
      "Đã hoàn tác áp kiểu trên 1 trang · bỏ qua trang 3, trang đang mở (trang 1) giữ nguyên vì đã sửa sau đó.",
    );
  });
  it("tells that nothing changed when only the open page was skipped and none restored", () => {
    expect(undoStyleText(0, ["a"], list, "a")).toBe(
      "Không hoàn tác được: trang 1 đã sửa sau khi áp kiểu. Trang đang mở giữ nguyên.",
    );
  });
});

describe("undoStyleText with another batch kind", () => {
  it("names the kind of the undone batch", () => {
    expect(undoStyleText(2, [], list, "a", "thay thế")).toBe("Đã hoàn tác thay thế trên 2 trang.");
    expect(undoStyleText(0, ["a"], list, "a", "áp glossary")).toBe(
      "Không hoàn tác được: trang 1 đã sửa sau khi áp glossary. Trang đang mở giữ nguyên.",
    );
  });
});
