import { describe, expect, it } from "vitest";
import { aiProviders, type DbLike, scoped, systemFonts, user } from "../src/index.ts";

// Kiểm tra ở mức kiểu (chạy trong typecheck): selectShared chỉ nhận bảng dùng chung được liệt kê tường minh.
describe("selectShared", () => {
  it("only accepts allow-listed shared tables", () => {
    const typeChecks = () => {
      const sdb = scoped(null as unknown as DbLike, "u");
      void sdb.selectShared(systemFonts);
      // @ts-expect-error bảng người dùng / xác thực không phải bảng dùng chung
      void sdb.selectShared(user);
      // @ts-expect-error bảng chứa khoá API đã mã hoá
      void sdb.selectShared(aiProviders);
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});
