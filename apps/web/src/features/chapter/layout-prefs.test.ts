import { describe, expect, it } from "vitest";
import { clearLegacyLayout } from "./layout-prefs.ts";

const fakeStorage = (init: Record<string, string>) => {
  const data = { ...init };
  return { data, removeItem: (k: string) => void delete data[k] };
};

describe("clearLegacyLayout", () => {
  it("bỏ giá trị cũ nhớ panel mở để mặc định đóng có hiệu lực", () => {
    const st = fakeStorage({ "mtl.layout": JSON.stringify({ panel: "tool" }), other: "keep" });
    clearLegacyLayout(st);
    expect(st.data).toEqual({ other: "keep" });
  });
  it("không lỗi khi không có khoá, hoặc storage không ghi được", () => {
    expect(() => clearLegacyLayout(fakeStorage({}))).not.toThrow();
    expect(() =>
      clearLegacyLayout({
        removeItem: () => {
          throw new Error("denied");
        },
      }),
    ).not.toThrow();
    expect(() => clearLegacyLayout(undefined)).not.toThrow();
  });
});
