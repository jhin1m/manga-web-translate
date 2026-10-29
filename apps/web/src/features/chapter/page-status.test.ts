import { describe, expect, it } from "vitest";
import {
  isMacPlatform,
  isPageBusy,
  needsReview,
  pageLevel,
  pageLevelOf,
  selectHint,
  thumbAria,
  thumbMark,
  thumbTitle,
} from "./page-status.ts";
import type { PageStatus } from "./status.ts";

describe("page level", () => {
  it("maps the 6 page statuses to 4 levels", () => {
    const all: PageStatus[] = ["pending", "preparing", "prepared", "translating", "ready", "failed"];
    // pending = đã xếp hàng xoá chữ + OCR (đang chạy); prepared = đã OCR, chờ người dùng bấm Dịch.
    expect(all.map(pageLevel)).toEqual(["busy", "busy", "todo", "busy", "done", "error"]);
  });

  it("flags failed pages and pending AI updates for review", () => {
    expect(needsReview({ status: "ready", ai_update_available: false })).toBe(false);
    expect(needsReview({ status: "ready", ai_update_available: true })).toBe(true);
    expect(needsReview({ status: "failed", ai_update_available: false })).toBe(true);
    expect(needsReview({ status: "ready", ai_update_available: false }, true)).toBe(true);
  });

  const base = { ord: 2, status: "ready" as PageStatus, skipped: false, ai_update_available: false, cut_flag: false };
  const job = (over: Partial<NonNullable<Parameters<typeof thumbMark>[0]["job"]>>) =>
    ({
      status: "queued",
      error_class: "rate_limited",
      error: "429",
      provider_retries: 1,
      run_after: "2026-01-01T00:00:00Z",
      ...over,
    }) as Parameters<typeof thumbMark>[0]["job"];

  it("thumbnail mark priority: hidden > error > waiting on AI > needs review > none", () => {
    expect(thumbMark({ ...base, job: null }, false)).toBeNull();
    expect(thumbMark({ ...base, job: null }, true)?.label).toBe("Cần xem");
    expect(thumbMark({ ...base, ai_update_available: true, job: job({}) }, true)?.label).toBe("Chờ AI");
    expect(thumbMark({ ...base, status: "failed", job: job({}) }, true)?.label).toBe("Lỗi");
    expect(thumbMark({ ...base, status: "failed", skipped: true, job: null }, true)?.label).toBe("Đã ẩn");
  });

  it("busy pages show the AI step with job progress, queued jobs without a percentage", () => {
    const busy = (status: PageStatus, j: Parameters<typeof thumbMark>[0]["job"]) =>
      thumbMark({ ...base, status, job: j }, true);
    expect(busy("preparing", job({ status: "running", error_class: null, progress: 0.6 } as never))).toEqual({
      tone: "busy",
      label: "Xoá chữ · 60%",
      progress: 0.6,
    });
    expect(busy("pending", null)).toEqual({ tone: "busy", label: "Chờ xoá chữ", progress: null });
    expect(busy("translating", job({ status: "running", error_class: null, progress: 2 } as never))?.label).toBe(
      "Đang dịch · 100%",
    );
    // Lỗi tạm của AI vẫn ưu tiên "Chờ AI"; trang chờ dịch không có nhãn.
    expect(busy("translating", job({}))?.label).toBe("Chờ AI");
    expect(busy("prepared", null)?.label).toBe("Cần xem");
    expect(thumbMark({ ...base, status: "prepared", job: null }, false)).toBeNull();
  });

  it("pages in a queued/running chapter translate job show as translating before the worker claims it", () => {
    const tj = (over: object) =>
      job({ type: "chapter.translate", status: "queued", error_class: null, progress: 0, ...over } as never);
    expect(thumbMark({ ...base, status: "prepared", job: tj({}) }, false)).toEqual({
      tone: "busy",
      label: "Đang dịch · chờ",
      progress: null,
    });
    // Dịch lại trang đã xong: còn `ready` tới khi claim.
    expect(thumbMark({ ...base, job: tj({ status: "running", progress: 0.5 }) }, false)?.label).toBe("Đang dịch · 50%");
    expect(thumbAria({ ...base, status: "prepared", job: tj({}) }, false)).toBe("Trang 3 · Đang dịch · chờ");
    expect(pageLevelOf({ status: "prepared", job: tj({}) })).toBe("busy");
    // Job dịch đã xong / huỷ không còn tính là đang dịch.
    expect(thumbMark({ ...base, status: "prepared", job: tj({ status: "succeeded" }) }, false)).toBeNull();
    expect(pageLevelOf({ status: "failed", job: tj({}) })).toBe("error");
  });

  it("running prepare job shows its step and percent", () => {
    const j = job({
      type: "page.prepare",
      status: "running",
      error_class: null,
      stage: "inpaint",
      progress: 0.4,
    } as never);
    expect(thumbMark({ ...base, status: "preparing", job: j }, false)).toEqual({
      tone: "busy",
      label: "Xoá chữ · 40%",
      progress: 0.4,
    });
    // Bước dịch: nhãn ngắn không kèm " i/n" (thumbnail hẹp).
    const t = job({
      type: "chapter.translate",
      status: "running",
      error_class: null,
      stage: "typeset",
      progress: 0.75,
      progress_done: 2,
      progress_total: 4,
    } as never);
    expect(thumbMark({ ...base, status: "translating", job: t }, false)?.label).toBe("Đang đặt chữ · 75%");
  });

  it("queued page waits for its batch", () => {
    const queued = { ...base, status: "prepared" as PageStatus, translate_queued: true, run_batch: 3, job: null };
    expect(thumbMark(queued, false)).toEqual({ tone: "busy", label: "Chờ lượt · lô 3", progress: null });
    expect(thumbAria(queued, false)).toBe("Trang 3 · Chờ lượt · lô 3");
    expect(isPageBusy(queued)).toBe(true);
    // Trang chờ lượt mà đã xong lượt trước (dịch lại): vẫn chờ lô của nó.
    expect(thumbMark({ ...queued, status: "ready" }, false)?.label).toBe("Chờ lượt · lô 3");
    // Lỗi vẫn ưu tiên; trang còn xoá chữ hiện bước xoá chữ chứ không phải chờ lượt.
    expect(thumbMark({ ...queued, status: "failed" }, false)?.label).toBe("Lỗi");
    expect(thumbMark({ ...queued, status: "pending" }, false)?.label).toBe("Chờ xoá chữ");
    expect(isPageBusy({ ...base, status: "prepared", job: null })).toBe(false);
  });

  it("typesetting stage reads Đang đặt chữ, translate stage reads Đang dịch", () => {
    const t = (stage: string) =>
      job({
        type: "chapter.translate",
        status: "running",
        error_class: null,
        stage,
        progress: 0.5,
        progress_done: 1,
        progress_total: 4,
      } as never);
    // Trang của lô đang chạy: vẫn `translate_queued` tới khi lô xong.
    const inBatch = { ...base, status: "translating" as PageStatus, translate_queued: true, run_batch: 2 };
    expect(thumbMark({ ...inBatch, job: t("typeset") }, false)?.label.startsWith("Đang đặt chữ")).toBe(true);
    expect(thumbMark({ ...inBatch, job: t("translate") }, false)?.label.startsWith("Đang dịch")).toBe(true);
  });

  it("pending page without a job waits for text removal", () => {
    const mark = thumbMark({ ...base, status: "pending", job: null }, false);
    expect(mark?.label).toBe("Chờ xoá chữ");
    expect(thumbAria({ ...base, status: "pending", job: null }, false)).not.toMatch(/[Bb]ước/);
  });

  it("the selection hint names the key that works on the platform", () => {
    // macOS: Ctrl-click là chuột phải (mở menu Ẩn trang) → chỉ ⌘ chọn được.
    expect(selectHint(true)).toBe("⌘-click hoặc Shift-click: chọn để dịch riêng");
    expect(selectHint(false)).toBe("Ctrl-click hoặc Shift-click: chọn để dịch riêng");
    expect(["macOS", "MacIntel", "iPad", "Windows", "Win32", "Linux x86_64", ""].map(isMacPlatform)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("thumbnail title hints page selection with the platform's key; hidden pages only offer restore", () => {
    const visible = { ...base, job: null };
    expect(thumbTitle(visible, false, true)).toBe(
      "Chuột phải: xoá (ẩn) trang · ⌘-click hoặc Shift-click: chọn để dịch riêng",
    );
    expect(thumbTitle(visible, false, false)).toContain("Ctrl-click hoặc Shift-click");
    expect(thumbTitle(visible, false, false)).not.toContain("⌘");
    expect(thumbTitle({ ...visible, skipped: true }, false, true)).toBe("Bấm hoặc chuột phải: khôi phục trang");
  });

  it("thumbnail accessible name always carries the state", () => {
    expect(thumbAria({ ...base, job: null }, false)).toBe("Trang 3 · Xong");
    expect(thumbAria({ ...base, status: "prepared", job: null }, false)).toBe("Trang 3 · Chờ dịch");
    expect(thumbAria({ ...base, ai_update_available: true, job: null }, true)).toBe(
      "Trang 3 · Cần xem: AI có bản mới, tràn khung",
    );
    expect(thumbAria({ ...base, status: "failed", job: null }, false)).toBe("Trang 3 · Lỗi");
    expect(thumbAria({ ...base, skipped: true, job: null }, false)).toBe("Trang 3 · Đã ẩn");
  });
});
