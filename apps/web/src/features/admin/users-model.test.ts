import { describe, expect, it } from "vitest";
import { disableConfirmText, fmtUsd, rowAction, statusLabel } from "./users-model.ts";

describe("rowAction", () => {
  it("admins cannot be disabled, others can, disabled accounts can always be enabled", () => {
    expect(rowAction({ is_admin: true, disabled_at: null })).toBeNull();
    expect(rowAction({ is_admin: false, disabled_at: null })).toBe("disable");
    expect(rowAction({ is_admin: false, disabled_at: "2026-11-04T00:00:00Z" })).toBe("enable");
    expect(rowAction({ is_admin: true, disabled_at: "2026-11-04T00:00:00Z" })).toBe("enable");
  });
});

describe("labels", () => {
  it("status and confirmation text", () => {
    expect(statusLabel({ is_admin: false, disabled_at: null })).toBe("Hoạt động");
    expect(statusLabel({ is_admin: true, disabled_at: null })).toBe("Admin");
    expect(statusLabel({ is_admin: false, disabled_at: "2026-11-04T00:00:00Z" })).toBe("Đã khoá");
    expect(disableConfirmText({ email: "a@b.c" })).toMatch(/^Khoá a@b\.c\?/);
  });
});

describe("fmtUsd", () => {
  it("trims float noise", () => {
    expect(fmtUsd(0.1 + 0.2)).toBe("$0.3");
  });
});
